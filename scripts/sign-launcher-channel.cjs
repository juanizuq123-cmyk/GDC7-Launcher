'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, createPrivateKey, createPublicKey } = require('node:crypto');
const { parse } = require('yaml');
const { signJson, verifySignedJson } = require('../update-signature.cjs');
const { verifyLatestYml, sha512Hex, LAUNCHER_YML_URL } = require('../launcher-channel.cjs');
const keys = require('../update-keys.cjs');

function arg(name) { const index = process.argv.indexOf(`--${name}`); return index >= 0 ? process.argv[index + 1] : null; }
async function digest(file) { const hash = createHash('sha512'); for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }

async function main() {
  const metadataPath = arg('metadata'), installerPath = arg('installer'), outputPath = arg('output'), version = arg('version');
  if (!metadataPath || !installerPath || !outputPath || !version) throw new Error('Uso: node scripts/sign-launcher-channel.cjs --metadata <latest.yml> --installer <setup.exe> --version <semver> --output <latest.json> [--private-key <ruta>] [--private-key-env <nombre>]');
  const keyPath = arg('private-key');
  const envName = arg('private-key-env') || 'GDC7_LAUNCHER_SIGNING_KEY';
  const pem = process.env[envName] || (keyPath ? await fs.readFile(keyPath, 'utf8') : null);
  if (!pem) throw new Error(`Falta la clave privada en --private-key o en la variable ${envName}.`);
  const privateKey = createPrivateKey(pem);
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  if (publicKey !== keys.launcher) throw new Error('La clave privada no corresponde a la clave pública del launcher incluido.');
  const ymlText = await fs.readFile(metadataPath, 'utf8');
  const yml = parse(ymlText, { uniqueKeys: true, maxAliasCount: 0 });
  const executable = await fs.stat(installerPath);
  const file = yml?.files?.find(item => String(item.url || item.path || '').toLowerCase().endsWith('.exe'));
  if (!file || yml.version !== version || file.size !== executable.size) throw new Error('El EXE y latest.yml no coinciden en versión o tamaño.');
  const artifactUrl = new URL(file.url || file.path, LAUNCHER_YML_URL).toString();
  const actualSha512 = await digest(installerPath);
  if (actualSha512 !== sha512Hex(file.sha512)) throw new Error('El SHA-512 del EXE no coincide con latest.yml.');
  const pointer = {
    schema: 1,
    channel: 'stable',
    version,
    assetUrl: artifactUrl,
    size: executable.size,
    sha512: actualSha512,
    latestYmlUrl: LAUNCHER_YML_URL,
    notes: arg('notes') ? await fs.readFile(arg('notes'), 'utf8') : `GDC7 Launcher ${version}`
  };
  const signed = signJson(pointer, pem);
  verifySignedJson(signed, publicKey);
  verifyLatestYml(ymlText, JSON.parse(signed.toString('utf8')));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, signed, { flag: 'w' });
  process.stdout.write(JSON.stringify({ version, assetUrl: artifactUrl, size: executable.size, sha512: actualSha512, channel: outputPath, signatureVerified: true }) + '\n');
}

main().catch(error => { process.stderr.write((error?.message || 'No se pudo firmar el canal del launcher.') + '\n'); process.exitCode = 1; });
