'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const { createHash, createPrivateKey, createPublicKey } = require('node:crypto');
const yauzl = require('yauzl');
const { CLIENT_PACK } = require('../client-pack.cjs');
const { validateProfilePath } = require('../profile-update.cjs');
const { signJson, verifySignedJson } = require('../update-signature.cjs');
const keys = require('../update-keys.cjs');

const MAX_FILE_BYTES = 512 * 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;
const CATEGORIES = new Set(['mod', 'config', 'resource', 'visual', 'other']);

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--') || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Uso: npm run prepare:profile-release -- --input <directorio> --version <semver> --private-key <ruta> --output <directorio>');
    options[argv[i].slice(2)] = argv[++i];
  }
  for (const key of ['input', 'version', 'output']) if (!options[key]) throw new Error(`Falta --${key}.`);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) throw new Error('La versión del perfil debe ser semver.');
  return options;
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hashes = { sha1: createHash('sha1'), sha256: createHash('sha256'), sha512: createHash('sha512') };
    const stream = require('node:fs').createReadStream(file);
    stream.on('data', chunk => Object.values(hashes).forEach(hash => hash.update(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Object.fromEntries(Object.entries(hashes).map(([name, hash]) => [name, hash.digest('hex')]))));
  });
}

function inside(root, file) { const relative = path.relative(root, file); return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); }

function jsonRequest(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'api.modrinth.com') return reject(new Error('La verificación de mods solo consulta la API oficial de Modrinth.'));
    const req = https.get(parsed, { headers: { 'user-agent': 'GDC7-Launcher-Release-Auditor/1', accept: 'application/json' }, timeout: 20000 }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`Modrinth respondió HTTP ${res.statusCode || 'desconocido'}.`)); return; }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) { res.destroy(); reject(new Error('Los metadatos oficiales superan el límite.')); } else chunks.push(chunk); });
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('Modrinth devolvió JSON inválido.')); } });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('La consulta a Modrinth tardó demasiado.')));
    req.on('error', reject);
  });
}

function compareVersion(left, right) {
  const parse = value => { const match = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(value); if (!match) throw new Error(`Rango NeoForge inválido: ${value}`); return { parts: match[1].split('.').map(Number), suffix: match[2] || '' }; };
  const a = parse(left), b = parse(right);
  for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i += 1) if ((a.parts[i] || 0) !== (b.parts[i] || 0)) return (a.parts[i] || 0) > (b.parts[i] || 0) ? 1 : -1;
  if (a.suffix === b.suffix) return 0;
  if (!a.suffix) return 1;
  if (!b.suffix) return -1;
  return a.suffix.localeCompare(b.suffix);
}

function rangeAllows(range, version) {
  if (range === '*') return true;
  const match = /^(\[|\()\s*([^,]*)\s*,\s*([^\]\)]*)\s*(\]|\))$/.exec(range);
  if (!match) throw new Error(`No se pudo interpretar el rango NeoForge ${range}.`);
  if (match[2]) { const cmp = compareVersion(version, match[2]); if (cmp < 0 || cmp === 0 && match[1] === '(') return false; }
  if (match[3]) { const cmp = compareVersion(version, match[3]); if (cmp > 0 || cmp === 0 && match[4] === ')') return false; }
  return true;
}

async function readZipEntry(file, wanted, maxBytes = 1024 * 1024) {
  const zip = await yauzl.openPromise(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  try {
    for await (const entry of zip.eachEntry()) {
      if (entry.fileName !== wanted) continue;
      if (entry.uncompressedSize > maxBytes || entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) throw new Error(`La entrada ${wanted} no es segura.`);
      const stream = await zip.openReadStreamPromise(entry); const chunks = []; let size = 0;
      for await (const chunk of stream) { size += chunk.length; if (size > maxBytes) throw new Error(`La entrada ${wanted} supera el tamaño permitido.`); chunks.push(chunk); }
      if (size !== entry.uncompressedSize) throw new Error(`La entrada ${wanted} está truncada.`);
      return Buffer.concat(chunks, size);
    }
    throw new Error(`El JAR no declara ${wanted}.`);
  } finally { zip.close(); }
}

async function verifyJarRange(file) {
  const text = (await readZipEntry(file, 'META-INF/neoforge.mods.toml')).toString('utf8');
  const sections = text.match(/\[\[dependencies\.[^\]]+\]\][\s\S]*?(?=\[\[|$)/g) || [];
  const dependencies = sections.filter(block => /\bmodId\s*=\s*"neoforge"/.test(block));
  if (!dependencies.length) throw new Error(`El JAR ${path.basename(file)} no declara una dependencia NeoForge explícita.`);
  const ranges = dependencies.map(block => /\bversionRange\s*=\s*"([^"]+)"/.exec(block)?.[1]).filter(Boolean);
  if (!ranges.length || !ranges.some(range => rangeAllows(range, CLIENT_PACK.loaderVersion))) throw new Error(`El JAR ${path.basename(file)} no declara compatibilidad con NeoForge ${CLIENT_PACK.loaderVersion}.`);
  return ranges;
}

function categoryFor(relative, categories) {
  const explicit = categories?.[relative];
  if (explicit) { if (!CATEGORIES.has(explicit)) throw new Error(`Categoría inválida para ${relative}.`); return explicit; }
  if (relative.startsWith('mods/')) return 'mod';
  if (relative.startsWith('config/')) return 'config';
  if (relative.startsWith('resourcepacks/')) return 'resource';
  if (relative.startsWith('shaderpacks/')) return 'visual';
  return 'other';
}

async function walkFiles(root, current = root, result = []) {
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error('El contenido de la release no puede incluir enlaces simbólicos.');
    if (entry.isDirectory()) await walkFiles(root, full, result);
    else if (entry.isFile()) result.push({ source: full, relative: path.relative(root, full).split(path.sep).join('/') });
    else throw new Error('El contenido de la release incluye un tipo de archivo no permitido.');
  }
  return result;
}

async function inspectModrinthJar(file, pathInProfile, audit) {
  if (!audit || !/^[A-Za-z0-9]{1,20}$/.test(audit.projectId || '') || !/^[A-Za-z0-9]{1,20}$/.test(audit.versionId || '')) throw new Error(`Falta auditoría oficial de Modrinth para ${pathInProfile}.`);
  const version = await jsonRequest(`https://api.modrinth.com/v2/version/${encodeURIComponent(audit.versionId)}`);
  if (version.project_id !== audit.projectId || !Array.isArray(version.game_versions) || !version.game_versions.includes(CLIENT_PACK.minecraft) || !Array.isArray(version.loaders) || !version.loaders.includes(CLIENT_PACK.loaderId)) throw new Error(`La versión oficial declarada para ${pathInProfile} no admite el objetivo GDC7 exacto.`);
  const project = await jsonRequest(`https://api.modrinth.com/v2/project/${encodeURIComponent(audit.projectId)}`);
  if (!project || project.client_side === 'unsupported') throw new Error(`El proyecto ${audit.projectId} no admite el cliente Minecraft.`);
  const local = await hashFile(file);
  const officialFile = (version.files || []).find(entry => entry.hashes?.sha1 === local.sha1 || entry.hashes?.sha512 === local.sha512);
  if (!officialFile) throw new Error(`El hash de ${pathInProfile} no coincide con el archivo publicado por Modrinth.`);
  const neoforgeRanges = await verifyJarRange(file);
  const required = (version.dependencies || []).filter(entry => entry.dependency_type === 'required');
  return {
    path: pathInProfile,
    projectId: audit.projectId,
    versionId: audit.versionId,
    versionNumber: version.version_number,
    source: `https://modrinth.com/mod/${project.slug}/version/${version.id}`,
    gameVersions: version.game_versions,
    loaders: version.loaders,
    side: { client: project.client_side, server: project.server_side },
    requiredDependencies: required.map(item => ({ projectId: item.project_id || null, versionId: item.version_id || null })),
    neoforgeRanges,
    file: { filename: officialFile.filename, sha1: local.sha1, sha256: local.sha256, sha512: local.sha512 }
  };
}

async function inspectMrpack(file) {
  const bytes = await readZipEntry(file, 'modrinth.index.json', 4 * 1024 * 1024);
  const index = JSON.parse(bytes.toString('utf8'));
  if (index.game !== 'minecraft' || index.dependencies?.minecraft !== CLIENT_PACK.minecraft || index.dependencies?.neoforge !== CLIENT_PACK.loaderVersion || !Array.isArray(index.files)) throw new Error('El .mrpack no fija Minecraft 26.1.2 y NeoForge 26.1.2.95.');
  if (index.files.length > 1000) throw new Error('El .mrpack declara demasiados archivos.');
  const declared = new Set();
  for (const item of index.files) {
    if (typeof item.path !== 'string') throw new Error('El .mrpack contiene una ruta sin formato válido.');
    validateProfilePath(item.path);
    const folded = item.path.toLowerCase();
    if (declared.has(folded)) throw new Error('El .mrpack repite una ruta de archivo.');
    declared.add(folded);
    if (!Array.isArray(item.downloads) || !item.downloads.length || item.downloads.some(url => typeof url !== 'string' || !/^https:\/\/cdn\.modrinth\.com\//i.test(url)) || !/^[a-f0-9]{128}$/.test(item.hashes?.sha512 || '')) throw new Error(`El .mrpack no fija fuente y SHA-512 verificables para ${item.path}.`);
  }
  const mods = index.files.filter(fileEntry => fileEntry.path?.startsWith('mods/') && fileEntry.path.toLowerCase().endsWith('.jar'));
  if (!mods.length || mods.length !== index.files.length) throw new Error('El .mrpack debe declarar únicamente mods cliente en JAR.');

  const archive = await yauzl.openPromise(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true });
  const overrides = new Map();
  const archiveNames = new Set();
  let markerFound = false;
  let totalUncompressed = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      const name = entry.fileName;
      const foldedName = name.toLowerCase();
      if (archiveNames.has(foldedName)) throw new Error(`El .mrpack repite una ruta: ${name}`);
      archiveNames.add(foldedName);
      if (name === 'modrinth.index.json') continue;
      if (entry.isEncrypted() || ![0, 8].includes(entry.compressionMethod)) throw new Error(`El .mrpack contiene una entrada no segura: ${name}`);
      const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (unixType === 0xa000) throw new Error(`El .mrpack contiene un enlace simbólico: ${name}`);
      const isDirectory = name.endsWith('/');
      const targetPath = name.startsWith('overrides/') ? name.slice('overrides/'.length).replace(/\/$/, '') : '';
      if (!targetPath && (name === 'overrides/' || name === 'overrides')) continue;
      if (!targetPath) throw new Error(`El .mrpack contiene un archivo fuera de mods u overrides: ${name}`);
      if (isDirectory) continue;
      totalUncompressed += entry.uncompressedSize;
      if (entry.uncompressedSize > MAX_FILE_BYTES || totalUncompressed > MAX_TOTAL_BYTES) throw new Error('Los overrides del .mrpack superan los límites de tamaño.');
      const folded = targetPath.toLowerCase();
      if (overrides.has(folded)) throw new Error(`El .mrpack repite un override: ${targetPath}`);
      if (folded !== CLIENT_PACK.markerFile.toLowerCase()) throw new Error(`El .mrpack solo puede contener la marca GDC7 en overrides; declarà ${targetPath} como archivo firmado del perfil.`);
      const marker = JSON.parse((await readZipEntry(file, name, 4096)).toString('utf8'));
      const expectedMarker = { schema: 1, eventId: 'gdc7', profileId: CLIENT_PACK.id, version: CLIENT_PACK.version, minecraft: CLIENT_PACK.minecraft, loader: CLIENT_PACK.loaderVersion };
      if (!marker || Object.keys(marker).length !== Object.keys(expectedMarker).length || Object.entries(expectedMarker).some(([key, value]) => marker[key] !== value)) throw new Error('El .mrpack contiene una marca GDC7 inesperada.');
      markerFound = true;
      overrides.set(folded, targetPath);
    }
  } finally { archive.close(); }
  if (!markerFound) throw new Error('El .mrpack no contiene la marca interna de GDC7 requerida para aislar la instancia.');
  return { name: index.name, versionId: index.versionId, modFiles: mods.map(item => ({ path: item.path, sha512: item.hashes.sha512, downloads: item.downloads })), overrides: [...overrides.values()] };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const inputRoot = await fs.realpath(path.resolve(options.input));
  const descriptionPath = path.join(inputRoot, 'release.json');
  const description = JSON.parse(await fs.readFile(descriptionPath, 'utf8'));
  if (description.schema !== 1 || description.eventId !== 'gdc7' || description.channel !== 'stable' || !description.target || description.target.minecraft !== CLIENT_PACK.minecraft || description.target.loader !== CLIENT_PACK.loaderId || description.target.loaderVersion !== CLIENT_PACK.loaderVersion || description.target.javaMajor !== CLIENT_PACK.javaMajor || description.target.installSide !== 'client') throw new Error('La release debe corresponder a GDC7 para Minecraft 26.1.2, NeoForge 26.1.2.95 y Java 25.');
  if (typeof description.notes !== 'string' || description.notes.length > 10000 || !Array.isArray(description.mods)) throw new Error('release.json debe declarar notas y auditorías oficiales de mods.');
  const filesRoot = path.join(inputRoot, 'files');
  const rawFiles = await walkFiles(filesRoot);
  if (!rawFiles.length || rawFiles.length > 1000) throw new Error('La release debe contener entre 1 y 1000 archivos.');
  const inputMods = new Map(description.mods.map(mod => [mod.path, mod]));
  for (const mod of description.mods) {
    if (!mod || typeof mod.path !== 'string') throw new Error('release.json contiene una ruta de auditoría de mod inválida.');
    validateProfilePath(mod.path);
  }
  const verifiedMods = [];
  let total = 0;
  for (const item of rawFiles) {
    validateProfilePath(item.relative);
    const stat = await fs.lstat(item.source);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > MAX_FILE_BYTES) throw new Error(`Archivo inválido o demasiado grande: ${item.relative}`);
    total += stat.size;
    if (total > MAX_TOTAL_BYTES) throw new Error('El tamaño total de la release supera el límite permitido.');
    const category = categoryFor(item.relative, description.categories);
    if (item.relative.toLowerCase().endsWith('.jar')) {
      if (category !== 'mod') throw new Error(`El JAR ${item.relative} debe ser categoría mod.`);
      verifiedMods.push(await inspectModrinthJar(item.source, item.relative, inputMods.get(item.relative)));
    }
  }
  const auditByProject = new Map(verifiedMods.map(item => [item.projectId, item]));
  for (const mod of verifiedMods) for (const dependency of mod.requiredDependencies) {
    if (!dependency.projectId || !auditByProject.has(dependency.projectId)) throw new Error(`Falta la dependencia obligatoria ${dependency.projectId || ''} de ${mod.path}.`);
    if (dependency.versionId && auditByProject.get(dependency.projectId).versionId !== dependency.versionId) throw new Error(`La versión fijada de una dependencia de ${mod.path} no coincide.`);
  }

  const outputRoot = path.resolve(options.output);
  await fs.mkdir(path.dirname(outputRoot), { recursive: true });
  await fs.mkdir(outputRoot, { recursive: false });
  const assetsRoot = path.join(outputRoot, 'assets');
  await fs.mkdir(assetsRoot);
  const releaseBase = `https://github.com/juanizuq123-cmyk/GDC7-Launcher/releases/download/gdc7-profile-${options.version}/`;
  const manifestFiles = [];
  const checksums = [];
  for (const item of rawFiles) {
    const hashes = await hashFile(item.source);
    const assetName = `${hashes.sha256.slice(0, 16)}-${path.posix.basename(item.relative)}`;
    const assetTarget = path.join(assetsRoot, assetName);
    await fs.copyFile(item.source, assetTarget, { flag: 'wx' });
    const copiedHashes = await hashFile(assetTarget);
    if (copiedHashes.sha256 !== hashes.sha256 || copiedHashes.sha512 !== hashes.sha512) throw new Error(`El archivo copiado no coincide con ${item.relative}.`);
    manifestFiles.push({ path: item.relative, size: (await fs.stat(assetTarget)).size, sha256: hashes.sha256, sha512: hashes.sha512, url: releaseBase + encodeURIComponent(assetName), category: categoryFor(item.relative, description.categories) });
    checksums.push(`${hashes.sha256}  ${item.relative}`);
  }

  let installPack;
  if (description.installPack) {
    if (typeof description.installPack !== 'string' || !/^GDC7-Client-[A-Za-z0-9.+-]+\.mrpack$/.test(path.basename(description.installPack)) || description.installPack.includes('/') || description.installPack.includes('\\')) throw new Error('installPack debe ser un archivo .mrpack de GDC7 en la raíz de entrada.');
    const packSource = path.resolve(inputRoot, description.installPack);
    if (!inside(inputRoot, packSource)) throw new Error('installPack debe estar dentro del directorio de entrada.');
    const packStat = await fs.lstat(packSource);
    if (!packStat.isFile() || packStat.isSymbolicLink() || packStat.nlink !== 1 || packStat.size > MAX_TOTAL_BYTES) throw new Error('El pack de instalación no es válido.');
    const packIndex = await inspectMrpack(packSource);
    const packMods = new Map(packIndex.modFiles.map(entry => [entry.path, entry.sha512]));
    const releaseMods = new Map(manifestFiles.filter(entry => entry.category === 'mod' && entry.path.toLowerCase().endsWith('.jar')).map(entry => [entry.path, entry.sha512]));
    if (packMods.size !== releaseMods.size) throw new Error('El .mrpack y la lista de JAR del manifiesto deben contener exactamente los mismos archivos.');
    for (const [modPath, modHash] of packMods) if (releaseMods.get(modPath) !== modHash) throw new Error(`El .mrpack y los JAR del release no coinciden en ${modPath}.`);
    if (packIndex.overrides.some(overridePath => overridePath.toLowerCase() !== CLIENT_PACK.markerFile.toLowerCase())) throw new Error('El .mrpack contiene overrides que no administra el manifiesto firmado.');
    const hashes = await hashFile(packSource);
    const assetName = `${hashes.sha256.slice(0, 16)}-${path.basename(packSource)}`;
    await fs.copyFile(packSource, path.join(assetsRoot, assetName), { flag: 'wx' });
    installPack = { filename: path.basename(packSource), size: packStat.size, sha256: hashes.sha256, sha512: hashes.sha512, url: releaseBase + encodeURIComponent(assetName), audit: packIndex };
    checksums.push(`${hashes.sha256}  ${path.basename(packSource)}`);
  }

  const unsignedManifest = {
    schema: 1,
    eventId: 'gdc7',
    channel: 'stable',
    releaseId: options.version,
    publishedAt: description.publishedAt || new Date().toISOString(),
    minLauncherVersion: description.minLauncherVersion || '0.1.0',
    target: { minecraft: CLIENT_PACK.minecraft, loader: CLIENT_PACK.loaderId, loaderVersion: CLIENT_PACK.loaderVersion, javaMajor: CLIENT_PACK.javaMajor, installSide: 'client' },
    notes: description.notes,
    files: manifestFiles.sort((a, b) => a.path.localeCompare(b.path)),
    ...(installPack ? { installPack } : {})
  };
  if (options['private-key']) process.env.GDC7_PROFILE_SIGNING_KEY_PATH = options['private-key'];
  const pem = process.env.GDC7_PROFILE_SIGNING_KEY || await fs.readFile(process.env.GDC7_PROFILE_SIGNING_KEY_PATH || '', 'utf8');
  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  if (publicKey !== keys.profile) throw new Error('La clave privada no corresponde a la clave pública GDC7 incluida en el launcher.');
  const manifestBytes = signJson(unsignedManifest, pem);
  verifySignedJson(manifestBytes, publicKey);
  require('../profile-update.cjs').validateProfileManifest(manifestBytes, publicKey);
  const manifestPath = path.join(outputRoot, 'manifest.json');
  await fs.writeFile(manifestPath, manifestBytes, { flag: 'wx' });
  await fs.writeFile(path.join(outputRoot, 'sha256sums.txt'), checksums.join('\n') + '\n', { flag: 'wx' });
  await fs.writeFile(path.join(outputRoot, 'audit.json'), JSON.stringify({ schema: 1, eventId: 'gdc7', target: unsignedManifest.target, verifiedOfficialMods: verifiedMods, installPack: installPack?.audit || null }, null, 2) + '\n', { flag: 'wx' });
  process.stdout.write(JSON.stringify({ releaseId: options.version, manifest: manifestPath, files: manifestFiles.length, verifiedMods: verifiedMods.length, installerPack: Boolean(installPack), sha256: createHash('sha256').update(manifestBytes).digest('hex') }) + '\n');
}

main().catch(error => { process.stderr.write((error?.message || 'No se pudo preparar la release GDC7.') + '\n'); process.exitCode = 1; });
