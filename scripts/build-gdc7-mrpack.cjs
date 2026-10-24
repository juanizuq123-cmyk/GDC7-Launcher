'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CLIENT_PACK } = require('../client-pack.cjs');

const root = path.resolve(__dirname, '..');
const sources = path.join(root, 'pack', 'source');
const outputDir = path.join(root, 'provider', 'packs');
const output = path.join(outputDir, CLIENT_PACK.packFile);
const marker = {
  schema: 1,
  eventId: 'gdc7',
  profileId: CLIENT_PACK.id,
  version: CLIENT_PACK.version,
  minecraft: CLIENT_PACK.minecraft,
  loader: CLIENT_PACK.loaderVersion
};

function assert(value, message) { if (!value) throw new Error(message); }

function compareVersions(left, right) {
  const parse = value => {
    const match = /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
    assert(match, `Versión NeoForge no reconocida: ${value}`);
    return { numbers: match[1].split('.').map(Number), prerelease: match[2] || null };
  };
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.numbers.length, b.numbers.length);
  for (let i = 0; i < length; i += 1) {
    const delta = (a.numbers[i] || 0) - (b.numbers[i] || 0);
    if (delta) return Math.sign(delta);
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, 'en', { numeric: true });
}

async function loadManifest() {
  const manifest = JSON.parse(await fs.readFile(path.join(sources, CLIENT_PACK.sourceManifest), 'utf8'));
  const target = manifest.target;
  assert(manifest.schemaVersion === 1 && manifest.eventId === 'gdc7', 'El manifiesto no pertenece a GDC7 o usa un esquema desconocido.');
  assert(manifest.id === CLIENT_PACK.id && manifest.version === CLIENT_PACK.version, 'El ID/versión del manifiesto no coincide con el launcher.');
  assert(target?.minecraft === CLIENT_PACK.minecraft, 'El manifiesto usa otra versión de Minecraft.');
  assert(target?.loader === CLIENT_PACK.loaderId && target?.loaderVersion === CLIENT_PACK.loaderVersion, 'El manifiesto no fija el NeoForge confirmado.');
  assert(target?.javaMajor === CLIENT_PACK.javaMajor && target?.installSide === 'client', 'El manifiesto no es el perfil cliente Java objetivo.');
  assert(Array.isArray(manifest.mods) && manifest.mods.length === CLIENT_PACK.modCount, 'La cantidad de mods fijada por el launcher no coincide con el manifiesto.');
  assert(manifest.gameplayModGdc7Included === false, 'El mod de gameplay GDC7 no debe formar parte del pack cliente.');
  assert(manifest.serverOnlyModsInstalledOnClient === false, 'Un mod solo servidor no puede estar en el pack cliente.');
  return manifest;
}

function normalizeMod(mod, selectedProjectIds, modIds) {
  assert(mod.modId && /^[a-z0-9_.-]+$/i.test(mod.modId), 'Falta un modId válido.');
  assert(!modIds.has(mod.modId), `Mod ID duplicado: ${mod.modId}`);
  modIds.add(mod.modId);
  assert(mod.projectId && /^[A-Za-z0-9]{8}$/.test(mod.projectId), `Falta el proyecto Modrinth de ${mod.name}.`);
  assert(mod.versionId && /^[A-Za-z0-9]{8}$/.test(mod.versionId), `Falta la versión oficial de ${mod.name}.`);
  assert(mod.gameVersions?.includes(CLIENT_PACK.minecraft), `${mod.name} no declara Minecraft ${CLIENT_PACK.minecraft}.`);
  assert(mod.loaders?.includes(CLIENT_PACK.loaderId), `${mod.name} no declara NeoForge.`);
  assert(['release', 'beta', 'alpha'].includes(mod.versionType), `Canal inválido para ${mod.name}.`);
  assert(['required', 'optional', 'unsupported'].includes(mod.env?.client), `Entorno cliente inválido en ${mod.name}.`);
  assert(['required', 'optional', 'unsupported'].includes(mod.env?.server), `Entorno servidor inválido en ${mod.name}.`);
  assert(mod.env.client !== 'unsupported', `${mod.name} no se puede instalar en el cliente.`);
  assert(mod.neoforgeMinimum && compareVersions(CLIENT_PACK.loaderVersion, mod.neoforgeMinimum) >= 0, `${mod.name} requiere NeoForge ${mod.neoforgeMinimum} o superior.`);
  if (mod.neoforgeMaximumExclusive) assert(compareVersions(CLIENT_PACK.loaderVersion, mod.neoforgeMaximumExclusive) < 0, `${mod.name} no acepta NeoForge ${CLIENT_PACK.loaderVersion}.`);

  const file = mod.file;
  assert(file && typeof file.filename === 'string' && /^[A-Za-z0-9_.+ -]+\.jar$/i.test(file.filename), `Nombre de JAR no válido para ${mod.name}.`);
  assert(Number.isSafeInteger(file.size) && file.size > 0, `Tamaño inválido para ${mod.name}.`);
  assert(/^[a-f0-9]{40}$/i.test(file.hashes?.sha1 || ''), `SHA-1 inválido para ${mod.name}.`);
  assert(/^[a-f0-9]{128}$/i.test(file.hashes?.sha512 || ''), `SHA-512 inválido para ${mod.name}.`);
  const url = new URL(file.url);
  assert(url.protocol === 'https:' && url.hostname === 'cdn.modrinth.com', `Origen no aprobado para ${mod.name}.`);
  assert(url.pathname.includes(`/versions/${mod.versionId}/`), `La URL de ${mod.name} no apunta a la versión fijada.`);

  for (const dependency of mod.dependencies || []) {
    assert(['required', 'optional', 'incompatible', 'embedded'].includes(dependency.type), `Tipo de dependencia inválido en ${mod.name}.`);
    if (dependency.type === 'required') assert(dependency.included === true && selectedProjectIds.has(dependency.projectId), `Falta la dependencia requerida ${dependency.name} de ${mod.name}.`);
  }

  return {
    path: `mods/${file.filename}`,
    hashes: { sha1: file.hashes.sha1, sha512: file.hashes.sha512 },
    env: { client: mod.env.client, server: mod.env.server },
    downloads: [url.href],
    fileSize: file.size
  };
}

function quotePowerShell(value) { return `'${value.replaceAll("'", "''")}'`; }

async function build() {
  const manifest = await loadManifest();
  const selectedProjectIds = new Set(manifest.mods.map(mod => mod.projectId));
  assert(selectedProjectIds.size === manifest.mods.length, 'Hay proyectos duplicados en la lista de mods.');
  const modIds = new Set();
  const files = manifest.mods.map(mod => normalizeMod(mod, selectedProjectIds, modIds));
  assert(!modIds.has('gdc7') && !modIds.has('jei'), 'El pack no puede traer el mod GDC7 ni JEI.');

  const index = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: `${CLIENT_PACK.id}-${CLIENT_PACK.version}`,
    name: CLIENT_PACK.name,
    summary: CLIENT_PACK.summary,
    files,
    dependencies: {
      minecraft: CLIENT_PACK.minecraft,
      [CLIENT_PACK.loaderId]: CLIENT_PACK.loaderVersion
    }
  };

  const work = path.join(root, 'work');
  const stage = path.join(work, `mrpack-${process.pid}`);
  const archiveTemp = path.join(work, `GDC7-${process.pid}.mrpack.tmp`);
  await fs.mkdir(work, { recursive: true });
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(path.join(stage, 'overrides', 'config'), { recursive: true });
  await fs.writeFile(path.join(stage, 'modrinth.index.json'), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(stage, 'overrides', CLIENT_PACK.markerFile), `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
  await fs.mkdir(outputDir, { recursive: true });
  await fs.rm(archiveTemp, { force: true });

  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const command = [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.IO.Compression',
    `$sourceRoot=${quotePowerShell(stage)}`,
    `$archivePath=${quotePowerShell(archiveTemp)}`,
    '$stream=[System.IO.File]::Open($archivePath,[System.IO.FileMode]::CreateNew)',
    '$archive=[System.IO.Compression.ZipArchive]::new($stream,[System.IO.Compression.ZipArchiveMode]::Create,$false)',
    'try { Get-ChildItem -LiteralPath $sourceRoot -File -Recurse | ForEach-Object { $entryName=$_.FullName.Substring($sourceRoot.Length).TrimStart([char[]]@([char]92,[char]47)).Replace([char]92,[char]47); $entry=$archive.CreateEntry($entryName,[System.IO.Compression.CompressionLevel]::Optimal); $inputStream=[System.IO.File]::OpenRead($_.FullName); $outputStream=$entry.Open(); try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() } } } finally { $archive.Dispose(); $stream.Dispose() }'
  ].join('; ');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    await fs.rm(stage, { recursive: true, force: true });
    await fs.rm(archiveTemp, { force: true });
    throw new Error((result.stderr || result.stdout || 'No se pudo crear el archivo Modrinth.').trim());
  }
  await fs.rm(stage, { recursive: true, force: true });
  await fs.rename(archiveTemp, output);
  const stat = await fs.stat(output);
  process.stdout.write(JSON.stringify({ output, bytes: stat.size, mods: files.length, minecraft: CLIENT_PACK.minecraft, loader: CLIENT_PACK.loader, javaMajor: CLIENT_PACK.javaMajor }) + '\n');
}

build().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
