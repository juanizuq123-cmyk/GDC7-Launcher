'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { validateBorealProfileManifest, BOREAL_PROFILE, BorealProfileUpdater } = require('../boreal-profile.cjs');
const { PrismAccountBridge } = require('../prism-account.cjs');
const { createHash } = require('node:crypto');
const { BorealConstructorProfileUpdater, CONSTRUCTOR_PROFILE, validateBorealConstructorManifest } = require('../boreal-constructor.cjs');
const oldKeys = require('../update-keys.cjs');
const { validUrl } = require('../update-http.cjs');
const { signManifest } = require('../tools/sign-boreal-profile-manifest.cjs');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const channelUrl = 'https://profiles.example.test/estacion-boreal/stable.json';
const releaseRepository = 'example/estacion-boreal';

function manifest(overrides = {}) {
  return {
    schema: 1,
    eventId: 'estacion-boreal',
    channel: 'stable',
    releaseId: '0.1.0',
    minLauncherVersion: '0.1.0',
    target: {
      minecraft: '26.1.2',
      loader: 'neoforge',
      loaderVersion: '26.1.2.95',
      javaMajor: 25,
      installSide: 'client'
    },
    installPack: {
      url: 'https://github.com/example/estacion-boreal/releases/download/estacion-boreal-0.1.0/Estacion-Boreal-Client-0.1.0.mrpack',
      filename: 'Estacion-Boreal-Client-0.1.0.mrpack',
      size: 1234,
      sha256: 'a'.repeat(64)
    },
    modCount: 1,
    notes: 'Perfil visual de prueba.',
    ...overrides
  };
}

function signed(value) { return signManifest(value, privateKey); }

test('Boreal channel validates a signed manifest for its exact independent target', () => {
  const checked = validateBorealProfileManifest(signed(manifest()), publicPem, { channelUrl, releaseRepository });
  assert.equal(checked.manifest.eventId, 'estacion-boreal');
  assert.equal(checked.manifest.target.minecraft, BOREAL_PROFILE.minecraft);
  assert.equal(checked.channelUrl, channelUrl);
  assert.match(checked.manifestSha256, /^[a-f0-9]{64}$/);
});

test('Boreal channel rejects GDC7 event identity and a signature from another key', () => {
  assert.throws(() => validateBorealProfileManifest(signed(manifest({ eventId: 'gdc7' })), publicPem, { channelUrl, releaseRepository }), /Estación Boreal/i);
  assert.throws(() => validateBorealProfileManifest(signed(manifest()), oldKeys.profile, { channelUrl, releaseRepository }), /firma/i);
});

test('Boreal channel rejects target drift and non-HTTPS or unscoped pack URLs', () => {
  assert.throws(() => validateBorealProfileManifest(signed(manifest({ target: { ...manifest().target, minecraft: '26.2' } })), publicPem, { channelUrl, releaseRepository }), /objetivo/i);
  const invalidPack = { ...manifest().installPack, url: 'http://github.com/example/estacion-boreal/releases/download/estacion-boreal-0.1.0/file.mrpack' };
  assert.throws(() => validateBorealProfileManifest(signed(manifest({ installPack: invalidPack })), publicPem, { channelUrl, releaseRepository }), /pack/i);
});

test('Boreal trusted download hosts stay separate from the GDC7 allowlist', () => {
  const borealHosts = new Set(['profiles.example.test', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
  assert.throws(() => validUrl('https://gdc7-host.example.test/channel.json', borealHosts), /origen no permitido/i);
  assert.throws(() => validateBorealProfileManifest(signed(manifest()), publicPem, { channelUrl: 'https://gdc7.example.test/channel.json', releaseRepository }), /HTTPS.*separada/i);
  assert.doesNotThrow(() => validUrl(channelUrl, borealHosts));
});

test('Boreal release key is separate from both existing GDC7 public keys', () => {
  const borealKeys = require('../boreal-channel.cjs');
  assert.notEqual(borealKeys.publicKey, oldKeys.profile);
  assert.notEqual(borealKeys.publicKey, oldKeys.launcher);
  assert.equal(borealKeys.eventId, 'estacion-boreal');
});

test('Prism discovers only the exact Boreal marker in its separate instance', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'boreal-prism-marker-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const dataRoot = path.join(temp, 'prism');
  const instanceName = 'Estación Boreal · Perfil visual de prueba';
  const markerPath = path.join(dataRoot, 'instances', instanceName, '.minecraft', BOREAL_PROFILE.markerFile);
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  await fs.writeFile(markerPath, JSON.stringify({
    schema: 1, eventId: 'estacion-boreal', profileId: BOREAL_PROFILE.id,
    version: BOREAL_PROFILE.version, minecraft: BOREAL_PROFILE.minecraft,
    loader: BOREAL_PROFILE.loaderVersion
  }));
  const bridge = new PrismAccountBridge({ userData: temp, configure: async () => dataRoot });
  const found = await bridge.findBorealProfile();
  assert.equal(found.instanceId, instanceName);
  assert.equal(found.path, path.join(dataRoot, 'instances', instanceName));
  assert.equal(await bridge.findClientProfile(), null);
});

test('Boreal updater falls back to the bundled verified client profile until its independent channel is configured', async () => {
  const updater = new BorealProfileUpdater({ channelUrl: null, releaseRepository: null });
  const state = await updater.check();
  assert.equal(state.status, 'ready-to-install');
  assert.equal(state.latestVersion, BOREAL_PROFILE.version);
  assert.equal(state.source, 'bundled');
  assert.equal(await updater.installPackPath(), require('node:path').join(__dirname, '..', 'provider', 'packs', BOREAL_PROFILE.packFile));
});

test('Boreal updater downloads only a signed pack into its own Prism cache', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'boreal-profile-cache-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const artifactBytes = Buffer.from('boreal test profile artifact');
  const artifactHash = createHash('sha256').update(artifactBytes).digest('hex');
  const signedManifest = signed(manifest({
    installPack: {
      ...manifest().installPack,
      size: artifactBytes.length,
      sha256: artifactHash
    }
  }));
  let requestedHosts = [];
  let downloadHosts = [];
  let requestedUserAgent = null;
  const updater = new BorealProfileUpdater({
    channelUrl,
    releaseRepository,
    publicKey: publicPem,
    userData: temp,
    request: async (_url, options) => { requestedHosts = options.trustedHosts; requestedUserAgent = options.userAgent; return signedManifest; },
    download: async (_url, destination, options) => { downloadHosts = options.trustedHosts; await fs.writeFile(destination, artifactBytes); },
    onChange: () => {}
  });
  const result = await updater.check();
  assert.equal(result.status, 'ready-to-install');
  const packPath = await updater.installPackPath();
  assert.match(packPath, /profiles[\\/]estacion-boreal[\\/]downloads[\\/]0\.1\.0[\\/]/i);
  assert.doesNotMatch(packPath, /\.gdc7/i);
  assert.ok(requestedHosts.includes('profiles.example.test'));
  assert.ok(downloadHosts.includes('github.com'));
  assert.equal(requestedUserAgent, 'EstacionBoreal-Launcher/1');
  assert.deepEqual(await fs.readFile(packPath), artifactBytes);
});

function constructorManifest(overrides = {}) {
  return {
    schema: 1,
    eventId: 'boreal-constructor',
    channel: 'stable',
    releaseId: '0.1.0',
    minLauncherVersion: '0.1.0',
    target: { minecraft: '26.1.2', loader: 'neoforge', loaderVersion: '26.1.2.95', javaMajor: 25, installSide: 'client' },
    installPack: {
      url: 'https://github.com/example/estacion-boreal/releases/download/boreal-constructor-0.1.0/Boreal-Constructor-Client-0.1.0.mrpack',
      filename: 'Boreal-Constructor-Client-0.1.0.mrpack', size: 1234, sha256: 'a'.repeat(64)
    },
    modCount: CONSTRUCTOR_PROFILE.modCount,
    notes: 'Boreal Constructor: perfil separado de construcción.',
    ...overrides
  };
}

test('Boreal Constructor accepts only its signed client manifest and exact 26.1.2 NeoForge target', () => {
  const checked = validateBorealConstructorManifest(signed(constructorManifest()), publicPem, { channelUrl, releaseRepository });
  assert.equal(checked.manifest.eventId, 'boreal-constructor');
  assert.equal(checked.manifest.target.loaderVersion, '26.1.2.95');
  assert.throws(() => validateBorealConstructorManifest(signed(constructorManifest({ eventId: 'gdc7' })), publicPem, { channelUrl, releaseRepository }), /Boreal Constructor/i);
  assert.throws(() => validateBorealConstructorManifest(signed(constructorManifest({ target: { ...constructorManifest().target, minecraft: '1.21.11' } })), publicPem, { channelUrl, releaseRepository }), /objetivo/i);
  assert.throws(() => validateBorealConstructorManifest(signed(constructorManifest()), oldKeys.profile, { channelUrl, releaseRepository }), /firma/i);
});

test('clean and previous installs get the signed Boreal Constructor profile through the cache without touching worlds or settings', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'boreal-constructor-update-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const saves = path.join(temp, 'instances', 'Boreal Constructor', '.minecraft', 'saves', 'Mi mundo');
  const settings = path.join(temp, 'settings.json');
  await fs.mkdir(saves, { recursive: true });
  await fs.writeFile(path.join(saves, 'level.dat'), 'world-data');
  await fs.writeFile(settings, '{"ramMb":6144,"selectedEventId":"gdc7"}\n');

  const artifactBytes = Buffer.from('signed constructor profile package');
  const artifactHash = createHash('sha256').update(artifactBytes).digest('hex');
  const feed = signed(constructorManifest({ installPack: { ...constructorManifest().installPack, size: artifactBytes.length, sha256: artifactHash } }));
  let installedVersion = null;
  let downloadUrl = null;
  const updater = new BorealConstructorProfileUpdater({
    channelUrl,
    releaseRepository,
    publicKey: publicPem,
    userData: temp,
    prismBridge: { findBorealConstructorProfile: async () => installedVersion ? { profileRelease: installedVersion } : null },
    request: async () => feed,
    download: async (url, destination, options) => { downloadUrl = url; assert.ok(options.trustedHosts.includes('github.com')); await fs.writeFile(destination, artifactBytes); }
  });

  const cleanState = await updater.check();
  assert.equal(cleanState.status, 'ready-to-install');
  assert.equal(cleanState.latestVersion, '0.1.0');
  assert.match(downloadUrl, /boreal-constructor-0\.1\.0/);
  const downloaded = await updater.installPackPath();
  assert.deepEqual(await fs.readFile(downloaded), artifactBytes);

  installedVersion = '0.1.0';
  const previousInstallState = await updater.check();
  assert.equal(previousInstallState.status, 'current');
  assert.equal(await fs.readFile(path.join(saves, 'level.dat'), 'utf8'), 'world-data');
  assert.equal(await fs.readFile(settings, 'utf8'), '{"ramMb":6144,"selectedEventId":"gdc7"}\n');
});

test('invalid signatures and failed pack verification never overwrite a prior constructor cache or user files', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'boreal-constructor-fail-safe-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const profileDir = path.join(temp, 'profiles', 'boreal-constructor', 'downloads', '0.1.0');
  await fs.mkdir(profileDir, { recursive: true });
  const cachedPack = path.join(profileDir, 'Boreal-Constructor-Client-0.1.0.mrpack');
  await fs.writeFile(cachedPack, 'old verified pack bytes stay in place');
  const world = path.join(temp, 'saves', 'Keep', 'level.dat');
  await fs.mkdir(path.dirname(world), { recursive: true });
  await fs.writeFile(world, 'keep this world');
  const config = path.join(temp, 'settings.json');
  await fs.writeFile(config, 'keep this setting');

  const signatureFailure = new BorealConstructorProfileUpdater({ channelUrl, releaseRepository, publicKey: oldKeys.profile, userData: temp, request: async () => signed(constructorManifest()) });
  assert.equal((await signatureFailure.check()).status, 'unavailable');
  assert.equal(await fs.readFile(cachedPack, 'utf8'), 'old verified pack bytes stay in place');

  const requested = signed(constructorManifest());
  const hashFailure = new BorealConstructorProfileUpdater({
    channelUrl, releaseRepository, publicKey: publicPem, userData: temp,
    request: async () => requested,
    download: async (_url, destination) => fs.writeFile(destination, 'invalid bytes')
  });
  assert.equal((await hashFailure.check()).status, 'unavailable');
  assert.equal(await fs.readFile(cachedPack, 'utf8'), 'old verified pack bytes stay in place');
  assert.equal(await fs.readFile(world, 'utf8'), 'keep this world');
  assert.equal(await fs.readFile(config, 'utf8'), 'keep this setting');
});
