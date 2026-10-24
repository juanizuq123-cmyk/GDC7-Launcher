'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parse, stringify } = require('yaml');

function arg(name) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : null; }

async function digest(file) {
  const hash = createHash('sha512');
  for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const metadataPath = arg('metadata'), installerPath = arg('installer'), outputPath = arg('output'), version = arg('version');
  if (!metadataPath || !installerPath || !outputPath || !version) throw new Error('Uso: node scripts/finalize-launcher-feed.cjs --metadata <latest.yml> --installer <setup.exe> --version <semver> --output <ruta>');
  const metadata = parse(await fs.readFile(metadataPath, 'utf8'), { uniqueKeys: true, maxAliasCount: 0 });
  if (!metadata || metadata.version !== version || !Array.isArray(metadata.files)) throw new Error('latest.yml no coincide con la versión de package.json.');
  const installerStat = await fs.stat(installerPath);
  const exeFiles = metadata.files.filter(file => String(file.url || file.path || '').toLowerCase().endsWith('.exe'));
  if (exeFiles.length !== 1) throw new Error('El instalador debe anunciar exactamente un archivo EXE.');
  const artifactName = path.basename(installerPath);
  const assetUrl = `https://github.com/juanizuq123-cmyk/GDC7-Launcher/releases/download/launcher-v${version}/${encodeURIComponent(artifactName)}`;
  const file = exeFiles[0];
  file.url = assetUrl;
  delete file.path;
  file.size = installerStat.size;
  const sha512 = await digest(installerPath);
  // electron-updater expects file hashes in latest.yml as Base64. The signed
  // JSON pointer keeps the same digest as lowercase hex for stable signing.
  file.sha512 = Buffer.from(sha512, 'hex').toString('base64');
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, stringify(metadata, { lineWidth: 0 }), { flag: 'w' });
  process.stdout.write(JSON.stringify({ version, assetUrl, size: installerStat.size, sha512, metadata: outputPath }) + '\n');
}

main().catch(error => { process.stderr.write((error?.message || 'No se pudo preparar latest.yml.') + '\n'); process.exitCode = 1; });
