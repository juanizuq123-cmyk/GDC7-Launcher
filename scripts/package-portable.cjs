'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { appFiles } = require('./production-files.cjs');

const root = path.resolve(__dirname, '..');
const packageInfo = require('../package.json');
const brand = require('../brand.cjs');
const runtime = path.join(root, 'build-tools', 'electron-44.5.1-win32-x64');
const portableSuffix = process.env.GDC7_PORTABLE_SUFFIX || '';
if (portableSuffix && !/^[A-Za-z0-9][A-Za-z0-9-]{0,31}$/.test(portableSuffix)) throw new Error('GDC7_PORTABLE_SUFFIX solo admite una etiqueta corta alfanumérica.');
const folderName = `GDC7-Launcher-${packageInfo.version}${portableSuffix ? `-${portableSuffix}` : ''}-Windows-x64`;
const staging = path.join(root, 'dist', folderName);
const zipPath = path.join(root, 'dist', folderName + '.zip');
const hashPath = path.join(root, 'dist', folderName + '.sha256.txt');

function assertInsideDist(target) {
  const dist = path.resolve(root, 'dist');
  const relative = path.relative(dist, path.resolve(target));
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('La ruta de salida no está dentro de dist/.');
  }
}

async function copyApp(destination) {
  await fs.mkdir(destination, { recursive: true });
  for (const file of appFiles) {
    const source = path.join(root, file);
    const target = path.join(destination, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false, dereference: true });
  }
  for (const dependency of ['yauzl', 'pend']) {
    const source = path.join(root, 'node_modules', dependency);
    const target = path.join(destination, 'node_modules', dependency);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: true, errorOnExist: true, force: false, dereference: true });
  }
  await fs.writeFile(path.join(destination, 'package.json'), JSON.stringify({
    name: packageInfo.name,
    productName: brand.name,
    version: packageInfo.version,
    main: 'main.cjs',
    private: true
  }, null, 2) + '\n');
}

async function copyRuntime() {
  const entries = await fs.readdir(runtime, { withFileTypes: true });
  await fs.mkdir(staging, { recursive: true });
  for (const entry of entries) {
    if (entry.name === 'resources') continue;
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) throw new Error('El runtime contiene una entrada no admitida.');
    await fs.cp(path.join(runtime, entry.name), path.join(staging, entry.name), { recursive: entry.isDirectory(), errorOnExist: true, force: false, dereference: true });
  }
  const oldExecutable = path.join(staging, 'GDC7.exe');
  await fs.access(oldExecutable);
  await fs.rename(oldExecutable, path.join(staging, brand.executable));
  await fs.mkdir(path.join(staging, 'resources', 'app'), { recursive: true });
  await copyApp(path.join(staging, 'resources', 'app'));
}

function compress() {
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const command = [
    "$ErrorActionPreference='Stop'",
    'Add-Type -AssemblyName System.IO.Compression',
    `$sourceRoot=${quote(staging)}`,
    `$archivePath=${quote(zipPath)}`,
    '$stream=[System.IO.File]::Open($archivePath,[System.IO.FileMode]::CreateNew)',
    '$archive=[System.IO.Compression.ZipArchive]::new($stream,[System.IO.Compression.ZipArchiveMode]::Create,$false)',
    'try { Get-ChildItem -LiteralPath $sourceRoot -File -Recurse | ForEach-Object { $entryName=$_.FullName.Substring($sourceRoot.Length).TrimStart([char[]]@([char]92,[char]47)).Replace([char]92,[char]47); $entry=$archive.CreateEntry($entryName,[System.IO.Compression.CompressionLevel]::Optimal); $inputStream=[System.IO.File]::OpenRead($_.FullName); $outputStream=$entry.Open(); try { $inputStream.CopyTo($outputStream) } finally { $outputStream.Dispose(); $inputStream.Dispose() } } } finally { $archive.Dispose(); $stream.Dispose() }'
  ].join('; ');
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'No se pudo crear el ZIP portable.').trim());
}

async function sha256(file) {
  const hash = createHash('sha256');
  const stream = require('node:fs').createReadStream(file);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  assertInsideDist(staging);
  assertInsideDist(zipPath);
  assertInsideDist(hashPath);
  const versionFile = path.join(runtime, 'version');
  if ((await fs.readFile(versionFile, 'utf8')).trim() !== '44.5.1') throw new Error('El runtime no coincide con Electron 44.5.1.');
  await fs.mkdir(path.dirname(staging), { recursive: true });
  await fs.rm(staging, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
  await fs.rm(hashPath, { force: true });
  await copyRuntime();
  for (const file of ['LEEME-PORTABLE.txt', 'THIRD-PARTY-NOTICES.md']) await fs.copyFile(path.join(root, 'docs', file), path.join(staging, file));
  compress();
  const digest = await sha256(zipPath);
  await fs.writeFile(hashPath, digest + '  ' + path.basename(zipPath) + '\n');
  process.stdout.write(JSON.stringify({ portable: zipPath, bytes: (await fs.stat(zipPath)).size, sha256: digest, folder: staging }) + '\n');
}

main().catch(error => {
  process.stderr.write((error?.message || 'Error al preparar el portable.') + '\n');
  process.exitCode = 1;
});
