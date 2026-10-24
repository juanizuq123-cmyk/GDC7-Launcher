'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, screen, safeStorage, net, clipboard } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { EVENTS, LauncherStore: EventStore, canLaunchEvent } = require('./event-store.cjs');
const { AccountManager, configCheck, loadAuthConfig } = require('./auth.cjs');
const { AuthError, publicError } = require('./auth-errors.cjs');
const { SessionVault } = require('./auth-vault.cjs');
const { jsonRequest } = require('./auth-transport.cjs');
const { PrismAccountBridge, PrismError } = require('./prism-account.cjs');
const { CLIENT_PACK } = require('./client-pack.cjs');
const { BOREAL_PROFILE } = require('./boreal-profile.cjs');
const { CONSTRUCTOR_PROFILE, BorealConstructorProfileUpdater } = require('./boreal-constructor.cjs');
const { formatDiagnosticReport } = require('./diagnostics.cjs');
const BRAND = require('./brand.cjs');

app.setName(BRAND.dataName);
if (process.platform === 'win32') app.setAppUserModelId(BRAND.appId);

let window = null;
let store = null;
let account = null;
let prism = null;
let installedClientProfile = null;
let installedBorealProfile = null;
let installedConstructorProfile = null;
let profileUpdater = null;
let borealProfileUpdater = null;
let constructorProfileUpdater = null;
let launcherUpdater = null;
let profileUpdateState = { status: 'idle', currentVersion: null, latestVersion: null, progress: 0, changes: { added: [], changed: [], removed: [] }, notes: '', error: null };
let borealProfileUpdateState = { status: 'unavailable', currentVersion: null, latestVersion: null, modCount: BOREAL_PROFILE.modCount, progress: 0, changes: { added: [], changed: [], removed: [] }, notes: '', error: 'Falta publicar el canal HTTPS y su repositorio de releases propio de Estación Boreal.' };
let constructorProfileUpdateState = { status: 'unavailable', currentVersion: null, latestVersion: CONSTRUCTOR_PROFILE.version, modCount: CONSTRUCTOR_PROFILE.modCount, progress: 0, notes: '', error: 'No se pudo verificar el paquete Boreal Constructor.' };
let launcherUpdateState = { status: 'manual-transition', currentVersion: null, latestVersion: null, percent: 0, releaseNotes: '', error: null };
let authConfigFile = null;
let closeAllowed = false;
let closing = false;

function send(channel, value) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}

function safeError(error) {
  if (error instanceof AuthError) return publicError(error).message;
  if (error instanceof PrismError) return error.message;
  if (typeof error?.message === 'string' && /^(La configuración|La carpeta|Cada evento|Elegí|Ese evento|Ese ajuste|La memoria|No se pudo leer la configuración|El perfil de Estación Boreal|El perfil Boreal Constructor|El paquete Boreal Constructor|El canal del perfil|El manifiesto de Boreal|El pack firmado de Boreal)/i.test(error.message)) return error.message;
  return 'No se pudo completar la acción. Revisá los permisos y volvé a intentarlo.';
}

function trustedRenderer(event) {
  return Boolean(window && !window.isDestroyed() && event.sender === window.webContents && event.senderFrame?.url === window.webContents.getURL());
}

function register(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!trustedRenderer(event)) return { ok: false, error: 'La solicitud no viene de la ventana del launcher.' };
    try { return { ok: true, value: await callback(...args) }; }
    catch (error) { return { ok: false, error: safeError(error) }; }
  });
}

function publicState() {
  const workspace = store.snapshot();
  const events = EVENTS.map(event => {
    const profile = workspace.profiles[event.id];
    return {
      ...event,
      profile,
      canPlay: event.id === BOREAL_PROFILE.eventId ? Boolean(installedBorealProfile) : event.id === CONSTRUCTOR_PROFILE.eventId ? Boolean(installedConstructorProfile) : canLaunchEvent(event, profile),
      clientProfile: event.id === CLIENT_PACK.eventId
        ? { ...CLIENT_PACK, version: profileUpdateState.currentVersion || installedClientProfile?.profileRelease || CLIENT_PACK.version, modCount: profileUpdateState.modCount || CLIENT_PACK.modCount, installed: Boolean(installedClientProfile), instanceId: installedClientProfile?.instanceId || null, path: installedClientProfile?.path || null }
        : null,
      borealProfile: event.id === BOREAL_PROFILE.eventId
        ? { ...BOREAL_PROFILE, version: borealProfileUpdateState.currentVersion || installedBorealProfile?.profileRelease || BOREAL_PROFILE.version, modCount: borealProfileUpdateState.modCount || BOREAL_PROFILE.modCount, installed: Boolean(installedBorealProfile), instanceId: installedBorealProfile?.instanceId || null, path: installedBorealProfile?.path || null }
        : null,
      constructorProfile: event.id === CONSTRUCTOR_PROFILE.eventId
        ? { ...CONSTRUCTOR_PROFILE, version: installedConstructorProfile?.profileRelease || CONSTRUCTOR_PROFILE.version, installed: Boolean(installedConstructorProfile), instanceId: installedConstructorProfile?.instanceId || null, path: installedConstructorProfile?.path || null }
        : null
    };
  });
  return {
    brand: BRAND.name,
    version: require('./package.json').version,
    selectedEventId: workspace.selectedEventId,
    workspace,
    events,
    account: account.snapshot(),
    authConfig: { clientId: account.config.clientId || '', confirmed: account.config.minecraftApiAccessConfirmed === true, invalid: account.config.error === 'INVALID_CONFIG' },
    prism: prism.snapshot(),
    launcherUpdate: launcherUpdater?.snapshot() || { ...launcherUpdateState },
    profileUpdate: profileUpdater?.snapshot() || { ...profileUpdateState },
    borealProfileUpdate: borealProfileUpdater?.snapshot() || { ...borealProfileUpdateState },
    constructorProfileUpdate: constructorProfileUpdater?.snapshot() || { ...constructorProfileUpdateState }
  };
}

function publishState() { send('launcher:state', publicState()); }

async function writeAuthConfig(input) {
  if (account.active) throw new Error('Esperá a que termine el acceso a la cuenta antes de cambiar su configuración.');
  const value = configCheck({ schema: 1, clientId: input?.clientId?.trim() || null, minecraftApiAccessConfirmed: input?.minecraftApiAccessConfirmed === true });
  if (account.snapshot().hasSession && (value.clientId !== account.config.clientId || !value.minecraftApiAccessConfirmed)) await account.logout();
  const temporary = `${authConfigFile}.${randomUUID()}.tmp`;
  await fs.mkdir(path.dirname(authConfigFile), { recursive: true });
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, authConfigFile);
    account.config = value;
    publishState();
    return { authConfig: { clientId: value.clientId || '', confirmed: value.minecraftApiAccessConfirmed }, account: account.snapshot() };
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

function registerHandlers() {
  register('launcher:bootstrap', () => publicState());
  register('launcher:copy-diagnostics', () => {
    clipboard.writeText(formatDiagnosticReport(publicState(), { platform: process.platform, architecture: process.arch, release: os.release() }));
    return true;
  });
  register('launcher:select-event', async id => { await store.selectEvent(id); publishState(); return publicState(); });
  register('launcher:set-profile-value', async (id, key, value) => { await store.setProfileValue(id, key, value); publishState(); return publicState(); });
  register('launcher:set-reduced-motion', async value => { await store.setReducedMotion(value); publishState(); return publicState(); });
  register('launcher:choose-instance-dir', async id => {
    if (!EVENTS.some(event => event.id === id)) throw new Error('Ese evento no está disponible.');
    const result = await dialog.showOpenDialog(window, { title: `Elegir carpeta de ${EVENTS.find(event => event.id === id).title}`, properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    const chosen = result.filePaths[0];
    const stat = await fs.lstat(chosen);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Elegí una carpeta local normal, no un enlace.');
    await store.setInstanceDir(id, await fs.realpath(chosen));
    publishState();
    return publicState();
  });
  register('launcher:open-instance-dir', async id => {
    const profile = store.snapshot().profiles[id];
    if (!profile) throw new Error('Ese evento no está disponible.');
    const directory = id === CLIENT_PACK.eventId
      ? (installedClientProfile?.path || await prism.instancesDirectory())
      : id === BOREAL_PROFILE.eventId
        ? (installedBorealProfile?.path || await prism.instancesDirectory())
        : id === CONSTRUCTOR_PROFILE.eventId
          ? (installedConstructorProfile?.path || await prism.instancesDirectory())
        : profile.instanceDir;
    await fs.mkdir(directory, { recursive: true });
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('La carpeta de instancia dejó de ser una carpeta normal.');
    const result = await shell.openPath(directory);
    if (result) throw new Error('Windows no pudo abrir la carpeta de la instancia.');
    return true;
  });
  register('launcher:save-auth-config', writeAuthConfig);
  register('launcher:account-login', () => account.login());
  register('launcher:account-refresh', () => account.refresh());
  register('launcher:account-cancel', () => account.cancel());
  register('launcher:account-logout', () => account.logout());
  register('launcher:account-open-browser', () => account.reopenBrowser());
  register('launcher:prism-accounts-open', () => prism.start());
  register('launcher:client-profile-install', () => {
    if (store.snapshot().selectedEventId !== 'gdc7') throw new Error('Seleccioná GDC7 para instalar este perfil.');
    return profileUpdater ? profileUpdater.installPackPath().then(pack => prism.importClientPack(pack)) : prism.importClientPack();
  });
  register('launcher:client-profile-play', nickname => {
    if (store.snapshot().selectedEventId !== 'gdc7') throw new Error('Seleccioná GDC7 para iniciar este perfil.');
    if (['checking', 'downloading', 'recovering', 'applying'].includes(profileUpdateState.status)) throw new Error('Esperá a que termine la actualización del perfil GDC7.');
    return prism.launchClientProfile(nickname || null);
  });
  register('launcher:boreal-profile-install', async () => {
    if (store.snapshot().selectedEventId !== BOREAL_PROFILE.eventId) throw new Error('Seleccioná Estación Boreal para instalar este perfil.');
    if (!borealProfileUpdater) throw new Error('El perfil de Estación Boreal no está configurado.');
    const pack = await borealProfileUpdater.installPackPath();
    return prism.importBorealClientPack(pack);
  });
  register('launcher:boreal-profile-play', () => {
    if (store.snapshot().selectedEventId !== BOREAL_PROFILE.eventId) throw new Error('Seleccioná Estación Boreal para iniciar este perfil.');
    if (!installedBorealProfile) throw new Error('El perfil de Estación Boreal todavía no está instalado.');
    return prism.launchBorealClientProfile();
  });
  register('launcher:boreal-constructor-install', async () => {
    if (store.snapshot().selectedEventId !== CONSTRUCTOR_PROFILE.eventId) throw new Error('Seleccioná Boreal Constructor para instalar este perfil.');
    if (!constructorProfileUpdater) throw new Error('No se pudo verificar Boreal Constructor.');
    return prism.importBorealConstructorPack(await constructorProfileUpdater.installPackPath());
  });
  register('launcher:boreal-constructor-play', () => {
    if (store.snapshot().selectedEventId !== CONSTRUCTOR_PROFILE.eventId) throw new Error('Seleccioná Boreal Constructor para iniciar este perfil.');
    if (!installedConstructorProfile) throw new Error('Primero instalá Boreal Constructor desde el launcher.');
    return prism.launchBorealConstructorProfile();
  });
  register('launcher:check-updates', async () => {
    const appState = launcherUpdater ? await launcherUpdater.check() : launcherUpdateState;
    if (appState.status === 'downloading' || appState.status === 'installing') return { launcherUpdate: appState, profileUpdate: profileUpdateState };
    if (profileUpdater) await profileUpdater.checkAndApply();
    if (borealProfileUpdater) await borealProfileUpdater.check();
    if (constructorProfileUpdater) await constructorProfileUpdater.check();
    publishState();
    return { launcherUpdate: launcherUpdater?.snapshot() || launcherUpdateState, profileUpdate: profileUpdater?.snapshot() || profileUpdateState, borealProfileUpdate: borealProfileUpdater?.snapshot() || borealProfileUpdateState, constructorProfileUpdate: constructorProfileUpdater?.snapshot() || constructorProfileUpdateState };
  });
  register('launcher:window', action => {
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    else if (action === 'close') window.close();
    else throw new Error('Esa acción de ventana no está disponible.');
    return true;
  });
}

async function createWindow() {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.max(760, Math.min(1360, area.width - 20));
  const height = Math.max(620, Math.min(880, area.height - 20));
  window = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(760, width),
    minHeight: Math.min(620, height),
    frame: false,
    title: BRAND.name,
    backgroundColor: '#0b0a12',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: false
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (closeAllowed || !store) return;
    if (prism?.child) {
      event.preventDefault();
      send('launcher:notice', { message: 'Cerrá la ventana de Prism antes de salir del launcher.' });
      return;
    }
    event.preventDefault();
    if (closing) return;
    closing = true;
    Promise.allSettled([store.queue, account?.shutdown(), prism?.shutdown()]).then(() => {
      closeAllowed = true;
      if (window && !window.isDestroyed()) window.close();
    });
  });
  window.once('ready-to-show', () => window.show());
  await window.loadFile(path.join(__dirname, 'app', 'index.html'));
}

const ownsInstance = process.platform !== 'win32' || app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => { if (window && !window.isDestroyed()) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  const userData = app.getPath('userData');
  store = new EventStore(path.join(userData, 'launcher-settings.json'), path.join(userData, 'instances'));
  await store.load();
  authConfigFile = path.join(userData, 'account', 'auth-config.json');
  let config = await loadAuthConfig(authConfigFile);
  if (config.error === 'INVALID_CONFIG') {
    const userConfigExists = await fs.stat(authConfigFile).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error));
    if (!userConfigExists) config = await loadAuthConfig(path.join(__dirname, 'auth-config.json'));
  }
  account = new AccountManager({
    config,
    vault: new SessionVault(path.join(userData, 'account'), safeStorage),
    request: (url, options) => jsonRequest(net, url, options),
    openExternal: url => shell.openExternal(url),
    onChange: state => { send('launcher:account-state', state); publishState(); }
  });
  prism = new PrismAccountBridge({ userData: path.join(userData, 'prism'), packFile: path.join(__dirname, 'provider', 'packs', CLIENT_PACK.packFile) });
  installedClientProfile = await prism.findClientProfile().catch(() => null);
  installedBorealProfile = await prism.findBorealProfile().catch(() => null);
  installedConstructorProfile = await prism.findBorealConstructorProfile().catch(() => null);
  const keys = require('./update-keys.cjs');
  const { Gdc7ProfileUpdater } = require('./gdc7-profile-updater.cjs');
  profileUpdater = new Gdc7ProfileUpdater({
    publicKey: keys.profile,
    userData: path.join(userData, 'prism'),
    prismBridge: prism,
    onChange: state => { profileUpdateState = state; publishState(); }
  });
  const { BorealProfileUpdater } = require('./boreal-profile.cjs');
  borealProfileUpdater = new BorealProfileUpdater({
    userData: path.join(userData, 'prism'),
    prismBridge: prism,
    bundledPackPath: path.join(__dirname, 'provider', 'packs', BOREAL_PROFILE.packFile),
    onChange: state => { borealProfileUpdateState = state; publishState(); }
  });
  constructorProfileUpdater = new BorealConstructorProfileUpdater({
    userData: path.join(userData, 'prism'),
    prismBridge: prism,
    bundledPackPath: path.join(__dirname, 'provider', 'packs', CONSTRUCTOR_PROFILE.packFile),
    onChange: state => { constructorProfileUpdateState = state; publishState(); }
  });
  try {
    const modePath = path.join(process.resourcesPath, 'launcher-install-mode.json');
    const mode = JSON.parse(await fs.readFile(modePath, 'utf8'));
    if (mode.schema === 1 && mode.channel === 'stable' && mode.repository === 'juanizuq123-cmyk/GDC7-Launcher') {
      const { autoUpdater } = require('electron-updater');
      const { LauncherChannel } = require('./launcher-channel.cjs');
      const { LauncherUpdater } = require('./launcher-updater.cjs');
      launcherUpdater = new LauncherUpdater({
        updater: autoUpdater,
        channel: new LauncherChannel({ publicKey: keys.launcher }),
        currentVersion: require('./package.json').version,
        onChange: state => { launcherUpdateState = state; publishState(); }
      });
      launcherUpdateState = launcherUpdater.snapshot();
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) launcherUpdateState = { ...launcherUpdateState, status: 'unavailable', error: 'No se pudo iniciar la comprobación del launcher.' };
  }
  prism.on('change', state => {
    const update = async () => {
      if (!state.active) installedClientProfile = await prism.findClientProfile().catch(() => null);
      if (!state.active) installedBorealProfile = await prism.findBorealProfile().catch(() => null);
      if (!state.active) installedConstructorProfile = await prism.findBorealConstructorProfile().catch(() => null);
      send('launcher:prism-state', state);
      publishState();
      if (!state.active && state.mode === 'import' && state.eventId === BOREAL_PROFILE.eventId && borealProfileUpdater) {
        await borealProfileUpdater.check();
        installedBorealProfile = await prism.findBorealProfile().catch(() => null);
        publishState();
      } else if (!state.active && state.mode === 'import' && state.eventId === CONSTRUCTOR_PROFILE.eventId && constructorProfileUpdater) {
        await constructorProfileUpdater.check();
        installedConstructorProfile = await prism.findBorealConstructorProfile().catch(() => null);
        publishState();
      } else if (!state.active && state.mode === 'import' && profileUpdater) {
        await profileUpdater.checkAndApply();
        installedClientProfile = await prism.findClientProfile().catch(() => null);
        publishState();
      }
    };
    void update();
  });
  registerHandlers();
  await createWindow();
  if (!config.error) account.initialize().catch(() => {});
  publishState();
  void (async () => {
    if (launcherUpdater) await launcherUpdater.check();
    const appStatus = launcherUpdater?.snapshot().status;
    if (appStatus === 'downloading' || appStatus === 'installing') {
      profileUpdateState = { ...profileUpdateState, status: 'waiting-launcher-update', error: 'El perfil se comprobará cuando termine la actualización del launcher.' };
      publishState();
      return;
    }
    await profileUpdater.checkAndApply();
    await borealProfileUpdater.check();
    await constructorProfileUpdater.check();
  })();
}).catch(error => {
  console.error('Launcher startup failed:', error);
  dialog.showErrorBox(`${BRAND.name} no pudo iniciar`, safeError(error));
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
