'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { AuthError } = require('./auth-errors.cjs');
const HEADER = Buffer.from('GDC7-SESSION-1\n');
class SessionVault {
  constructor(directory, safeStorage, platform = process.platform) { this.directory = directory; this.file = path.join(directory, 'session.bin'); this.safeStorage = safeStorage; this.platform = platform; }
  available() { try { return this.safeStorage.isEncryptionAvailable() && (this.platform !== 'linux' || ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(this.safeStorage.getSelectedStorageBackend())); } catch { return false; } }
  requireProtection() { if (!this.available()) throw new AuthError('STORAGE_UNAVAILABLE'); }
  async directoryCheck() { await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }); const s = await fs.lstat(this.directory); if (!s.isDirectory() || s.isSymbolicLink()) throw new Error('Unsafe directory'); }
  async fileCheck() { try { const s = await fs.lstat(this.file); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > 262144) throw new Error('Unsafe session file'); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
  async load() {
    this.requireProtection();
    try { await this.directoryCheck(); if (!await this.fileCheck()) return null; const bytes = await fs.readFile(this.file); if (!bytes.subarray(0, HEADER.length).equals(HEADER)) throw new Error('Format'); return JSON.parse(this.safeStorage.decryptString(bytes.subarray(HEADER.length))); }
    catch { throw new AuthError('STORAGE_ERROR'); }
  }
  async save(value) {
    this.requireProtection(); let temp;
    try {
      await this.directoryCheck(); await this.fileCheck();
      const plain = JSON.stringify(value); if (Buffer.byteLength(plain) > 131072) throw new Error('Size');
      const encrypted = this.safeStorage.encryptString(plain); if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error('Encryption');
      temp = path.join(this.directory, `.session-${randomUUID()}.part`);
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(Buffer.concat([HEADER, encrypted])); await handle.sync(); } finally { await handle.close(); }
      await this.fileCheck(); await fs.rename(temp, this.file); temp = null;
    } catch { throw new AuthError('STORAGE_ERROR'); }
    finally { if (temp) await fs.rm(temp, { force: true }).catch(() => {}); }
  }
  async clear() { try { await this.directoryCheck(); await this.fileCheck(); await fs.rm(this.file, { force: true }); } catch { throw new AuthError('LOGOUT_FAILED'); } }
}
module.exports = { SessionVault };
