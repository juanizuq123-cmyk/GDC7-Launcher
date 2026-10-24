'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parse } = require('yaml');
const { verifySignedJson } = require('../update-signature.cjs');
const { validateLauncherPointer, verifyLatestYml } = require('../launcher-channel.cjs');
const keys = require('../update-keys.cjs');
const packageInfo = require('../package.json');

async function digest(file, algorithm) {
  const hash = createHash(algorithm);
  for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  const directory = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', `installer-v${packageInfo.version}`));
  const metadataPath = path.join(directory, 'latest.yml');
  const pointerPath = path.join(directory, 'latest.json');
  const installerFiles = (await fs.readdir(directory)).filter(file => /^GDC7-Launcher-.+-x64-setup\.exe$/i.test(file));
  if (installerFiles.length !== 1) throw new Error('Debe haber exactamente un instalador NSIS x64 en dist/.');
  const installerPath = path.join(directory, installerFiles[0]);
  const pointerBytes = await fs.readFile(pointerPath);
  const pointer = validateLauncherPointer(pointerBytes, keys.launcher);
  const ymlBytes = await fs.readFile(metadataPath);
  verifyLatestYml(ymlBytes.toString('utf8'), pointer);
  verifySignedJson(pointerBytes, keys.launcher);
  if (pointer.version !== packageInfo.version || pointer.size !== (await fs.stat(installerPath)).size || pointer.sha512 !== await digest(installerPath, 'sha512')) throw new Error('El instalador local no coincide con el canal firmado.');
  if (pointer.assetUrl !== `https://github.com/juanizuq123-cmyk/GDC7-Launcher/releases/download/launcher-v${packageInfo.version}/${encodeURIComponent(installerFiles[0])}`) throw new Error('El instalador apunta a otro repositorio o tag.');
  const sidecar = await fs.readFile(installerPath + '.sha256.txt', 'utf8');
  if (!sidecar.startsWith(`${await digest(installerPath, 'sha256')}  ${installerFiles[0]}`)) throw new Error('El sidecar SHA-256 no coincide con el instalador.');
  const unpacked = path.join(directory, 'win-unpacked');
  const mode = JSON.parse(await fs.readFile(path.join(unpacked, 'resources', 'launcher-install-mode.json'), 'utf8'));
  if (mode.schema !== 1 || mode.channel !== 'stable' || mode.repository !== 'juanizuq123-cmyk/GDC7-Launcher') throw new Error('El instalador no contiene la marca de actualización esperada.');
  const appUpdate = parse(await fs.readFile(path.join(unpacked, 'resources', 'app-update.yml'), 'utf8'), { uniqueKeys: true, maxAliasCount: 0 });
  if (appUpdate.provider !== 'generic' || !String(appUpdate.url).startsWith('https://juanizuq123-cmyk.github.io/GDC7-Launcher/updates/launcher/stable')) throw new Error('app-update.yml no apunta al canal estable del launcher.');
  if (keys.launcher === keys.profile) throw new Error('Los canales reutilizan la misma clave pública.');
  const reported = { installer: installerPath, version: pointer.version, bytes: pointer.size, sha256: await digest(installerPath, 'sha256'), sha512: pointer.sha512, latestYml: 'verified', launcherSignature: 'verified', installMarker: 'verified', genericFeed: appUpdate.url, profileFeed: 'https://juanizuq123-cmyk.github.io/GDC7-Launcher/channels/gdc7/stable.json', keysSeparated: true };
  process.stdout.write(JSON.stringify(reported, null, 2) + '\n');
}

main().catch(error => { process.stderr.write((error?.message || 'No se pudo validar el instalador local.') + '\n'); process.exitCode = 1; });
