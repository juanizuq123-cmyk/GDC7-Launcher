'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { safeRoot, safeParent, verifyFile, check } = require('./file-safety.cjs');
const { readPath, publish, publishBytes, assertWindows64 } = require('./install-fs.cjs');
const { readZip } = require('./safe-zip.cjs');
const { CLIENT_PACK } = require('./client-pack.cjs');
const { BOREAL_PROFILE, compareVersions } = require('./boreal-profile.cjs');
const { CONSTRUCTOR_PROFILE } = require('./boreal-constructor.cjs');

const PRISM = Object.freeze({
  version: '11.1.1',
  archive: 'PrismLauncher-Windows-MinGW-w64-Portable-11.1.1.zip',
  size: 43687692,
  sha256: '05841d0b3bfc0a8212658457cc6035e1c29cd7ffae919464e874e384cbe8d062'
});

const PROVIDER_SETTINGS = Object.freeze({
  ConfigVersion: '1.3',
  Language: 'es_ES',
  ApplicationTheme: 'dark',
  IconTheme: 'pe_colored',
  InstanceDir: 'instances',
  IgnoreJavaWizard: true,
  AutomaticJavaSwitch: true,
  AutomaticJavaDownload: true,
  UserAskedAboutAutomaticJavaDownload: true,
  ShowConsole: false,
  ShowConsoleOnError: true,
  CloseAfterLaunch: false,
  QuitAfterGameStop: true
});

class PrismError extends Error {
  constructor(code) {
    const messages = {
      BUSY: 'Prism ya está abierto. Cerrá su ventana antes de continuar.',
      UNSUPPORTED: 'La integración con Prism requiere Windows x64.',
      ENGINE: 'No se pudo comprobar o preparar la copia oficial de Prism.',
      PROFILE: 'No se pudo preparar la carpeta segura de Prism.',
      INSTANCE: 'Primero instalá el perfil GDC7 desde Prism.',
      BOREAL_INSTANCE: 'Primero instalá el perfil verificado de Estación Boreal desde el launcher.',
      CONSTRUCTOR_INSTANCE: 'Primero instalá Boreal Constructor desde el launcher.',
      PACK: 'El paquete del perfil no está disponible en una carpeta segura.',
      SPAWN: 'Windows no pudo abrir Prism. Revisá permisos y antivirus.',
      EXIT: 'Prism terminó con un error. Consultá el mensaje que mostró la aplicación.',
      BOREAL_IMPORT_EXIT: 'Prism no pudo completar la importación de Estación Boreal. Revisá si falló una descarga, volvé a intentarlo y dejá Prism abierto hasta que termine.',
      IMPORT_TIMEOUT: 'Prism no confirmó la instalación de Boreal. Completá la configuración inicial si aparece, confirmá el aviso del mod borealexpedition y esperá a que termine la importación antes de cerrar Prism.'
    };
    super(messages[code] || messages.ENGINE);
    this.code = Object.hasOwn(messages, code) ? code : 'ENGINE';
  }
}

function supportsPrismAccounts(platform = process.platform, arch = process.arch) {
  return platform === 'win32' && arch === 'x64'
    ? { supported: true, message: null }
    : { supported: false, message: 'La integración con Prism requiere Windows x64.' };
}

function accountArguments(dataRoot) {
  if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot) || /[\x00-\x1f]/.test(dataRoot)) throw new PrismError('PROFILE');
  return ['--dir', dataRoot, '--show-window'];
}

function prismArguments(dataRoot, action, value, offlineNickname) {
  if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot) || /[\x00-\x1f]/.test(dataRoot)) throw new PrismError('PROFILE');
  if (action === 'accounts') return accountArguments(dataRoot);
  if (action === 'import') {
    if (typeof value !== 'string' || !path.isAbsolute(value) || /[\x00-\x1f]/.test(value)) throw new PrismError('PROFILE');
    return ['--dir', dataRoot, '--import', value];
  }
  if (action === 'launch') {
    if (typeof value !== 'string' || !/^[^\\/\x00-\x1f]{1,100}$/.test(value)) throw new PrismError('PROFILE');
    const args = ['--dir', dataRoot, '--launch', value];
    if (offlineNickname !== undefined) {
      if (typeof offlineNickname !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(offlineNickname)) throw new PrismError('PROFILE');
      args.push('--offline', offlineNickname);
    }
    return args;
  }
  throw new PrismError('PROFILE');
}

function patchPrismConfig(text, values = PROVIDER_SETTINGS) {
  if (typeof text !== 'string' || !values || typeof values !== 'object' || Array.isArray(values)) throw new PrismError('PROFILE');
  const keys = Object.keys(values);
  if (keys.some(key => !/^[A-Za-z][A-Za-z0-9]*$/.test(key))) throw new PrismError('PROFILE');
  const lines = text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1).split(String.fromCharCode(10)) : text.split(String.fromCharCode(10));
  for (let i = 0; i < lines.length; i += 1) if (lines[i].endsWith(String.fromCharCode(13))) lines[i] = lines[i].slice(0, -1);
  const output = [];
  let inGeneral = false;
  let found = false;
  const owned = keys.map(key => {
    const value = values[key];
    if (typeof value === 'boolean' || typeof value === 'number') return `${key}=${String(value)}`;
    if (typeof value !== 'string' || /[\x00-\x1f\x7f]/.test(value)) throw new PrismError('PROFILE');
    return `${key}=${JSON.stringify(value.replaceAll('\\', '/'))}`;
  });
  const ownedKeys = new Set(keys);
  for (const line of lines) {
    const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
    if (section) {
      inGeneral = section[1] === 'General';
      if (inGeneral) {
        if (found) throw new PrismError('PROFILE');
        found = true;
        output.push(line, ...owned);
        continue;
      }
    }
    const key = /^\s*([^=;#\s]+)\s*=/.exec(line)?.[1];
    if (inGeneral && ownedKeys.has(key)) continue;
    output.push(line);
  }
  if (!found) output.push('[General]', ...owned);
  return `${output.join('\n').replace(/\n+$/, '')}\n`;
}

async function writePrismConfig(root, signal) {
  let previous = '';
  try {
    const file = await readPath(root, 'prismlauncher.cfg');
    const stat = await fs.lstat(file);
    if (stat.size > 65536) throw new PrismError('PROFILE');
    previous = new TextDecoder('utf-8', { fatal: true }).decode(await fs.readFile(file));
    if (previous.includes('\0')) throw new PrismError('PROFILE');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await publishBytes(root, 'prismlauncher.cfg', Buffer.from(patchPrismConfig(previous)), signal);
}

async function ensurePrism(userData, bundledDirectory, signal) {
  const archive = path.join(bundledDirectory, PRISM.archive);
  await verifyFile(archive, { size: PRISM.size, hashes: { sha256: PRISM.sha256 } }, signal);
  const engine = await safeRoot(path.join(userData, 'engines', `prism-${PRISM.version}`));
  const stagingRelative = `.gdc7/staging/prism-${randomUUID()}`;
  const staging = await safeRoot(await safeParent(engine, stagingRelative));
  try {
    const artifacts = await readZip(archive, { stageDir: staging, signal, maxEntries: 200, maxBytes: 200 * 1024 * 1024 });
    for (const artifact of artifacts) await publish(engine, artifact.target, artifact.source, artifact, signal);
    for (const artifact of artifacts) await verifyFile(await readPath(engine, artifact.target), artifact, signal);
    const executable = await readPath(engine, 'prismlauncher.exe');
    await assertWindows64(executable);
    return { engine, executable };
  } catch (error) {
    throw error instanceof PrismError ? error : new PrismError('ENGINE');
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function configurePrism(userData, signal) {
  const dataRoot = await safeRoot(path.join(userData, 'providers', 'prism'));
  await writePrismConfig(dataRoot, signal);
  return dataRoot;
}

class PrismAccountBridge extends EventEmitter {
  constructor({ userData, bundledDirectory = path.join(__dirname, 'provider', 'prism'), packFile = path.join(__dirname, 'provider', 'packs', CLIENT_PACK.packFile), platform = process.platform, arch = process.arch, prepareEngine = ensurePrism, configure = configurePrism, spawnProcess = spawn } = {}) {
    super();
    this.userData = userData;
    this.bundledDirectory = bundledDirectory;
    this.packFile = packFile;
    this.platform = platform;
    this.arch = arch;
    this.prepareEngine = prepareEngine;
    this.configure = configure;
    this.spawnProcess = spawnProcess;
    this.active = false;
    this.child = null;
    this.revision = 0;
    this.state = { status: 'idle', error: null, pid: null, mode: null };
    this.completion = Promise.resolve();
  }

  snapshot() { return { ...this.state, active: this.active, revision: this.revision }; }
  emitState() { this.revision += 1; this.emit('change', this.snapshot()); }

  start() { return this.begin('accounts'); }

  importClientPack(packFile = this.packFile) { return this.begin('import', packFile); }

  importBorealClientPack(packFile) { return this.begin('import', packFile, BOREAL_PROFILE.eventId); }

  importBorealConstructorPack(packFile) { return this.begin('import', packFile, CONSTRUCTOR_PROFILE.eventId); }

  async launchClientProfile(offlineNickname = null) {
    if (this.active) throw new PrismError('BUSY');
    const profile = await this.findClientProfile();
    if (!profile) throw new PrismError('INSTANCE');
    return this.begin('launch', profile.instanceId, offlineNickname ? CLIENT_PACK.eventId : undefined, offlineNickname || undefined);
  }

  async launchBorealClientProfile(offlineNickname = null) {
    if (this.active) throw new PrismError('BUSY');
    const profile = await this.findBorealProfile();
    if (!profile) throw new PrismError('BOREAL_INSTANCE');
    return this.begin('launch', profile.instanceId, BOREAL_PROFILE.eventId, offlineNickname || undefined);
  }

  async launchBorealConstructorProfile(offlineNickname = null) {
    if (this.active) throw new PrismError('BUSY');
    const profile = await this.findBorealConstructorProfile();
    if (!profile) throw new PrismError('CONSTRUCTOR_INSTANCE');
    return this.begin('launch', profile.instanceId, CONSTRUCTOR_PROFILE.eventId, offlineNickname || undefined);
  }

  async findClientProfile() {
    if (!this.userData) throw new PrismError('PROFILE');
    const dataRoot = await this.configure(this.userData);
    const instances = path.join(dataRoot, 'instances');
    let entries;
    try { entries = await fs.readdir(instances, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new PrismError('PROFILE'); }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || /[\\/\x00-\x1f]/.test(entry.name)) continue;
      const candidates = [
        `instances/${entry.name}/.minecraft/${CLIENT_PACK.markerFile}`,
        `instances/${entry.name}/${CLIENT_PACK.markerFile}`
      ];
      for (const relative of candidates) {
        try {
          const markerPath = await readPath(dataRoot, relative);
          const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
          if (marker.schema === 1 && marker.eventId === 'gdc7' && marker.profileId === CLIENT_PACK.id && marker.version === CLIENT_PACK.version && marker.minecraft === CLIENT_PACK.minecraft && marker.loader === CLIENT_PACK.loaderVersion) {
            const instancePath = path.join(instances, entry.name);
            return { instanceId: entry.name, path: instancePath, minecraftPath: path.join(instancePath, '.minecraft'), profileRelease: marker.profileRelease || CLIENT_PACK.version };
          }
        } catch (error) {
          if (error.code !== 'ENOENT') continue;
        }
      }
    }
    return null;
  }

  async findBorealProfile() {
    if (!this.userData) throw new PrismError('PROFILE');
    const dataRoot = await this.configure(this.userData);
    const instances = path.join(dataRoot, 'instances');
    let entries;
    try { entries = await fs.readdir(instances, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new PrismError('PROFILE'); }
    const matches = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || /[\\/\x00-\x1f]/.test(entry.name)) continue;
      for (const relative of [
        `instances/${entry.name}/minecraft/${BOREAL_PROFILE.markerFile}`,
        `instances/${entry.name}/.minecraft/${BOREAL_PROFILE.markerFile}`,
        `instances/${entry.name}/${BOREAL_PROFILE.markerFile}`
      ]) {
        try {
          const markerPath = await readPath(dataRoot, relative);
          const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
          const version = marker.profileRelease || marker.version;
          if (marker.schema === 1 && marker.eventId === BOREAL_PROFILE.eventId && marker.profileId === BOREAL_PROFILE.id && typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) && marker.minecraft === BOREAL_PROFILE.minecraft && marker.loader === BOREAL_PROFILE.loaderVersion) {
            const instancePath = path.join(instances, entry.name);
            const minecraftPath = relative.startsWith(`instances/${entry.name}/minecraft/`)
              ? path.join(instancePath, 'minecraft')
              : path.join(instancePath, '.minecraft');
            matches.push({ instanceId: entry.name, path: instancePath, minecraftPath, profileRelease: version });
          }
        } catch (error) { if (error.code !== 'ENOENT') continue; }
      }
    }
    matches.sort((left, right) => compareVersions(right.profileRelease, left.profileRelease) || left.instanceId.localeCompare(right.instanceId));
    return matches[0] || null;
  }

  async findBorealConstructorProfile() {
    if (!this.userData) throw new PrismError('PROFILE');
    const dataRoot = await this.configure(this.userData);
    const instances = path.join(dataRoot, 'instances');
    let entries;
    try { entries = await fs.readdir(instances, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new PrismError('PROFILE'); }
    const matches = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || /[\\/\x00-\x1f]/.test(entry.name)) continue;
      for (const relative of [
        `instances/${entry.name}/.minecraft/${CONSTRUCTOR_PROFILE.markerFile}`,
        `instances/${entry.name}/${CONSTRUCTOR_PROFILE.markerFile}`
      ]) {
        try {
          const markerPath = await readPath(dataRoot, relative);
          const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
          const version = marker.profileRelease || marker.version;
          if (marker.schema === 1 && marker.eventId === CONSTRUCTOR_PROFILE.eventId && marker.profileId === CONSTRUCTOR_PROFILE.id && typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version) && marker.minecraft === CONSTRUCTOR_PROFILE.minecraft && marker.loader === CONSTRUCTOR_PROFILE.loaderVersion) {
            const instancePath = path.join(instances, entry.name);
            matches.push({ instanceId: entry.name, path: instancePath, minecraftPath: path.join(instancePath, '.minecraft'), profileRelease: version });
          }
        } catch (error) { if (error.code !== 'ENOENT') continue; }
      }
    }
    matches.sort((left, right) => compareVersions(right.profileRelease, left.profileRelease) || left.instanceId.localeCompare(right.instanceId));
    return matches[0] || null;
  }

  async waitForImportedBorealProfile(eventId, timeoutMs = 120000) {
    const findProfile = eventId === BOREAL_PROFILE.eventId
      ? () => this.findBorealProfile()
      : eventId === CONSTRUCTOR_PROFILE.eventId
        ? () => this.findBorealConstructorProfile()
        : null;
    if (!findProfile) return null;
    const deadline = Date.now() + timeoutMs;
    do {
      const profile = await findProfile();
      if (profile) return profile;
      if (Date.now() >= deadline) return null;
      await new Promise(resolve => setTimeout(resolve, 500));
    } while (true);
  }

  async instancesDirectory() {
    if (!this.userData) throw new PrismError('PROFILE');
    const dataRoot = await this.configure(this.userData);
    return safeRoot(path.join(dataRoot, 'instances'));
  }

  async dataDirectory() {
    if (!this.userData) throw new PrismError('PROFILE');
    return this.configure(this.userData);
  }

  begin(mode, value, eventId, offlineNickname) {
    if (this.active) throw new PrismError('BUSY');
    const support = supportsPrismAccounts(this.platform, this.arch);
    if (!support.supported) throw new PrismError('UNSUPPORTED');
    if (!this.userData) throw new PrismError('PROFILE');
    if (!['accounts', 'import', 'launch'].includes(mode)) throw new PrismError('PROFILE');
    this.active = true;
    this.state = { status: 'preparing', error: null, pid: null, mode, ...(eventId ? { eventId } : {}) };
    this.emitState();
    this.completion = this.run(mode, value, eventId, offlineNickname);
    return this.snapshot();
  }

  async run(mode, value, eventId, offlineNickname) {
    const eventState = eventId ? { eventId } : {};
    try {
      const engine = await this.prepareEngine(this.userData, this.bundledDirectory);
      const dataRoot = await this.configure(this.userData);
      const selectedPack = mode === 'import' ? value || this.packFile : null;
      if (mode === 'import') {
        const selectedPath = path.resolve(selectedPack);
        const isInside = root => {
          const relative = path.relative(path.resolve(root), selectedPath);
          return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
        };
        const isBundledPack = selectedPack === this.packFile;
        const isInsidePrism = isInside(dataRoot);
        const isVerifiedBorealCache = [BOREAL_PROFILE.eventId, CONSTRUCTOR_PROFILE.eventId].includes(eventId)
          && isInside(path.join(this.userData, 'profiles', eventId, 'downloads'));
        if (!path.isAbsolute(selectedPack) || !isBundledPack && !isInsidePrism && !isVerifiedBorealCache) throw new PrismError('PACK');
        const pack = await fs.lstat(selectedPack);
        if (!pack.isFile() || pack.isSymbolicLink() || pack.nlink !== 1) throw new PrismError('PACK');
      }
      const args = mode === 'launch' && offlineNickname
        ? prismArguments(dataRoot, mode, value, offlineNickname)
        : prismArguments(dataRoot, mode, mode === 'import' ? selectedPack : value);
      const child = this.spawnProcess(engine.executable, args, {
        cwd: engine.engine,
        shell: false,
        windowsHide: false,
        detached: false,
        stdio: 'ignore'
      });
      this.child = child;
      const spawned = new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', () => reject(new PrismError('SPAWN')));
      });
      const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
      await spawned;
      this.state = { status: 'running', error: null, pid: Number.isInteger(child.pid) ? child.pid : null, mode, ...eventState };
      this.emitState();
      const result = await closed;
      if (result.code !== 0 || result.signal) {
        const errorCode = mode === 'import' && eventId === BOREAL_PROFILE.eventId ? 'BOREAL_IMPORT_EXIT' : 'EXIT';
        this.state = { status: 'error', error: new PrismError(errorCode).message, pid: null, mode, ...eventState };
      }
      else if (mode === 'import' && [BOREAL_PROFILE.eventId, CONSTRUCTOR_PROFILE.eventId].includes(eventId)) {
        this.state = { status: 'running', error: null, pid: null, mode, ...eventState };
        this.emitState();
        const installed = await this.waitForImportedBorealProfile(eventId);
        this.state = installed
          ? { status: 'closed', error: null, pid: null, mode, ...eventState }
          : { status: 'error', error: new PrismError('IMPORT_TIMEOUT').message, pid: null, mode, ...eventState };
      } else this.state = { status: 'closed', error: null, pid: null, mode, ...eventState };
    } catch (error) {
      this.state = { status: 'error', error: error instanceof PrismError ? error.message : new PrismError('ENGINE').message, pid: null, mode, ...eventState };
    } finally {
      this.child = null;
      this.active = false;
      this.emitState();
    }
    return this.snapshot();
  }

  async shutdown() {
    if (this.child) throw new PrismError('BUSY');
    await this.completion;
  }
}

module.exports = { PRISM, PrismError, PrismAccountBridge, accountArguments, prismArguments, patchPrismConfig, supportsPrismAccounts, ensurePrism, configurePrism };
