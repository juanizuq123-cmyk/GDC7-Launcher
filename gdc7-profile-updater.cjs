'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { safeParent, safeRoot, verifyFile } = require('./file-safety.cjs');
const { getBytes, downloadToFile } = require('./update-http.cjs');
const { PROFILE_CHANNEL_URL, validateProfilePath, validateProfileManifest, compareProfileManifests, MAX_FILE_BYTES } = require('./profile-update.cjs');
const { CLIENT_PACK } = require('./client-pack.cjs');

const safeError = error => error?.code === 'TARGET_CHANGE_PENDING' ? error.message : (typeof error?.message === 'string' && error.message.length <= 240 ? error.message : 'No se pudo completar la actualización del perfil.');

function checkOwnedPath(value) {
  validateProfilePath(value);
}

function semverTuple(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(value || '');
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] || ''] : [0, 0, 0, ''];
}

function compareSemver(left, right) {
  const a = semverTuple(left), b = semverTuple(right);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  if (a[3] === b[3]) return 0;
  if (!a[3]) return 1;
  if (!b[3]) return -1;
  return a[3].localeCompare(b[3]);
}

function artifactFor(entry) {
  return { size: entry.size, hashes: Object.fromEntries(['sha256', 'sha512'].filter(key => entry[key]).map(key => [key, entry[key]])) };
}

function sameFingerprint(left, right) {
  return left && right && left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

class Gdc7ProfileUpdater {
  constructor({ channelUrl = PROFILE_CHANNEL_URL, publicKey, userData, prismBridge, request = getBytes, download = downloadToFile, onChange } = {}) {
    this.channelUrl = channelUrl; this.publicKey = publicKey; this.userData = userData; this.prismBridge = prismBridge;
    this.request = request; this.download = download; this.onChange = onChange || (() => {});
    this.state = { status: 'idle', currentVersion: null, latestVersion: null, modCount: CLIENT_PACK.modCount, progress: 0, changes: { added: [], changed: [], removed: [] }, notes: '', error: null };
    this.latest = null; this.latestPackPath = null; this.active = false;
  }

  set(patch) { this.state = { ...this.state, ...patch }; this.onChange({ ...this.state }); }
  snapshot() { return { ...this.state, changes: structuredClone(this.state.changes) }; }

  async paths() {
    const dataRoot = await this.prismBridge.dataDirectory();
    return { dataRoot, appRoot: await safeRoot(path.join(dataRoot, '.gdc7')) };
  }

  async readReceipt(appRoot) {
    const file = await safeParent(appRoot, 'profile-receipt.json');
    let value;
    try { value = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error('El recibo local del perfil no se puede leer.'); }
    if (value?.schema !== 1 || typeof value.manifest !== 'string' || value.manifest.length > 4 * 1024 * 1024 * 2) throw new Error('El recibo local del perfil no es válido.');
    const bytes = Buffer.from(value.manifest, 'base64');
    const checked = validateProfileManifest(bytes, this.publicKey, { channelUrl: this.channelUrl });
    if (checked.manifestSha256 !== value.manifestSha256) throw new Error('La copia local del recibo no coincide con su manifiesto firmado.');
    return { ...value, ...checked };
  }

  async readPending(appRoot) {
    const file = await safeParent(appRoot, 'pending-profile-release.json');
    let value;
    try { value = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw new Error('La copia pendiente del perfil no se puede leer.'); }
    if (value?.schema !== 1 || typeof value.manifest !== 'string') return null;
    const bytes = Buffer.from(value.manifest, 'base64');
    const checked = validateProfileManifest(bytes, this.publicKey, { channelUrl: this.channelUrl });
    if (checked.manifestSha256 !== value.manifestSha256 || !checked.manifest.installPack) return null;
    if (compareSemver(require('./package.json').version, checked.manifest.minLauncherVersion) < 0) return null;
    return { ...checked, bytes };
  }

  async writePending(latest, appRoot) {
    if (!latest.manifest.installPack) return;
    const file = await safeParent(appRoot, 'pending-profile-release.json');
    await this.atomicWrite(file, Buffer.from(JSON.stringify({ schema: 1, manifest: latest.bytes.toString('base64'), manifestSha256: latest.manifestSha256 }, null, 2) + '\n'));
  }

  async fetchLatest(signal) {
    const bytes = await this.request(this.channelUrl, { maxBytes: 4 * 1024 * 1024, signal });
    const checked = validateProfileManifest(bytes, this.publicKey, { channelUrl: this.channelUrl });
    if (compareSemver(require('./package.json').version, checked.manifest.minLauncherVersion) < 0) {
      const error = new Error(`Esta versión del launcher no alcanza el mínimo ${checked.manifest.minLauncherVersion} requerido por el perfil.`);
      error.code = 'MIN_LAUNCHER_VERSION'; throw error;
    }
    return { ...checked, bytes };
  }

  async ensurePack(latest, appRoot, signal) {
    if (!latest.manifest.installPack) { this.latestPackPath = this.prismBridge.packFile; return this.latestPackPath; }
    const pack = latest.manifest.installPack;
    const directory = await safeRoot(path.join(appRoot, 'downloads', latest.manifest.releaseId));
    const destination = path.join(directory, pack.filename);
    const expected = { size: pack.size, hashes: { sha256: pack.sha256 } };
    try { await verifyFile(destination, expected, signal); }
    catch (error) {
      if (!['ENOENT', 'SIZE_MISMATCH', 'HASH_MISMATCH'].includes(error.code)) throw error;
      await fs.rm(destination, { force: true });
      const temporary = path.join(directory, `${pack.filename}.${randomUUID()}.part`);
      try { await this.download(pack.url, temporary, { maxBytes: pack.size, signal }); await verifyFile(temporary, expected, signal); await fs.rename(temporary, destination); }
      catch (downloadError) { await fs.rm(temporary, { force: true }); throw downloadError; }
    }
    this.latestPackPath = destination;
    return destination;
  }

  async installPackPath() { return this.latestPackPath || this.prismBridge.packFile; }

  async readManifestAndRecover(profile, appRoot, signal) {
    const journalFile = await safeParent(appRoot, 'transaction.json');
    let journal;
    try { journal = JSON.parse(await fs.readFile(journalFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw new Error('La recuperación del perfil necesita atención manual.'); }
    if (journal?.schema !== 1 || journal.instanceId !== profile.instanceId || !Array.isArray(journal.entries)) throw new Error('La recuperación no coincide con la instancia GDC7 actual.');
    if (journal.phase === 'committed' || journal.phase === 'prepared') { await fs.rm(journalFile, { force: true }); return; }
    if (journal.phase !== 'applying') throw new Error('La transacción del perfil tiene un estado desconocido.');
    this.set({ status: 'recovering', error: null });
    const minecraftRoot = await safeRoot(path.join(profile.path, '.minecraft'));
    const recoveryStage = await safeRoot(path.join(minecraftRoot, '.gdc7-launcher', 'staging'));
    for (const entry of [...journal.entries].reverse()) {
      checkOwnedPath(entry.path);
      const destination = await safeParent(minecraftRoot, entry.path);
      const backup = entry.backup ? await safeParent(minecraftRoot, entry.backup) : null;
      const temporary = await safeParent(recoveryStage, `recovery-${randomUUID()}.part`);
      let destinationExists = false;
      try { await fs.lstat(destination); destinationExists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (entry.existed && backup) {
        if (!entry.backupArtifact || !(await this.hashMatches(backup, entry.backupArtifact, signal))) throw new Error(`La copia de seguridad de ${entry.path} no coincide; se preservó la instancia.`);
        if (destinationExists && await this.hashMatches(destination, entry.backupArtifact, signal)) continue;
        if (destinationExists && (!entry.installedArtifact || !(await this.hashMatches(destination, entry.installedArtifact, signal)))) throw new Error(`El archivo ${entry.path} cambió localmente; no se sobrescribió durante la recuperación.`);
        await fs.copyFile(backup, temporary, { flag: 'wx' });
        await verifyFile(temporary, entry.backupArtifact, signal);
        await fs.rm(destination, { force: true });
        await fs.rename(temporary, destination);
        await verifyFile(destination, entry.backupArtifact, signal);
      } else if (!entry.existed && destinationExists) {
        if (!entry.installedArtifact || !(await this.hashMatches(destination, entry.installedArtifact, signal))) throw new Error(`El archivo ${entry.path} cambió localmente; no se eliminó durante la recuperación.`);
        await fs.rm(destination, { force: true });
      }
    }
    const receipt = await safeParent(appRoot, 'profile-receipt.json');
    if (journal.oldReceipt === null) await fs.rm(receipt, { force: true });
    else await this.atomicWrite(receipt, Buffer.from(journal.oldReceipt, 'base64'));
    await fs.rm(journalFile, { force: true });
  }

  baseline() {
    const manifest = require('./pack/source/gdc7-client-26.1.2-neoforge-v0.3.0.json');
    return {
      schema: 1, eventId: 'gdc7', channel: 'baseline', releaseId: CLIENT_PACK.version,
      target: { minecraft: CLIENT_PACK.minecraft, loader: CLIENT_PACK.loaderId, loaderVersion: CLIENT_PACK.loaderVersion, javaMajor: CLIENT_PACK.javaMajor, installSide: 'client' },
      files: manifest.mods.map(mod => ({ path: `mods/${mod.file.filename}`, size: mod.file.size, sha512: mod.file.hashes.sha512, category: 'mod' }))
    };
  }

  async atomicWrite(destination, bytes) {
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try { await fs.rename(temporary, destination); }
    finally { await fs.rm(temporary, { force: true }); }
  }

  async hashMatches(file, artifact, signal) {
    const hashes = artifact.hashes || Object.fromEntries(['sha256', 'sha512'].filter(key => artifact[key]).map(key => [key, artifact[key]]));
    if (!hashes) return false;
    try { await verifyFile(file, { size: artifact.size, hashes }, signal); return true; }
    catch (error) { if (['ENOENT', 'SIZE_MISMATCH', 'HASH_MISMATCH'].includes(error.code)) return false; throw error; }
  }

  async apply(profile, latest, oldReceipt, appRoot, signal) {
    const previous = oldReceipt?.manifest || this.baseline();
    const changes = compareProfileManifests(previous, latest.manifest);
    const minecraftRoot = await safeRoot(path.join(profile.path, '.minecraft'));
    const stagingRoot = await safeRoot(path.join(minecraftRoot, '.gdc7-launcher', 'staging', randomUUID()));
    this.activeStagingRoot = stagingRoot;
    const transactionId = randomUUID();
    const backupRootRelative = path.posix.join('.gdc7-launcher', 'backups', `${latest.manifest.releaseId}-${transactionId}`);
    const backupRoot = await safeRoot(path.join(minecraftRoot, ...backupRootRelative.split('/')));
    const previousEntries = new Map((previous.files || []).map(file => [file.path, file]));
    const nextEntries = new Map(latest.manifest.files.map(file => [file.path, file]));
    const prepared = [];
    for (const [relative, entry] of nextEntries) {
      checkOwnedPath(relative);
      const destination = await safeParent(minecraftRoot, relative);
      const previousEntry = previousEntries.get(relative);
      let exists = false, initial = null;
      try { const stat = await fs.lstat(destination); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Un archivo de la instancia no es un archivo regular.'); exists = true; initial = stat; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (exists && !previousEntry) throw new Error(`Se conservó un archivo personal que ocupa la ruta ${relative}.`);
      if (exists && previousEntry && !(await this.hashMatches(destination, previousEntry, signal))) throw new Error(`Se conservó el archivo modificado localmente: ${relative}.`);
      const same = exists && await this.hashMatches(destination, entry, signal);
      if (same) { prepared.push({ path: relative, destination, exists, changed: false, initial }); continue; }
      const staged = await safeParent(stagingRoot, relative);
      await this.download(entry.url, staged, { maxBytes: entry.size, signal });
      await verifyFile(staged, { size: entry.size, hashes: { sha256: entry.sha256, sha512: entry.sha512 } }, signal);
      prepared.push({ path: relative, staged, destination, exists, changed: true, initial, expectedNew: artifactFor(entry) });
    }

    for (const [relative, entry] of previousEntries) {
      if (nextEntries.has(relative)) continue;
      checkOwnedPath(relative);
      const destination = await safeParent(minecraftRoot, relative);
      if (await this.hashMatches(destination, entry, signal)) prepared.push({ path: relative, destination, exists: true, removed: true, changed: true, initial: await fs.lstat(destination), previousEntry: entry });
      else {
        try { await fs.lstat(destination); throw new Error(`Se conservó el archivo modificado localmente: ${relative}.`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }

    const markerPath = CLIENT_PACK.markerFile;
    const markerFile = await safeParent(minecraftRoot, markerPath);
    const marker = JSON.parse(await fs.readFile(markerFile, 'utf8'));
    const markerOriginalBytes = await fs.readFile(markerFile);
    const markerOriginalStat = await fs.lstat(markerFile);
    if (marker.eventId !== 'gdc7' || marker.profileId !== CLIENT_PACK.id || marker.minecraft !== CLIENT_PACK.minecraft || marker.loader !== CLIENT_PACK.loaderVersion) throw new Error('La marca de la instancia no coincide con GDC7.');
    const markerBytes = Buffer.from(JSON.stringify({ ...marker, profileRelease: latest.manifest.releaseId }, null, 2) + '\n');
    const markerStaged = await safeParent(stagingRoot, 'launcher-marker.json');
    await fs.writeFile(markerStaged, markerBytes, { flag: 'wx', mode: 0o600 });
    let oldReceiptBytes = null;
    const receiptPath = await safeParent(appRoot, 'profile-receipt.json');
    try { oldReceiptBytes = await fs.readFile(receiptPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const journalPath = await safeParent(appRoot, 'transaction.json');
    const transactionEntries = [
      ...prepared.filter(item => item.changed).map(item => {
        const priorEntry = previousEntries.get(item.path);
        return { path: item.path, existed: item.exists, backup: item.exists ? path.posix.join(backupRootRelative, item.path) : null, backupArtifact: item.exists ? artifactFor(priorEntry) : null, installedArtifact: item.removed ? null : item.expectedNew };
      }),
      { path: markerPath, existed: true, backup: path.posix.join(backupRootRelative, 'launcher-marker.json'), backupArtifact: { size: markerOriginalBytes.length, hashes: { sha256: createHash('sha256').update(markerOriginalBytes).digest('hex') } }, installedArtifact: { size: markerBytes.length, hashes: { sha256: createHash('sha256').update(markerBytes).digest('hex') } } }
    ];
    for (const entry of transactionEntries) {
      const target = await safeParent(minecraftRoot, entry.path);
      if (entry.existed) {
        const backup = await safeParent(minecraftRoot, entry.backup);
        await fs.copyFile(target, backup, { flag: 'wx' });
        const sourceStat = await fs.lstat(target), backupStat = await fs.lstat(backup);
        if (sourceStat.size !== backupStat.size || sourceStat.size > MAX_FILE_BYTES) throw new Error('No se pudo validar una copia de seguridad del perfil.');
        await verifyFile(backup, entry.backupArtifact, signal);
      }
    }
    const nextReceipt = {
      schema: 1,
      manifest: latest.bytes.toString('base64'),
      manifestSha256: latest.manifestSha256,
      installedAt: new Date().toISOString(),
      previous: oldReceipt?.manifest ? { releaseId: oldReceipt.manifest.releaseId, backupRoot: backupRootRelative, transactionId } : { releaseId: previous.releaseId, backupRoot: backupRootRelative, transactionId }
    };
    const journal = { schema: 1, phase: 'prepared', transactionId, instanceId: profile.instanceId, entries: transactionEntries, oldReceipt: oldReceiptBytes?.toString('base64') ?? null };
    await this.atomicWrite(journalPath, Buffer.from(JSON.stringify(journal)));
    try {
      journal.phase = 'applying';
      await this.atomicWrite(journalPath, Buffer.from(JSON.stringify(journal)));
      for (const item of prepared.filter(item => item.changed)) {
        const destination = await safeParent(minecraftRoot, item.path);
        if (item.exists) {
          const current = await fs.lstat(destination);
          if (!sameFingerprint(current, item.initial)) throw new Error(`El archivo ${item.path} cambió durante la actualización; se conservó.`);
          const priorEntry = previousEntries.get(item.path);
          if (!priorEntry || !(await this.hashMatches(destination, priorEntry, signal))) throw new Error(`El archivo ${item.path} cambió durante la actualización; se conservó.`);
        } else {
          try { await fs.lstat(destination); throw new Error(`Apareció un archivo local en ${item.path}; se conservó.`); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        if (item.removed) await fs.rm(destination, { force: true });
        else if (item.exists) { await fs.rm(destination, { force: true }); await fs.rename(item.staged, destination); await verifyFile(destination, item.expectedNew, signal); }
        else { await fs.link(item.staged, destination); await fs.unlink(item.staged); await verifyFile(destination, item.expectedNew, signal); }
      }
      const currentMarkerStat = await fs.lstat(markerFile);
      if (!sameFingerprint(currentMarkerStat, markerOriginalStat)) throw new Error('La marca GDC7 cambió durante la actualización; se conservó.');
      await fs.rm(markerFile, { force: true });
      await fs.rename(markerStaged, markerFile);
      await verifyFile(markerFile, transactionEntries.at(-1).installedArtifact, signal);
      for (const file of latest.manifest.files) {
        const destination = await safeParent(minecraftRoot, file.path);
        await verifyFile(destination, { size: file.size, hashes: { sha256: file.sha256, sha512: file.sha512 } }, signal);
      }
      for (const item of prepared.filter(item => item.removed)) {
        try { await fs.lstat(await safeParent(minecraftRoot, item.path)); throw new Error(`El archivo retirado ${item.path} reapareció durante la actualización.`); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      await this.atomicWrite(receiptPath, Buffer.from(JSON.stringify(nextReceipt, null, 2) + '\n'));
      journal.phase = 'committed';
      await this.atomicWrite(journalPath, Buffer.from(JSON.stringify(journal)));
      await fs.rm(journalPath, { force: true });
      await fs.rm(await safeParent(appRoot, 'pending-profile-release.json'), { force: true });
      this.set({ status: 'updated', currentVersion: latest.manifest.releaseId, latestVersion: latest.manifest.releaseId, modCount: latest.manifest.files.filter(file => file.category === 'mod').length, progress: 100, changes, notes: latest.manifest.notes, error: null });
      return { status: 'updated', currentVersion: latest.manifest.releaseId, latestVersion: latest.manifest.releaseId, changes, target: latest.manifest.target };
    } catch (error) {
      try { await this.readManifestAndRecover(profile, appRoot, signal); }
      catch { throw new Error('Falló la actualización y la recuperación automática necesita atención.'); }
      throw error;
    } finally { await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {}); this.activeStagingRoot = null; }
  }

  async checkAndApply({ signal } = {}) {
    if (this.active) return this.snapshot();
    this.active = true;
    this.set({ status: 'checking', error: null, progress: 0 });
    try {
      const { appRoot } = await this.paths();
      const profile = await this.prismBridge.findClientProfile();
      if (profile) await this.readManifestAndRecover(profile, appRoot, signal);
      const receipt = await this.readReceipt(appRoot);
      this.set({ currentVersion: profile ? (receipt?.manifest.releaseId || CLIENT_PACK.version) : null, modCount: receipt?.manifest.files.filter(file => file.category === 'mod').length ?? CLIENT_PACK.modCount });
      let latest;
      let usingPending = false;
      try { latest = await this.fetchLatest(signal); }
      catch (error) {
        if (!profile && !['TARGET_CHANGE_PENDING', 'MIN_LAUNCHER_VERSION'].includes(error.code)) {
          latest = await this.readPending(appRoot).catch(() => null);
          usingPending = Boolean(latest);
        }
        if (!latest) throw error;
      }
      this.latest = latest;
      await this.ensurePack(latest, appRoot, signal);
      if (!usingPending) await this.writePending(latest, appRoot);
      const previous = receipt?.manifest || this.baseline();
      if (receipt && compareSemver(latest.manifest.releaseId, receipt.manifest.releaseId) < 0) throw new Error('El canal ofrece una versión anterior a la ya instalada; no se aplicó.');
      const changes = compareProfileManifests(previous, latest.manifest);
      if (!profile) {
        this.set({ status: 'ready-to-install', currentVersion: null, latestVersion: latest.manifest.releaseId, modCount: latest.manifest.files.filter(file => file.category === 'mod').length, progress: 100, changes, notes: latest.manifest.notes, error: usingPending ? 'Sin conexión; se usa el pack firmado que ya estaba guardado.' : null });
        return this.snapshot();
      }
      if (this.prismBridge.active) {
        this.set({ status: 'deferred', currentVersion: receipt?.manifest.releaseId || CLIENT_PACK.version, latestVersion: latest.manifest.releaseId, changes, notes: latest.manifest.notes, error: 'Cerrá Prism para actualizar el perfil.' });
        return this.snapshot();
      }
      if (receipt?.manifest.releaseId === latest.manifest.releaseId) {
        this.set({ status: 'current', currentVersion: receipt.manifest.releaseId, latestVersion: latest.manifest.releaseId, modCount: receipt.manifest.files.filter(file => file.category === 'mod').length, progress: 100, changes: { added: [], changed: [], removed: [] }, notes: latest.manifest.notes, error: null });
        return this.snapshot();
      }
      this.set({ status: 'downloading', currentVersion: receipt?.manifest.releaseId || CLIENT_PACK.version, latestVersion: latest.manifest.releaseId, progress: 0, changes, notes: latest.manifest.notes, error: null });
      return await this.apply(profile, latest, receipt, appRoot, signal);
    } catch (error) {
      const status = error.code === 'TARGET_CHANGE_PENDING' ? 'target-change-pending' : error.code === 'MIN_LAUNCHER_VERSION' ? 'launcher-update-required' : 'unavailable';
      this.set({ status, error: safeError(error) });
      return this.snapshot();
    } finally {
      if (this.activeStagingRoot) await fs.rm(this.activeStagingRoot, { recursive: true, force: true }).catch(() => {});
      this.activeStagingRoot = null;
      this.active = false;
    }
  }
}

module.exports = { Gdc7ProfileUpdater, checkOwnedPath, compareSemver };
