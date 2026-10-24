'use strict';

const { createHash } = require('node:crypto');
const { verifyBorealManifestSignature } = require('./boreal-signature.cjs');

const BOREAL_PROFILE = Object.freeze({
  eventId: 'estacion-boreal',
  id: 'estacion-boreal-neoforge-client',
  name: 'Estación Boreal',
  version: '0.1.0',
  minecraft: '26.1.2',
  loader: 'NeoForge 26.1.2.95',
  loaderId: 'neoforge',
  loaderVersion: '26.1.2.95',
  javaMajor: 25,
  modCount: 1,
  modId: 'borealexpedition',
  modVersion: '0.1.0',
  modFile: 'borealexpedition-0.1.0.jar',
  modSize: 557049,
  modSha256: '724911bf152710212cfc5f23561cf0467d56aa9882e7a0de2058e7903ad9bc84',
  packFile: 'Estacion-Boreal-Client-0.1.0.mrpack',
  packSize: 539267,
  packSha256: 'ed73ce0ed47f00203068f5ffe52336c33c5d337c480d212f084fbb4baac61c15',
  markerFile: 'config/estacion-boreal-launcher-profile.json'
});

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_PACK_BYTES = 2 * 1024 * 1024 * 1024;

function validateChannelUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('La URL del canal de Estación Boreal no es válida.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || /gdc7/i.test(url.hostname) || /gdc7/i.test(url.pathname)) {
    throw new Error('La URL del canal debe ser HTTPS y estar separada del perfil GDC7.');
  }
  return url;
}

function validateBorealProfileManifest(bytes, publicKey, { channelUrl, releaseRepository } = {}) {
  const channel = validateChannelUrl(channelUrl);
  if (typeof releaseRepository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(releaseRepository) || /gdc7/i.test(releaseRepository)) {
    throw new Error('El repositorio de releases de Boreal debe ser propio y estar separado de GDC7.');
  }
  const document = verifyBorealManifestSignature(bytes, publicKey);
  if (document.schema !== 1 || document.eventId !== 'estacion-boreal' || document.channel !== 'stable' || !SEMVER.test(document.releaseId) || !SEMVER.test(document.minLauncherVersion || '0.0.0')) {
    throw new Error('El manifiesto no corresponde al canal estable de Estación Boreal.');
  }
  const target = document.target;
  if (!target || target.minecraft !== BOREAL_PROFILE.minecraft || target.loader !== BOREAL_PROFILE.loaderId || target.loaderVersion !== BOREAL_PROFILE.loaderVersion || target.javaMajor !== BOREAL_PROFILE.javaMajor || target.installSide !== 'client') {
    throw new Error('El manifiesto de Boreal no declara el objetivo cliente aprobado.');
  }
  const pack = document.installPack;
  if (!pack || typeof pack !== 'object' || !Number.isSafeInteger(pack.size) || pack.size < 1 || pack.size > MAX_PACK_BYTES || !/^[a-f0-9]{64}$/.test(pack.sha256 || '') || !/^Estacion-Boreal-Client-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.mrpack$/.test(pack.filename || '')) {
    throw new Error('El pack firmado de Boreal no es válido.');
  }
  let artifact;
  try { artifact = new URL(pack.url); } catch { throw new Error('La URL del pack de Boreal no es válida.'); }
  const releasePrefix = `/${releaseRepository}/releases/download/estacion-boreal-${document.releaseId}/`;
  if (artifact.protocol !== 'https:' || artifact.hostname !== 'github.com' || !artifact.pathname.startsWith(releasePrefix) || artifact.pathname.slice(releasePrefix.length) !== pack.filename || artifact.search || artifact.hash) {
    throw new Error('El pack no pertenece a la release independiente de Boreal declarada.');
  }
  if (typeof document.notes !== 'string' || document.notes.length > 10000 || !Number.isInteger(document.modCount) || document.modCount < 1 || document.modCount > 100) {
    throw new Error('El manifiesto de Boreal está incompleto o supera los límites permitidos.');
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

class BorealProfileUpdater {
  constructor({ channelUrl, releaseRepository, publicKey, userData, prismBridge, bundledPackPath, request, download, onChange } = {}) {
    const config = require('./boreal-channel.cjs');
    this.channelUrl = channelUrl === undefined ? config.channelUrl : channelUrl;
    this.releaseRepository = releaseRepository === undefined ? config.releaseRepository : releaseRepository;
    this.publicKey = publicKey || config.publicKey;
    this.userData = userData;
    this.prismBridge = prismBridge || null;
    this.bundledPackPath = bundledPackPath || require('node:path').join(__dirname, 'provider', 'packs', BOREAL_PROFILE.packFile);
    this.request = request || require('./update-http.cjs').getBytes;
    this.download = download || require('./update-http.cjs').downloadToFile;
    this.onChange = onChange || (() => {});
    this.state = {
      status: 'idle',
      currentVersion: null, latestVersion: null, modCount: BOREAL_PROFILE.modCount,
      progress: 0, changes: { added: [], changed: [], removed: [] }, notes: '',
      error: null
    };
    this.latestPackPath = null;
    this.latestManifest = null;
  }

  snapshot() { return { ...this.state, changes: structuredClone(this.state.changes) }; }
  set(patch) { this.state = { ...this.state, ...patch }; this.onChange(this.snapshot()); }

  async check(signal) {
    if (!this.channelUrl || !this.releaseRepository) return this.checkBundled(signal);
    this.set({ status: 'checking', error: null, progress: 0 });
    try {
      const trustedHosts = [new URL(this.channelUrl).hostname, 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
      const requestOptions = { maxBytes: 4 * 1024 * 1024, signal, trustedHosts, userAgent: 'EstacionBoreal-Launcher/1' };
      const bytes = await this.request(this.channelUrl, requestOptions);
      const checked = validateBorealProfileManifest(bytes, this.publicKey, { channelUrl: this.channelUrl, releaseRepository: this.releaseRepository });
      if (compareVersions(require('./package.json').version, checked.manifest.minLauncherVersion) < 0) throw new Error(`El perfil Boreal necesita un launcher ${checked.manifest.minLauncherVersion} o posterior.`);
      if (!this.userData) throw new Error('No hay una carpeta privada de datos de Prism disponible para descargar el perfil Boreal.');
      const path = require('node:path');
      const fs = require('node:fs/promises');
      const { randomUUID } = require('node:crypto');
      const { safeRoot } = require('./file-safety.cjs');
      const { verifyFile } = require('./file-safety.cjs');
      const directory = await safeRoot(path.join(this.userData, 'profiles', 'estacion-boreal', 'downloads', checked.manifest.releaseId));
      const destination = path.join(directory, checked.manifest.installPack.filename);
      const expected = { size: checked.manifest.installPack.size, hashes: { sha256: checked.manifest.installPack.sha256 } };
      try { await verifyFile(destination, expected, signal); }
      catch (error) {
        if (!['ENOENT', 'SIZE_MISMATCH', 'HASH_MISMATCH'].includes(error.code)) throw error;
        await fs.rm(destination, { force: true });
        const temporary = path.join(directory, `${checked.manifest.installPack.filename}.${randomUUID()}.part`);
        try {
          await this.download(checked.manifest.installPack.url, temporary, { ...requestOptions, maxBytes: checked.manifest.installPack.size });
          await verifyFile(temporary, expected, signal);
          await fs.rename(temporary, destination);
        } catch (downloadError) { await fs.rm(temporary, { force: true }); throw downloadError; }
      }
      this.latestPackPath = destination;
      this.latestManifest = checked.manifest;
      const installed = await this.prismBridge?.findBorealProfile().catch(() => null);
      const currentVersion = installed?.profileRelease || null;
      const isCurrent = currentVersion && compareVersions(currentVersion, checked.manifest.releaseId) >= 0;
      this.set({ status: isCurrent ? 'current' : 'ready-to-install', currentVersion, latestVersion: checked.manifest.releaseId, modCount: checked.manifest.modCount, progress: 100, notes: checked.manifest.notes, error: null, manifestSha256: checked.manifestSha256, source: 'channel' });
    } catch (error) {
      this.set({ status: 'unavailable', error: typeof error.message === 'string' ? error.message : 'No se pudo verificar el canal independiente de Boreal.' });
    }
    return this.snapshot();
  }

  async checkBundled(signal) {
    const { verifyFile } = require('./file-safety.cjs');
    this.set({ status: 'checking', error: null, progress: 0 });
    try {
      await verifyFile(this.bundledPackPath, { size: BOREAL_PROFILE.packSize, hashes: { sha256: BOREAL_PROFILE.packSha256 } }, signal);
      const installed = await this.prismBridge?.findBorealProfile().catch(() => null);
      const currentVersion = installed?.profileRelease || null;
      this.latestPackPath = this.bundledPackPath;
      this.latestManifest = null;
      const isCurrent = currentVersion && compareVersions(currentVersion, BOREAL_PROFILE.version) >= 0;
      this.set({ status: isCurrent ? 'current' : 'ready-to-install', currentVersion, latestVersion: BOREAL_PROFILE.version, modCount: BOREAL_PROFILE.modCount, progress: 100, notes: 'Perfil Boreal local verificado.', error: null, source: 'bundled' });
    } catch (error) {
      this.latestPackPath = null;
      this.set({ status: 'unavailable', error: error?.code === 'ENOENT' ? 'Falta el pack local verificado de Estación Boreal.' : 'No se pudo verificar el pack local de Estación Boreal.' });
    }
    return this.snapshot();
  }

  async installPackPath() {
    if (!this.latestPackPath) throw new Error('El perfil de Estación Boreal todavía no está verificado y descargado.');
    const { verifyFile } = require('./file-safety.cjs');
    if (this.latestManifest) {
      const pack = this.latestManifest.installPack;
      await verifyFile(this.latestPackPath, { size: pack.size, hashes: { sha256: pack.sha256 } });
    } else {
      await verifyFile(this.latestPackPath, { size: BOREAL_PROFILE.packSize, hashes: { sha256: BOREAL_PROFILE.packSha256 } });
    }
    return this.latestPackPath;
  }
}

module.exports = { BOREAL_PROFILE, BorealProfileUpdater, validateBorealProfileManifest, compareVersions, MAX_PACK_BYTES };
