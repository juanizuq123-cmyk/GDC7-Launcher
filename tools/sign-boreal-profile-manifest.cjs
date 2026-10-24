'use strict';

const { sign } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { canonicalValue, unsignedManifest } = require('../boreal-signature.cjs');
const { validateBorealProfileManifest } = require('../boreal-profile.cjs');

function signManifest(document, privateKeyPem) {
  if (!document || typeof document !== 'object' || Array.isArray(document) || document.signature !== undefined) {
    throw new Error('La entrada debe ser un objeto JSON Boreal sin firma.');
  }
  const payload = unsignedManifest(document);
  payload.signature = sign(null, Buffer.from(canonicalValue(payload), 'utf8'), privateKeyPem).toString('base64');
  return Buffer.from(canonicalValue(payload), 'utf8');
}

async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length !== 2) throw new Error('Uso: node tools/sign-boreal-profile-manifest.cjs <manifiesto-boreal.json> <manifiesto-firmado.json>');
  const inputPath = path.resolve(args[0]);
  const outputPath = path.resolve(args[1]);
  if (inputPath === outputPath) throw new Error('La salida debe ser un archivo nuevo para conservar intacta la plantilla.');
  const keyPath = env.ESTACION_BOREAL_PROFILE_PRIVATE_KEY || path.join(env.LOCALAPPDATA || '', 'EstacionBoreal-Secrets', 'profile-ed25519.pk8.pem');
  const document = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  const privateKey = await fs.readFile(keyPath, 'utf8');
  const bytes = signManifest(document, privateKey);
  const channel = require('../boreal-channel.cjs');
  const channelUrl = document.eventId === 'boreal-constructor'
    ? (env.BOREAL_CONSTRUCTOR_PROFILE_CHANNEL_URL || channel.constructorChannelUrl)
    : (env.ESTACION_BOREAL_PROFILE_CHANNEL_URL || channel.channelUrl);
  const context = { channelUrl, releaseRepository: env.ESTACION_BOREAL_RELEASE_REPOSITORY || channel.releaseRepository };
  if (document.eventId === 'estacion-boreal') validateBorealProfileManifest(bytes, channel.publicKey, context);
  else if (document.eventId === 'boreal-constructor') require('../boreal-constructor.cjs').validateBorealConstructorManifest(bytes, channel.publicKey, context);
  else throw new Error('El manifiesto no pertenece a un perfil Boreal publicable.');
  await fs.writeFile(outputPath, bytes, { flag: 'wx', mode: 0o600 });
  return outputPath;
}

if (require.main === module) {
  main().then(file => process.stdout.write(`Manifiesto Boreal firmado y validado: ${file}\n`)).catch(error => {
    process.stderr.write(`No se firmó el manifiesto Boreal: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { signManifest, main };
