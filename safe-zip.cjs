'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { crc32 } = require('node:zlib');
const yauzl = require('yauzl');
const { DownloadError, safeRelative, safeParent, canceled } = require('./file-safety.cjs');
const check = (v, m) => { if (!v) throw new DownloadError('UNSAFE_ARCHIVE', m); };
// Reading the verified archive also derives the expected hashes for extracted files.
// An on-disk receipt never supplies trusted paths or trusted extracted hashes.
async function readZip(file, { select = name => name, stageDir, signal, maxEntries = 10000, maxBytes = 1024 * 1024 * 1024, maxFileBytes = 256 * 1024 * 1024 } = {}) {
  canceled(signal);
  const zip = await yauzl.openPromise(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  const names = new Map(), destinations = new Set(), result = []; let total = 0, count = 0;
  try {
    for await (const entry of zip.eachEntry()) {
      canceled(signal); check(++count <= maxEntries, 'El archivo comprimido contiene demasiadas entradas.');
      const directory = entry.fileName.endsWith('/'); const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
      safeRelative(name);
      const key = name.toLowerCase(), kind = (entry.externalFileAttributes >>> 16) & 0xf000;
      check(!names.has(key), 'El archivo comprimido repite una ruta (incluyendo mayúsculas).'); names.set(key, directory);
      check(!entry.isEncrypted() && [0, 8].includes(entry.compressionMethod) && (!kind || kind === (directory ? 0x4000 : 0x8000)), 'El archivo comprimido contiene enlaces, archivos especiales o un formato no admitido.');
      check(Number.isSafeInteger(entry.uncompressedSize) && entry.uncompressedSize <= maxFileBytes, 'Una entrada del archivo comprimido supera el tamaño permitido.');
      total += entry.uncompressedSize; check(total <= maxBytes, 'El archivo comprimido supera el tamaño de extracción permitido.');
      if (directory) continue;
      const relative = select(name); if (relative === null) continue;
      check(typeof relative === 'string', 'El destino de extracción no es válido.'); safeRelative(relative);
      check(!destinations.has(relative.toLowerCase()), 'Dos entradas comparten un destino de extracción.'); destinations.add(relative.toLowerCase());
      const stream = await zip.openReadStreamPromise(entry);
      const abort = () => stream.destroy(signal.reason); signal?.addEventListener('abort', abort, { once: true });
      let handle, source, size = 0, crc = 0; const hash = createHash('sha256');
      try {
        if (stageDir) { source = await safeParent(stageDir, relative); handle = await fs.open(source, 'wx', 0o600); }
        for await (const value of stream) {
          canceled(signal); const chunk = Buffer.from(value); size += chunk.length;
          check(size <= entry.uncompressedSize && size <= maxFileBytes, 'Una entrada extraída superó su tamaño anunciado.');
          crc = crc32(chunk, crc); hash.update(chunk);
          if (handle) { let offset = 0; while (offset < chunk.length) { const { bytesWritten } = await handle.write(chunk, offset, chunk.length - offset, null); check(bytesWritten > 0, 'No se pudo escribir una entrada extraída.'); offset += bytesWritten; } }
        }
        canceled(signal); check(size === entry.uncompressedSize && crc === entry.crc32, 'Una entrada extraída tiene un tamaño o CRC incorrecto.');
        if (handle) await handle.sync();
        result.push({ target: relative, source, size, hashes: { sha256: hash.digest('hex') } });
      } finally { signal?.removeEventListener('abort', abort); stream.destroy(); if (handle) await handle.close(); }
    }
    // Detect file/directory ambiguity even when the conflicting entry was excluded.
    for (const [name] of names) { const parts = name.split('/'); while (parts.length > 1) { parts.pop(); check(names.get(parts.join('/')) !== false, 'Una entrada usa otra entrada de archivo como carpeta.'); } }
    check(result.length > 0, 'El archivo comprimido no contiene los archivos esperados.'); return result;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (error instanceof DownloadError) throw error;
    throw new DownloadError('UNSAFE_ARCHIVE', 'No se pudo leer el ZIP/JAR: está dañado o contiene rutas no permitidas.');
  } finally { zip.close(); }
}
function javaSelection(runtimeDir, releaseName) {
  const prefix = `${releaseName}-jre/`;
  return name => { check(name.startsWith(prefix), 'El runtime contiene una ruta fuera de su carpeta prevista.'); return `${runtimeDir}/${name.slice(prefix.length)}`; };
}
function nativeSelection(nativeDir, exclude = ['META-INF/']) {
  check(Array.isArray(exclude) && exclude.every(p => typeof p === 'string' && p.length > 0 && !p.includes('..') && !p.includes('\\')), 'Las exclusiones del archivo nativo no son válidas.');
  return name => exclude.some(prefix => name.startsWith(prefix)) || !name.toLowerCase().endsWith('.dll') ? null : `${nativeDir}/${path.posix.basename(name)}`;
}
module.exports = { readZip, javaSelection, nativeSelection };

