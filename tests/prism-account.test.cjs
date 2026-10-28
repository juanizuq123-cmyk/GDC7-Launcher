'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PRISM, accountArguments, prismArguments, patchPrismConfig, supportsPrismAccounts, PrismAccountBridge, ensurePrism } = require('../prism-account.cjs');
const { CLIENT_PACK } = require('../client-pack.cjs');
const { BOREAL_PROFILE } = require('../boreal-profile.cjs');

test('Prism account bridge uses the official bundle already audited in the old launcher', () => {
  assert.equal(PRISM.version, '11.1.1');
  assert.equal(PRISM.archive, 'PrismLauncher-Windows-MinGW-w64-Portable-11.1.1.zip');
  assert.equal(PRISM.size, 43687692);
  assert.equal(PRISM.sha256, '05841d0b3bfc0a8212658457cc6035e1c29cd7ffae919464e874e384cbe8d062');
});

test('Prism prepares its verified executable in a clean data directory', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gdc7-prism-engine-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const result = await ensurePrism(temp, path.join(__dirname, '..', 'provider', 'prism'));
  assert.equal(path.basename(result.executable), 'prismlauncher.exe');
  assert.equal((await fs.stat(result.executable)).isFile(), true);
});

test('Prism CLI keeps account, import, and launch actions scoped to the isolated data root', () => {
  assert.deepEqual(accountArguments('C:\\Users\\Player\\PrismData'), ['--dir', 'C:\\Users\\Player\\PrismData', '--show-window']);
  assert.deepEqual(prismArguments('C:\\Prism', 'import', 'C:\\Launcher\\profile.mrpack'), ['--dir', 'C:\\Prism', '--import', 'C:\\Launcher\\profile.mrpack']);
  assert.deepEqual(prismArguments('C:\\Prism', 'launch', CLIENT_PACK.name), ['--dir', 'C:\\Prism', '--launch', CLIENT_PACK.name]);
  assert.throws(() => prismArguments('C:\\Prism', 'launch', '..\\outside'), { code: 'PROFILE' });
  assert.deepEqual(supportsPrismAccounts('win32', 'x64'), { supported: true, message: null });
  assert.equal(supportsPrismAccounts('win32', 'arm64').supported, false);
});

test('Prism discovers only the exact imported GDC7 client profile marker', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gdc7-prism-marker-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const dataRoot = path.join(temp, 'data');
  const markerFile = path.basename(CLIENT_PACK.markerFile);
  const instanceRoot = path.join(dataRoot, 'instances', CLIENT_PACK.name, '.minecraft', 'config');
  const otherRoot = path.join(dataRoot, 'instances', 'Other', '.minecraft', 'config');
  await fs.mkdir(instanceRoot, { recursive: true });
  await fs.mkdir(otherRoot, { recursive: true });
  await fs.writeFile(path.join(instanceRoot, markerFile), JSON.stringify({
    schema: 1,
    eventId: 'gdc7',
    profileId: CLIENT_PACK.id,
    version: CLIENT_PACK.version,
    minecraft: CLIENT_PACK.minecraft,
    loader: CLIENT_PACK.loaderVersion
  }));
  await fs.writeFile(path.join(otherRoot, markerFile), JSON.stringify({ schema: 1, eventId: 'other' }));
  const bridge = new PrismAccountBridge({ userData: path.join(temp, 'launcher'), configure: async () => dataRoot });
  assert.deepEqual(await bridge.findClientProfile(), {
    instanceId: CLIENT_PACK.name,
    path: path.join(dataRoot, 'instances', CLIENT_PACK.name),
    minecraftPath: path.join(dataRoot, 'instances', CLIENT_PACK.name, '.minecraft'),
    profileRelease: CLIENT_PACK.version
  });
});

test('Prism discovers the newest Boreal profile release without crossing into GDC7', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'boreal-prism-releases-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const dataRoot = path.join(temp, 'data');
  for (const [instance, version] of [['Estación Boreal 0.1.0', '0.1.0'], ['Estación Boreal 0.2.0', '0.2.0']]) {
    const file = path.join(dataRoot, 'instances', instance, 'minecraft', BOREAL_PROFILE.markerFile);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({
      schema: 1, eventId: BOREAL_PROFILE.eventId, profileId: BOREAL_PROFILE.id,
      version, profileRelease: version, minecraft: BOREAL_PROFILE.minecraft,
      loader: BOREAL_PROFILE.loaderVersion
    }));
  }
  const bridge = new PrismAccountBridge({ userData: path.join(temp, 'launcher'), configure: async () => dataRoot });
  const found = await bridge.findBorealProfile();
  assert.equal(found.instanceId, 'Estación Boreal 0.2.0');
  assert.equal(found.profileRelease, '0.2.0');
  assert.equal(found.minecraftPath, path.join(dataRoot, 'instances', 'Estación Boreal 0.2.0', 'minecraft'));
  assert.equal(await bridge.findClientProfile(), null);
});

test('Boreal launch delegates to the selected authenticated Prism account and ignores offline-name settings', async () => {
  const bridge = new PrismAccountBridge({ userData: 'C:\\BorealTest' });
  bridge.findBorealProfile = async () => ({ instanceId: 'Estación Boreal 0.1.0' });
  bridge.begin = (...args) => args;
  assert.deepEqual(await bridge.launchBorealClientProfile(), ['launch', 'Estación Boreal 0.1.0', BOREAL_PROFILE.eventId, undefined]);
});

test('Prism imports, finds, and launches Boreal Constructor in its own authenticated instance', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'boreal-constructor-prism-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const dataRoot = path.join(temp, 'data');
  const markerFile = 'boreal-constructor-launcher-profile.json';
  const instance = 'Boreal Constructor 0.1.0';
  const markerPath = path.join(dataRoot, 'instances', instance, 'minecraft', 'config', markerFile);
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.writeFile(markerPath, JSON.stringify({ schema: 1, eventId: 'boreal-constructor', profileId: 'boreal-constructor-neoforge-client', version: '0.1.0', minecraft: '26.1.2', loader: '26.1.2.95' }));
  const bridge = new PrismAccountBridge({ userData: path.join(temp, 'launcher'), configure: async () => dataRoot });
  assert.equal((await bridge.findBorealConstructorProfile())?.instanceId, instance);
  bridge.begin = (...args) => args;
  assert.deepEqual(bridge.importBorealConstructorPack('constructor.mrpack'), ['import', 'constructor.mrpack', 'boreal-constructor']);
  assert.deepEqual(await bridge.launchBorealConstructorProfile(), ['launch', instance, 'boreal-constructor', undefined]);
});

test('Prism config updates only launcher-owned general settings and preserves other sections', () => {
  const original = '[General]\nLanguage=en_US\nTheme=light\n[Folders]\nMods=mods\n';
  const patched = patchPrismConfig(original, { ConfigVersion: '1.3', Language: 'es_ES', ApplicationTheme: 'dark' });
  assert.match(patched, /\[General\]\nConfigVersion="1\.3"\nLanguage="es_ES"\nApplicationTheme="dark"/);
  assert.match(patched, /\[Folders\]\nMods=mods/);
  assert.equal((patched.match(/\[General\]/g) || []).length, 1);
});

test('Prism config rejects line injection', () => {
  assert.throws(() => patchPrismConfig('', { Language: 'es_ES\n[Security]' }), { code: 'PROFILE' });
});

test('Prism config enables its managed Java version selection and download', () => {
  const patched = patchPrismConfig('');
  assert.match(patched, /AutomaticJavaSwitch=true/);
  assert.match(patched, /AutomaticJavaDownload=true/);
});
