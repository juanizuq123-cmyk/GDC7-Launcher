'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash, generateKeyPairSync } = require('node:crypto');

async function main() {
  const secretDirectory = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'GDC7-Launcher-Secrets');
  await fs.mkdir(secretDirectory, { recursive: true });
  const launcherPath = path.join(secretDirectory, 'launcher-update-private.pem');
  const profilePath = path.join(secretDirectory, 'gdc7-profile-private.pem');
  for (const file of [launcherPath, profilePath]) {
    try { await fs.access(file); throw new Error(`Ya existe una clave en ${secretDirectory}; no se reemplazó.`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const launcher = generateKeyPairSync('ed25519');
  const profile = generateKeyPairSync('ed25519');
  const launcherPrivate = launcher.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const profilePrivate = profile.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const launcherPublic = launcher.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const profilePublic = profile.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    await fs.writeFile(launcherPath, launcherPrivate, { flag: 'wx', mode: 0o600 });
    await fs.writeFile(profilePath, profilePrivate, { flag: 'wx', mode: 0o600 });
    const identity = process.env.USERDOMAIN && process.env.USERNAME ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : null;
    if (!identity) throw new Error('Windows no informó la identidad local para restringir las claves.');
    const acl = spawnSync('icacls.exe', [secretDirectory, '/inheritance:r', '/grant:r', `${identity}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F'], { encoding: 'utf8', windowsHide: true });
    if (acl.status !== 0) throw new Error('No se pudieron restringir los permisos de la carpeta de claves.');
    const keyFile = path.resolve(__dirname, '..', 'update-keys.cjs');
    const moduleSource = `'use strict';\n\n// Public keys only. Private keys stay in LOCALAPPDATA/GDC7-Launcher-Secrets or GitHub Actions secrets.\nmodule.exports = Object.freeze({\n  launcher: ${JSON.stringify(launcherPublic)},\n  profile: ${JSON.stringify(profilePublic)}\n});\n`;
    await fs.writeFile(keyFile, moduleSource, 'utf8');
    const fingerprint = value => createHash('sha256').update(Buffer.from(value)).digest('hex');
    process.stdout.write(JSON.stringify({ secretsDirectory: secretDirectory, launcherPrivateKey: launcherPath, profilePrivateKey: profilePath, launcherPublicKeySha256: fingerprint(launcherPublic), profilePublicKeySha256: fingerprint(profilePublic), privateKeyContentsPrinted: false }) + '\n');
  } catch (error) {
    await fs.rm(launcherPath, { force: true }).catch(() => {});
    await fs.rm(profilePath, { force: true }).catch(() => {});
    throw error;
  }
}

main().catch(error => { process.stderr.write((error?.message || 'No se pudieron crear las claves de actualización.') + '\n'); process.exitCode = 1; });
