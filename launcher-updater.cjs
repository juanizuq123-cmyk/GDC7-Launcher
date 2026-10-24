'use strict';

const { createHash } = require('node:crypto');
const { LauncherChannel, sha512Hex } = require('./launcher-channel.cjs');

class LauncherUpdater {
  constructor({ updater, channel, currentVersion, onChange, quitAndInstall } = {}) {
    this.updater = updater;
    this.channel = channel;
    this.currentVersion = currentVersion;
    this.onChange = onChange || (() => {});
    this.quitAndInstall = quitAndInstall || (() => updater.quitAndInstall(false, true));
    this.pointer = null;
    this.installing = false;
    this.state = { status: 'idle', currentVersion, latestVersion: null, percent: 0, releaseNotes: '', error: null };
    this.attach();
  }

  set(patch) { this.state = { ...this.state, ...patch }; this.onChange({ ...this.state }); }

  attach() {
    const updater = this.updater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowDowngrade = false;
    updater.allowPrerelease = false;
    updater.channel = 'latest';
    updater.disableDifferentialDownload = true;
    updater.verifyUpdateCodeSignature = async (_publisherName, filePath) => {
      try {
        if (!this.pointer) throw new Error('No hay un manifiesto firmado activo.');
        return (await this.matchesSignedHash(filePath)) ? null : 'El instalador no coincide con el SHA-512 firmado.';
      } catch (error) { return error?.message || 'No se pudo verificar el instalador.'; }
    };
    updater.on('checking-for-update', () => this.set({ status: 'checking', error: null }));
    updater.on('update-available', info => {
      if (this.installing) return;
      if (!this.pointer || info?.version !== this.pointer.version || !this.matchesUpdateInfo(info)) {
        this.set({ status: 'error', latestVersion: info?.version || null, error: 'La metadata recibida por el actualizador no coincide con el canal firmado.' });
        return;
      }
      this.installing = true;
      this.downloadVersion = info.version;
      this.downloadRejected = false;
      const version = info?.version || this.pointer?.version || null;
      this.set({ status: 'downloading', latestVersion: version, releaseNotes: this.pointer?.notes || '', percent: 0, error: null });
      updater.downloadUpdate().then(async files => {
        const installer = Array.isArray(files) ? files[0] : files?.updateFile;
        if (this.downloadRejected || this.downloadVersion !== this.pointer?.version || !installer || !this.pointer || !(await this.matchesSignedHash(installer))) throw new Error('El instalador descargado no coincide con el SHA-512 firmado.');
        this.set({ status: 'installing', percent: 100 });
        this.quitAndInstall();
      }).catch(error => { this.installing = false; this.set({ status: 'error', error: error?.message || 'No se pudo descargar la actualización.' }); });
    });
    updater.on('update-not-available', info => {
      if (this.pointer && info?.version && (info.version !== this.pointer.version || !this.matchesUpdateInfo(info))) {
        this.set({ status: 'error', latestVersion: info.version, error: 'La metadata recibida por el actualizador no coincide con el canal firmado.' });
        return;
      }
      this.set({ status: 'current', latestVersion: this.pointer?.version || this.currentVersion, error: null });
    });
    updater.on('download-progress', progress => this.set({ status: 'downloading', percent: Math.max(0, Math.min(100, Number(progress?.percent) || 0)) }));
    updater.on('update-downloaded', info => {
      if (!this.pointer || info?.version !== this.pointer.version || info?.version !== this.downloadVersion || !this.matchesUpdateInfo(info)) {
        this.downloadRejected = true;
        this.set({ status: 'error', error: 'La versión descargada no coincide con el canal firmado.' });
      }
    });
    updater.on('error', error => { this.installing = false; this.set({ status: 'error', error: error?.message || 'No se pudo actualizar el launcher.' }); });
  }

  async matchesSignedHash(filePath) {
    const hash = createHash('sha512');
    const stat = await require('node:fs/promises').stat(filePath);
    if (!this.pointer || stat.size !== this.pointer.size) return false;
    const stream = require('node:fs').createReadStream(filePath);
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex') === this.pointer?.sha512;
  }

  matchesUpdateInfo(info) {
    if (!this.pointer || info?.version !== this.pointer.version || !Array.isArray(info.files)) return false;
    const candidates = info.files.filter(file => String(file.url || file.path || '').toLowerCase().endsWith('.exe'));
    if (candidates.length !== 1) return false;
    try {
      const file = candidates[0];
      const url = new URL(file.url || file.path, this.channel.ymlUrl).toString();
      return url === this.pointer.assetUrl && file.size === this.pointer.size && sha512Hex(file.sha512) === this.pointer.sha512;
    } catch { return false; }
  }

  async check() {
    if (this.state.status === 'checking' || this.state.status === 'downloading' || this.state.status === 'installing') return { ...this.state };
    this.set({ status: 'checking', error: null, currentVersion: this.currentVersion });
    try {
      const { pointer, metadata } = await this.channel.check();
      if (pointer.version !== metadata.version || pointer.sha512 !== metadata.sha512 || pointer.assetUrl !== metadata.assetUrl || pointer.size !== metadata.size) throw new Error('La metadata del launcher no coincide con la firma del canal.');
      this.pointer = pointer;
      if (pointer.version === this.currentVersion) { this.set({ status: 'current', latestVersion: pointer.version, releaseNotes: pointer.notes, percent: 0, error: null }); return { ...this.state }; }
      await this.updater.checkForUpdates();
      return { ...this.state };
    } catch (error) {
      this.set({ status: 'unavailable', error: error?.message || 'No se pudo consultar el canal del launcher.' });
      return { ...this.state };
    }
  }

  snapshot() { return { ...this.state }; }
}

module.exports = { LauncherUpdater };
