'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { DownloadError, safeRelative, safeParent, canceled, verifyFile } = require('./file-safety.cjs');
const check = (v, m) => { if (!v) throw new DownloadError('UNSAFE_INSTANCE', m); };
async function readPath(root, relative, directory = false) {
  const parts = safeRelative(relative); let current = root;
  for (const [i, part] of [null, ...parts].entries()) {
    if (i) current = path.join(current, part);
    const stat = await fs.lstat(current);
    check(!stat.isSymbolicLink() && (i === parts.length && !directory ? stat.isFile() && stat.nlink === 1 : stat.isDirectory()), 'Una ruta de la instancia es un enlace o no tiene el tipo esperado.');
  }
  return current;
}
async function readVerifiedJson(root, artifact, signal) {
  const file = await readPath(root, artifact.target); await verifyFile(file, artifact, signal);
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { throw new DownloadError('INVALID_PROFILE', 'Un perfil comprobado contiene JSON inválido.'); }
}
function bytesArtifact(data) { return { size: data.length, hashes: { sha256: createHash('sha256').update(data).digest('hex') } }; }
async function publish(root, relative, source, artifact, signal) {
  canceled(signal); let destination = await safeParent(root, relative), previous;
  try { await readPath(root, relative); await verifyFile(destination, artifact, signal); return { reused: true }; }
  catch (error) { if (error.code !== 'ENOENT' && !['SIZE_MISMATCH', 'HASH_MISMATCH'].includes(error.code)) throw error; if (error.code !== 'ENOENT') previous = await fs.lstat(destination); }
  const parent = path.posix.dirname(relative);
  const temporaryRelative = `${parent === '.' ? '' : `${parent}/`}gdc7-install-${randomUUID()}.part`;
  const temporary = await safeParent(root, temporaryRelative); let owned = false;
  try {
    await fs.copyFile(source, temporary, constants.COPYFILE_EXCL); owned = true;
    await verifyFile(temporary, artifact, signal); canceled(signal);
    destination = await safeParent(root, relative);
    if (previous) {
      const current = await fs.lstat(destination);
      check(current.isFile() && !current.isSymbolicLink() && current.nlink === 1 && current.ino === previous.ino && current.dev === previous.dev && current.size === previous.size && current.mtimeMs === previous.mtimeMs && current.ctimeMs === previous.ctimeMs, 'Un archivo del destino cambió. Se conservó sin reemplazarlo.');
      const backupRelative = `.gdc7/backups/${randomUUID()}/${relative}`;
      const backup = await safeParent(root, backupRelative);
      await fs.copyFile(destination, backup, constants.COPYFILE_EXCL);
      const after = await fs.lstat(destination);
      check(after.ino === current.ino && after.size === current.size && after.mtimeMs === current.mtimeMs && after.ctimeMs === current.ctimeMs, 'Un archivo cambió durante la copia de respaldo. Se conservó.');
      canceled(signal);
      // Commit is deliberately uninterrupted between removing the backed-up file and publishing.
      await fs.unlink(destination);
    }
    await fs.link(temporary, destination); return { reused: false, backedUp: Boolean(previous) };
  } finally { if (owned) { await safeParent(root, temporaryRelative); await fs.unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); } }
}
async function publishBytes(root, relative, data, signal) {
  const stagingRelative = `.gdc7/staging/generated-${randomUUID()}.part`;
  const staging = await safeParent(root, stagingRelative);
  await fs.writeFile(staging, data, { flag: 'wx', mode: 0o600 });
  try { return await publish(root, relative, staging, bytesArtifact(data), signal); }
  finally { await safeParent(root, stagingRelative); await fs.unlink(staging); }
}
async function assertWindows64(file) {
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const header = Buffer.alloc(64); const first = await handle.read(header, 0, 64, 0);
    check(first.bytesRead === 64 && header.toString('ascii', 0, 2) === 'MZ', 'Un ejecutable o nativo no tiene formato Windows.');
    const offset = header.readUInt32LE(0x3c); check(offset >= 64 && offset < 1024 * 1024, 'El encabezado del ejecutable no es válido.');
    const pe = Buffer.alloc(6); const next = await handle.read(pe, 0, 6, offset);
    check(next.bytesRead === 6 && pe.toString('binary', 0, 4) === 'PE\0\0' && pe.readUInt16LE(4) === 0x8664, 'Un ejecutable o nativo no corresponde a Windows x64.');
  } finally { await handle.close(); }
}
async function preserveAndRemove(root, relative, artifact, signal) {
  const file = await readPath(root, relative); await verifyFile(file, artifact, signal); const before = await fs.lstat(file);
  const backup = await safeParent(root, `.gdc7/backups/${randomUUID()}/${relative}`);
  await fs.copyFile(file, backup, constants.COPYFILE_EXCL); await verifyFile(backup, artifact, signal);
  const after = await fs.lstat(file);
  check(after.ino === before.ino && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, 'El mod opcional cambió mientras se desactivaba. Se conservó.');
  canceled(signal); await fs.unlink(file);
}
module.exports = { readPath, readVerifiedJson, bytesArtifact, publish, publishBytes, assertWindows64, preserveAndRemove };

