'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

class DownloadError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function check(condition, code, message) {
  if (!condition) throw new DownloadError(code, message);
}

function canceled(signal) {
  if (signal?.aborted) throw signal.reason || new DownloadError('CANCELLED', 'Operación cancelada.');
}

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function safeRelative(relative) {
  check(typeof relative === 'string' && relative.length > 0 && !path.posix.isAbsolute(relative) && !relative.includes('\\'), 'UNSAFE_PATH', 'La ruta del archivo no es válida.');
  const parts = relative.split('/');
  check(parts.every(part => part && !['.', '..'].includes(part) && !/[\x00-\x1f<>:"|?*]/.test(part) && !/[. ]$/.test(part) && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)), 'UNSAFE_PATH', 'La ruta del archivo no es válida.');
  return parts;
}

function hashEntries(hashes) {
  const lengths = { sha512: 128, sha256: 64, sha1: 40 };
  const entries = Object.entries(hashes ?? {});
  check(entries.length > 0 && entries.every(([key, value]) => lengths[key] && typeof value === 'string' && new RegExp(`^[a-f0-9]{${lengths[key]}}$`).test(value)), 'INVALID_HASH', 'El manifiesto no tiene hashes válidos.');
  return entries;
}

async function safeRoot(directory) {
  check(path.isAbsolute(directory) && path.dirname(directory) !== directory, 'UNSAFE_PATH', 'La caché debe usar una carpeta propia.');
  await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory);
  check(stat.isDirectory() && !stat.isSymbolicLink(), 'UNSAFE_PATH', 'La caché no puede ser un enlace a otra carpeta.');
  return fs.realpath(directory);
}

async function safeParent(root, relative) {
  const parts = safeRelative(relative);
  let current = root;
  const rootStat = await fs.lstat(root);
  check(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'UNSAFE_PATH', 'La ruta de la caché cambió.');
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    try { await fs.mkdir(current); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    const stat = await fs.lstat(current);
    check(stat.isDirectory() && !stat.isSymbolicLink() && inside(root, await fs.realpath(current)), 'UNSAFE_PATH', 'Una carpeta de la caché es un enlace o salió de la ruta permitida.');
  }
  return path.join(current, parts.at(-1));
}

async function verifyFile(file, artifact, signal) {
  canceled(signal);
  const before = await fs.lstat(file);
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1, 'UNSAFE_FILE', 'Un archivo de la caché es un enlace o no es un archivo regular.');
  check(before.size === artifact.size, 'SIZE_MISMATCH', 'El tamaño recibido no coincide con el manifiesto.');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    check(opened.ino === before.ino && opened.dev === before.dev && opened.size === before.size, 'UNSAFE_FILE', 'El archivo cambió durante la comprobación.');
    const hashes = hashEntries(artifact.hashes).map(([algorithm, expected]) => ({ expected, hash: createHash(algorithm) }));
    const buffer = Buffer.alloc(256 * 1024);
    let size = 0;
    while (true) {
      canceled(signal);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      check(size <= artifact.size, 'SIZE_MISMATCH', 'El archivo cambió de tamaño.');
      for (const entry of hashes) entry.hash.update(buffer.subarray(0, bytesRead));
    }
    canceled(signal);
    const after = await handle.stat();
    check(size === artifact.size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs, 'SIZE_MISMATCH', 'El archivo cambió durante la comprobación.');
    check(hashes.every(entry => entry.hash.digest('hex') === entry.expected), 'HASH_MISMATCH', 'El archivo recibido está dañado o no coincide con el manifiesto.');
  } finally { await handle.close(); }
}

module.exports = { DownloadError, check, canceled, safeRelative, safeRoot, safeParent, verifyFile };
