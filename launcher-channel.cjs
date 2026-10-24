'use strict';

const { parse } = require('yaml');
const { verifySignedJson } = require('./update-signature.cjs');
const { getBytes } = require('./update-http.cjs');

const LAUNCHER_CHANNEL_URL = 'https://juanizuq123-cmyk.github.io/GDC7-Launcher/updates/launcher/stable/latest.json';
const LAUNCHER_YML_URL = 'https://juanizuq123-cmyk.github.io/GDC7-Launcher/updates/launcher/stable/latest.yml';
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function sha512Hex(value) {
  if (typeof value !== 'string') throw new Error('SHA-512 inválido en latest.yml.');
  if (/^[a-f0-9]{128}$/i.test(value)) return value.toLowerCase();
  if (!/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(value)) throw new Error('SHA-512 inválido en latest.yml.');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== value) throw new Error('SHA-512 inválido en latest.yml.');
  return bytes.toString('hex');
}

function validateLauncherPointer(bytes, publicKey) {
  const pointer = verifySignedJson(bytes, publicKey);
  if (pointer.schema !== 1 || pointer.channel !== 'stable' || !SEMVER.test(pointer.version) || !Number.isSafeInteger(pointer.size) || pointer.size < 1 || pointer.size > 1024 * 1024 * 1024 || !/^[a-f0-9]{128}$/.test(pointer.sha512) || typeof pointer.notes !== 'string' || pointer.notes.length > 10000) throw new Error('El canal del launcher tiene datos inválidos.');
  const artifact = new URL(pointer.assetUrl);
  if (artifact.protocol !== 'https:' || artifact.hostname !== 'github.com' || !artifact.pathname.startsWith(`/juanizuq123-cmyk/GDC7-Launcher/releases/download/launcher-v${pointer.version}/`) || !artifact.pathname.toLowerCase().endsWith('.exe') || artifact.search || artifact.hash) throw new Error('El instalador no pertenece a la release oficial declarada.');
  if (pointer.latestYmlUrl !== LAUNCHER_YML_URL) throw new Error('El canal de metadatos del instalador no coincide.');
  return pointer;
}

function verifyLatestYml(text, pointer) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 1024 * 1024) throw new Error('El metadato del instalador supera el tamaño permitido.');
  const yml = parse(text, { uniqueKeys: true, maxAliasCount: 0 });
  if (!yml || typeof yml !== 'object' || yml.version !== pointer.version || !Array.isArray(yml.files)) throw new Error('latest.yml no coincide con la versión firmada.');
  const files = yml.files.filter(item => item && (item.url || item.path) && String(item.url || item.path).toLowerCase().endsWith('.exe'));
  const file = files.length === 1 ? files[0] : null;
  if (!file) throw new Error('latest.yml debe anunciar un único instalador Windows.');
  const assetUrl = new URL(file.url || file.path, LAUNCHER_YML_URL).toString();
  const size = file.size ?? yml.size;
  const sha512 = sha512Hex(file.sha512 || yml.sha512);
  if (assetUrl !== pointer.assetUrl || size !== pointer.size || sha512 !== pointer.sha512) throw new Error('El instalador y latest.yml no coinciden con el canal firmado.');
  return { version: yml.version, assetUrl, size, sha512, files: yml.files };
}

class LauncherChannel {
  constructor({ channelUrl = LAUNCHER_CHANNEL_URL, ymlUrl = LAUNCHER_YML_URL, publicKey, request = getBytes } = {}) {
    this.channelUrl = channelUrl; this.ymlUrl = ymlUrl; this.publicKey = publicKey; this.request = request;
  }

  async check(signal) {
    const bytes = await this.request(this.channelUrl, { maxBytes: 4 * 1024 * 1024, signal });
    const pointer = validateLauncherPointer(bytes, this.publicKey);
    const ymlBytes = await this.request(this.ymlUrl, { maxBytes: 1024 * 1024, signal });
    const metadata = verifyLatestYml(ymlBytes.toString('utf8'), pointer);
    return { pointer, metadata };
  }
}

module.exports = { LAUNCHER_CHANNEL_URL, LAUNCHER_YML_URL, validateLauncherPointer, verifyLatestYml, sha512Hex, LauncherChannel };
