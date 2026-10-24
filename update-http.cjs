'use strict';

const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

const TRUSTED_HOSTS = new Set(['juanizuq123-cmyk.github.io', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);

function validUrl(value, trustedHosts = TRUSTED_HOSTS) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !trustedHosts.has(url.hostname.toLowerCase())) throw new Error('La actualización apunta a un origen no permitido.');
  return url;
}

function response(url, signal, redirects = 0, trustedHosts = TRUSTED_HOSTS, userAgent = 'GDC7-Launcher-Updater/1') {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error('Operación cancelada.'));
  const parsed = validUrl(url, trustedHosts);
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, { headers: { 'user-agent': userAgent, accept: 'application/octet-stream, application/json, text/yaml', 'cache-control': 'no-cache' }, timeout: 30000 }, result => {
      if ([301, 302, 303, 307, 308].includes(result.statusCode) && result.headers.location) {
        result.resume();
        if (redirects >= 5) return reject(new Error('El servidor redirigió demasiadas veces.'));
        let next;
        try { next = new URL(result.headers.location, parsed).toString(); validUrl(next, trustedHosts); } catch { return reject(new Error('La redirección apunta a un origen no permitido.')); }
        response(next, signal, redirects + 1, trustedHosts, userAgent).then(resolve, reject);
        return;
      }
      if (result.statusCode !== 200) { result.resume(); reject(new Error(`El canal respondió HTTP ${result.statusCode || 'desconocido'}.`)); return; }
      resolve(result);
    });
    const abort = () => request.destroy(signal.reason || new Error('Operación cancelada.'));
    signal?.addEventListener('abort', abort, { once: true });
    request.on('close', () => signal?.removeEventListener('abort', abort));
    request.on('timeout', () => request.destroy(new Error('El canal tardó demasiado en responder.')));
    request.on('error', reject);
  });
}

async function getBytes(url, { maxBytes = 4 * 1024 * 1024, signal, trustedHosts, userAgent } = {}) {
  const allowedHosts = trustedHosts === undefined ? TRUSTED_HOSTS : new Set(trustedHosts);
  const res = await response(url, signal, 0, allowedHosts, userAgent);
  const chunks = []; let size = 0;
  for await (const chunk of res) {
    if (signal?.aborted) throw signal.reason || new Error('Operación cancelada.');
    size += chunk.length;
    if (size > maxBytes) { res.destroy(); throw new Error('La respuesta supera el tamaño permitido.'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

async function downloadToFile(url, destination, { maxBytes, signal, trustedHosts, userAgent } = {}) {
  const allowedHosts = trustedHosts === undefined ? TRUSTED_HOSTS : new Set(trustedHosts);
  const res = await response(url, signal, 0, allowedHosts, userAgent);
  const headerSize = Number(res.headers['content-length']);
  if (Number.isFinite(maxBytes) && headerSize > maxBytes) { res.destroy(); throw new Error('El archivo supera el tamaño permitido.'); }
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  let bytes = 0;
  const meter = new (require('node:stream').Transform)({ transform(chunk, _encoding, callback) { bytes += chunk.length; callback(Number.isFinite(maxBytes) && bytes > maxBytes ? new Error('El archivo supera el tamaño permitido.') : null, chunk); } });
  const sink = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 });
  const abort = () => { res.destroy(signal.reason || new Error('Operación cancelada.')); sink.destroy(signal.reason || new Error('Operación cancelada.')); };
  signal?.addEventListener('abort', abort, { once: true });
  try { await pipeline(res, meter, sink); return { bytes }; }
  finally { signal?.removeEventListener('abort', abort); }
}

module.exports = { TRUSTED_HOSTS, validUrl, getBytes, downloadToFile };
