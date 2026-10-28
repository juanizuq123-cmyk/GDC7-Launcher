'use strict';

const { verifyFile } = require('./file-safety.cjs');
const { createHash } = require('node:crypto');
const { verifyBorealManifestSignature } = require('./boreal-signature.cjs');

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_PACK_BYTES = 2 * 1024 * 1024 * 1024;

const CONSTRUCTOR_PROFILE = Object.freeze({
  eventId: 'boreal-constructor',
  id: 'boreal-constructor-neoforge-client',
  name: 'Boreal Constructor',
  version: '0.2.4',
  minecraft: '26.1.2',
  loader: 'NeoForge 26.1.2.95',
  loaderId: 'neoforge',
  loaderVersion: '26.1.2.95',
  javaMajor: 25,
  modCount: 2,
  mods: Object.freeze([
    Object.freeze({ id: 'borealexpedition', version: '0.2.4', file: 'borealexpedition-0.2.4.jar' }),
    Object.freeze({ id: 'worldedit', version: '7.4.3-beta-01', file: 'worldedit-mod-7.4.3-beta-01.jar' })
  ]),
  borealModSize: 9080548,
  borealModSha256: '72b6afc07479de6784bd155ea9c80574017c3460371a9d4a6f409b198f5486cd',
  worldeditSize: 5398033,
  worldeditSha256: '4c100499a87ca532a15135cd8349e6bdcc66498e1ff1ade3df8e332cdf95ceaa',
  worldeditSha512: 'a84f894c7d8ccc63aaa34a3d183fd7a8cf3cf80bcec7b00885bd1783b084519cbdfd64b645a4389553a7bec5d5eaf3c4b51dc18b4c1b943d7cc7e7e2eec792c2',
  packFile: 'Boreal-Constructor-Client-0.2.4.mrpack',
  packSize: 14076752,
  packSha256: 'aef1100dbadd218b544e6c2e81a7fd2b9a452114ce0dafb15f34d446d2e7ddc0',
  markerFile: 'config/boreal-constructor-launcher-profile.json'
});

function validateBorealConstructorManifest(bytes, publicKey, { channelUrl, releaseRepository } = {}) {
  let channel;
  try { channel = new URL(channelUrl); } catch { throw new Error('La URL del canal de Boreal Constructor no es válida.'); }
  if (channel.protocol !== 'https:' || channel.username || channel.password || channel.port || channel.search || channel.hash || /gdc7/i.test(channel.hostname) || /gdc7/i.test(channel.pathname)) {
    throw new Error('El canal debe ser HTTPS e independiente de GDC7.');
  }
  if (typeof releaseRepository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(releaseRepository) || /gdc7/i.test(releaseRepository)) {
    throw new Error('El repositorio de Boreal Constructor debe ser propio y separado de GDC7.');
  }
  const document = verifyBorealManifestSignature(bytes, publicKey);
  if (document.schema !== 1 || document.eventId !== CONSTRUCTOR_PROFILE.eventId || document.channel !== 'stable' || !SEMVER.test(document.releaseId) || !SEMVER.test(document.minLauncherVersion || '0.0.0')) {
    throw new Error('El manifiesto no corresponde al canal estable de Boreal Constructor.');
  }
  const target = document.target;
  if (!target || target.minecraft !== CONSTRUCTOR_PROFILE.minecraft || target.loader !== CONSTRUCTOR_PROFILE.loaderId || target.loaderVersion !== CONSTRUCTOR_PROFILE.loaderVersion || target.javaMajor !== CONSTRUCTOR_PROFILE.javaMajor || target.installSide !== 'client') {
    throw new Error('El manifiesto de Boreal Constructor no declara el objetivo cliente aprobado.');
  }
  const pack = document.installPack;
  if (!pack || typeof pack !== 'object' || !Number.isSafeInteger(pack.size) || pack.size < 1 || pack.size > MAX_PACK_BYTES || !/^[a-f0-9]{64}$/.test(pack.sha256 || '') || !/^Boreal-Constructor-Client-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.mrpack$/.test(pack.filename || '')) {
    throw new Error('El pack firmado de Boreal Constructor no es válido.');
  }
  let artifact;
  try { artifact = new URL(pack.url); } catch { throw new Error('La URL del pack de Boreal Constructor no es válida.'); }
  const releasePrefix = `/${releaseRepository}/releases/download/boreal-constructor-${document.releaseId}/`;
  if (artifact.protocol !== 'https:' || artifact.hostname !== 'github.com' || !artifact.pathname.startsWith(releasePrefix) || artifact.pathname.slice(releasePrefix.length) !== pack.filename || artifact.search || artifact.hash) {
    throw new Error('El pack no pertenece a la release independiente de Boreal Constructor declarada.');
  }
  if (document.modCount !== CONSTRUCTOR_PROFILE.modCount || typeof document.notes !== 'string' || document.notes.length > 10000) {
    throw new Error('El manifiesto de Boreal Constructor está incompleto o no coincide con sus mods.');
  }
  return { manifest: document, manifestSha256: createHash('sha256').update(bytes).digest('hex'), channelUrl: channel.toString() };
}

function compareVersions(left, right) {
  const tuple = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value || '');
    return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] || ''] : [0, 0, 0, ''];
  };
  const a = tuple(left), b = tuple(right);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  if (a[3] === b[3]) return 0;
  if (!a[3]) return 1;
  if (!b[3]) return -1;
  return a[3].localeCompare(b[3]);
}

class BorealConstructorProfileUpdater {
  constructor({ channelUrl, releaseRepository, publicKey, userData, prismBridge, bundledPackPath, request, download, onChange } = {}) {
    const channel = require('./boreal-channel.cjs');
    this.channelUrl = channelUrl === undefined ? channel.constructorChannelUrl : channelUrl;
    this.releaseRepository = releaseRepository === undefined ? channel.releaseRepository : releaseRepository;
    this.publicKey = publicKey || channel.publicKey;
    this.userData = userData;
    this.prismBridge = prismBridge || null;
    this.bundledPackPath = bundledPackPath || require('node:path').join(__dirname, 'provider', 'packs', CONSTRUCTOR_PROFILE.packFile);
    this.request = request || require('./update-http.cjs').getBytes;
    this.download = download || require('./update-http.cjs').downloadToFile;
    this.onChange = onChange || (() => {});
    this.state = { status: 'idle', currentVersion: null, latestVersion: CONSTRUCTOR_PROFILE.version, modCount: CONSTRUCTOR_PROFILE.modCount, progress: 0, notes: '', error: null };
    this.verified = false;
    this.latestPackPath = null;
    this.latestManifest = null;
  }

  snapshot() { return { ...this.state }; }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.snapshot());
  }

  async check(signal) {
    this.set({ status: 'checking', error: null, progress: 0 });
    try {
      if (this.channelUrl && this.releaseRepository) return await this.checkChannel(signal);
      await verifyFile(this.bundledPackPath, { size: CONSTRUCTOR_PROFILE.packSize, hashes: { sha256: CONSTRUCTOR_PROFILE.packSha256 } }, signal);
      const installed = await this.prismBridge?.findBorealConstructorProfile().catch(() => null);
      const currentVersion = installed?.profileRelease || null;
      const isCurrent = currentVersion && compareVersions(currentVersion, CONSTRUCTOR_PROFILE.version) >= 0;
      this.verified = true;
      this.latestPackPath = this.bundledPackPath;
      this.latestManifest = null;
      this.set({ status: isCurrent ? 'current' : 'ready-to-install', currentVersion, latestVersion: CONSTRUCTOR_PROFILE.version, modCount: CONSTRUCTOR_PROFILE.modCount, progress: 100, notes: 'WorldEdit 7.4.3-beta-01 solo está en Boreal Constructor.', error: null });
    } catch (error) {
      this.verified = false;
      this.latestPackPath = null;
      this.set({ status: 'unavailable', error: error?.message || (error?.code === 'ENOENT' ? 'Falta el paquete local Boreal Constructor.' : 'No se pudo verificar Boreal Constructor.') });
    }
    return this.snapshot();
  }

  async checkChannel(signal) {
    try {
      const trustedHosts = [new URL(this.channelUrl).hostname, 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
      const requestOptions = { maxBytes: 4 * 1024 * 1024, signal, trustedHosts, userAgent: 'BorealConstructor-Launcher/1' };
      const bytes = await this.request(this.channelUrl, requestOptions);
      const checked = validateBorealConstructorManifest(bytes, this.publicKey, { channelUrl: this.channelUrl, releaseRepository: this.releaseRepository });
      if (compareVersions(require('./package.json').version, checked.manifest.minLauncherVersion) < 0) throw new Error(`Boreal Constructor necesita un launcher ${checked.manifest.minLauncherVersion} o posterior.`);
      if (!this.userData) throw new Error('No hay una carpeta privada de Prism para descargar Boreal Constructor.');
      const path = require('node:path');
      const fs = require('node:fs/promises');
      const { randomUUID } = require('node:crypto');
      const { safeRoot } = require('./file-safety.cjs');
      const { verifyFile: verify } = require('./file-safety.cjs');
      const pack = checked.manifest.installPack;
      const directory = await safeRoot(path.join(this.userData, 'profiles', 'boreal-constructor', 'downloads', checked.manifest.releaseId));
      const destination = path.join(directory, pack.filename);
      const expected = { size: pack.size, hashes: { sha256: pack.sha256 } };
      try { await verify(destination, expected, signal); }
      catch (error) {
        if (!['ENOENT', 'SIZE_MISMATCH', 'HASH_MISMATCH'].includes(error.code)) throw error;
        const temporary = path.join(directory, `${pack.filename}.${randomUUID()}.part`);
        try {
          await this.download(pack.url, temporary, { ...requestOptions, maxBytes: pack.size });
          await verify(temporary, expected, signal);
          await fs.rename(temporary, destination);
        } catch (downloadError) { await fs.rm(temporary, { force: true }); throw downloadError; }
      }
      this.latestPackPath = destination;
      this.latestManifest = checked.manifest;
      const installed = await this.prismBridge?.findBorealConstructorProfile().catch(() => null);
      const currentVersion = installed?.profileRelease || null;
      const isCurrent = currentVersion && compareVersions(currentVersion, checked.manifest.releaseId) >= 0;
      this.verified = true;
      this.set({ status: isCurrent ? 'current' : 'ready-to-install', currentVersion, latestVersion: checked.manifest.releaseId, modCount: checked.manifest.modCount, progress: 100, notes: checked.manifest.notes, error: null, manifestSha256: checked.manifestSha256, source: 'channel' });
      return this.snapshot();
    } catch (error) {
      this.verified = false;
      this.set({ status: 'unavailable', error: error?.message || 'No se pudo verificar el canal de Boreal Constructor.' });
      return this.snapshot();
    }
  }

  async installPackPath() {
    if (!this.verified) throw new Error('El paquete Boreal Constructor todavía no está verificado.');
    if (!this.latestPackPath) throw new Error('No hay un paquete Boreal Constructor descargado y verificado.');
    if (this.latestManifest) {
      const pack = this.latestManifest.installPack;
      await verifyFile(this.latestPackPath, { size: pack.size, hashes: { sha256: pack.sha256 } });
    } else {
      await verifyFile(this.latestPackPath, { size: CONSTRUCTOR_PROFILE.packSize, hashes: { sha256: CONSTRUCTOR_PROFILE.packSha256 } });
    }
    return this.latestPackPath;
  }
}

module.exports = { CONSTRUCTOR_PROFILE, BorealConstructorProfileUpdater, validateBorealConstructorManifest, compareVersions, MAX_PACK_BYTES };
