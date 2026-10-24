'use strict';

const { createHash } = require('node:crypto');
const { verifySignedJson } = require('./update-signature.cjs');
const { safeRelative } = require('./file-safety.cjs');
const { CLIENT_PACK } = require('./client-pack.cjs');

const PROFILE_CHANNEL_URL = 'https://juanizuq123-cmyk.github.io/GDC7-Launcher/channels/gdc7/stable.json';
const RELEASE_BASE = 'https://github.com/juanizuq123-cmyk/GDC7-Launcher/releases/download/';
const CATEGORIES = new Set(['mod', 'config', 'resource', 'visual', 'other']);
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const MAX_FILES = 1000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_FILE_BYTES = 512 * 1024 * 1024;
const BLOCKED_ROOTS = new Set(['saves', 'screenshots', 'logs', 'crash-reports', 'servers.dat', 'options.txt', 'optionsof.txt', 'usercache.json', 'launcher_profiles.json']);

function validateProfilePath(filePath) {
  safeRelative(filePath);
  const folded = filePath.toLowerCase();
  const first = folded.split('/')[0];
  if (BLOCKED_ROOTS.has(folded) || BLOCKED_ROOTS.has(first) || folded === CLIENT_PACK.markerFile.toLowerCase() || folded === '.gdc7-launcher' || folded.startsWith('.gdc7-launcher/')) throw new Error('El manifiesto intenta modificar datos personales o archivos reservados del launcher.');
  return filePath;
}

function validateTarget(target) {
  if (!target || typeof target !== 'object' || typeof target.minecraft !== 'string' || typeof target.loader !== 'string' || typeof target.loaderVersion !== 'string' || !Number.isInteger(target.javaMajor)) throw new Error('El manifiesto no declara un objetivo de Minecraft verificable.');
  if (target.minecraft !== CLIENT_PACK.minecraft || target.loader !== CLIENT_PACK.loaderId || target.loaderVersion !== CLIENT_PACK.loaderVersion || target.javaMajor !== CLIENT_PACK.javaMajor) {
    const error = new Error('La versión objetivo del canal cambió. Se conservó el perfil actual hasta preparar y verificar una instancia nueva.');
    error.code = 'TARGET_CHANGE_PENDING';
    throw error;
  }
  if (target.installSide !== 'client') throw new Error('El canal no corresponde al perfil cliente GDC7.');
  return target;
}

function validateProfileManifest(bytes, publicKey, { channelUrl = PROFILE_CHANNEL_URL } = {}) {
  const document = verifySignedJson(bytes, publicKey);
  if (document.schema !== 1 || document.eventId !== 'gdc7' || document.channel !== 'stable' || !SEMVER.test(document.releaseId) || !SEMVER.test(document.minLauncherVersion || '0.0.0')) throw new Error('El manifiesto no corresponde al canal estable de GDC7.');
  validateTarget(document.target);
  if (!Array.isArray(document.files) || document.files.length > MAX_FILES || typeof document.notes !== 'string' || document.notes.length > 10000) throw new Error('El manifiesto GDC7 está incompleto o supera los límites.');
  const seen = new Set(); let total = 0;
  for (const file of document.files) {
    if (!file || typeof file !== 'object' || typeof file.path !== 'string' || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES || !/^[a-f0-9]{64}$/.test(file.sha256) || !/^[a-f0-9]{128}$/.test(file.sha512 || '') || !CATEGORIES.has(file.category)) throw new Error('El manifiesto incluye un archivo inválido.');
    validateProfilePath(file.path);
    const folded = file.path.toLowerCase();
    if (seen.has(folded)) throw new Error('El manifiesto repite una ruta de archivo.');
    seen.add(folded); total += file.size;
    if (total > MAX_TOTAL_BYTES) throw new Error('El tamaño total del perfil supera el límite permitido.');
    const url = new URL(file.url);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/juanizuq123-cmyk/GDC7-Launcher/releases/download/')) throw new Error('El archivo del perfil no procede de la release oficial de GDC7.');
    const expectedPrefix = `/juanizuq123-cmyk/GDC7-Launcher/releases/download/gdc7-profile-${document.releaseId}/`;
    if (!url.pathname.startsWith(expectedPrefix) || url.search || url.hash) throw new Error('El archivo no pertenece a la release declarada.');
  }
  if (document.installPack) {
    const pack = document.installPack;
    const url = new URL(pack.url);
    const releasePrefix = `${RELEASE_BASE}gdc7-profile-${document.releaseId}/`;
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.href.startsWith(releasePrefix) || !Number.isSafeInteger(pack.size) || pack.size < 1 || pack.size > MAX_TOTAL_BYTES || !/^[a-f0-9]{64}$/.test(pack.sha256) || !/^GDC7-Client-[A-Za-z0-9.+-]+\.mrpack$/.test(pack.filename)) throw new Error('El pack de instalación de la release no es válido.');
  }
  return { manifest: document, manifestSha256: createHash('sha256').update(bytes).digest('hex'), channelUrl };
}

function compareProfileManifests(previous, next) {
  const before = new Map((previous?.files || []).map(file => [file.path, file]));
  const after = new Map(next.files.map(file => [file.path, file]));
  const added = [], changed = [], removed = [];
  for (const [filePath, file] of after) {
    const old = before.get(filePath);
    if (!old) added.push({ path: filePath, category: file.category });
    else if (old.sha256 ? old.sha256 !== file.sha256 : old.sha512 ? old.sha512 !== file.sha512 : true) changed.push({ path: filePath, category: file.category });
  }
  for (const [filePath, file] of before) if (!after.has(filePath)) removed.push({ path: filePath, category: file.category });
  return { added, changed, removed };
}

module.exports = { PROFILE_CHANNEL_URL, MAX_FILES, MAX_TOTAL_BYTES, MAX_FILE_BYTES, validateTarget, validateProfilePath, validateProfileManifest, compareProfileManifests };
