'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { CONSTRUCTOR_PROFILE } = require('../boreal-constructor.cjs');
const { BOREAL_PROFILE } = require('../boreal-profile.cjs');

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main(args = process.argv.slice(2)) {
  if (args.length !== 3) throw new Error('Uso: node scripts/verify-boreal-profile-release.cjs <manifiesto.json> <pack.mrpack> <tag>');
  const [manifestPath, packPath, tag] = args.map((value, index) => index < 2 ? path.resolve(value) : value);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const constructor = manifest.eventId === CONSTRUCTOR_PROFILE.eventId;
  const approved = constructor ? CONSTRUCTOR_PROFILE : manifest.eventId === BOREAL_PROFILE.eventId ? BOREAL_PROFILE : null;
  if (!approved) throw new Error('El archivo no pertenece a un perfil Boreal conocido.');
  const expectedTag = `${manifest.eventId}-${manifest.releaseId}`;
  if (tag !== expectedTag || typeof manifest.releaseId !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(manifest.releaseId)) throw new Error('El tag publicado no coincide con el ID de release del manifiesto.');
  const target = manifest.target;
  if (!target || target.minecraft !== approved.minecraft || target.loader !== 'neoforge' || target.loaderVersion !== approved.loaderVersion || target.javaMajor !== approved.javaMajor || target.installSide !== 'client') throw new Error('El release no declara el objetivo cliente aprobado de Minecraft/NeoForge/Java.');
  const pack = manifest.installPack;
  if (!pack || path.basename(packPath) !== pack.filename || !Number.isSafeInteger(pack.size) || pack.size < 1 || pack.size > 2 * 1024 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(pack.sha256 || '')) throw new Error('El pack y los datos del manifiesto no coinciden.');
  const stat = await fs.stat(packPath);
  if (!stat.isFile() || stat.size !== pack.size || await sha256(packPath) !== pack.sha256) throw new Error('El tamaño o SHA-256 del pack no coincide con el manifiesto de entrada.');
  process.stdout.write(JSON.stringify({ eventId: manifest.eventId, releaseId: manifest.releaseId, tag, filename: pack.filename, bytes: stat.size, sha256: pack.sha256, target: { minecraft: target.minecraft, loader: target.loaderVersion, javaMajor: target.javaMajor } }) + '\n');
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error?.message || 'No se pudo validar el perfil Boreal.'}\n`); process.exitCode = 1; });

module.exports = { main, sha256 };
