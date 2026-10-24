'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const packageInfo = require('../package.json');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', `installer-v${packageInfo.version}`);
const markerDirectory = path.join(root, 'work', 'installer-resources');
const markerPath = path.join(markerDirectory, 'launcher-install-mode.json');

async function sha256(file) {
  const hash = createHash('sha256');
  for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function main() {
  await fs.access(path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'));
  try { await fs.access(output); throw new Error(`Ya existe ${output}; se conserva para no reemplazar artefactos locales.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(markerDirectory, { recursive: true });
  await fs.writeFile(markerPath, JSON.stringify({ schema: 1, channel: 'stable', repository: 'juanizuq123-cmyk/GDC7-Launcher' }, null, 2) + '\n', { flag: 'wx' });
  try {
    const cli = path.join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');
    const result = spawnSync(process.execPath, [cli, '--config', 'electron-builder.config.cjs', '--win', 'nsis', '--x64', '--publish', 'never'], { cwd: root, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('electron-builder no pudo generar el instalador NSIS.');
    const installerName = `GDC7-Launcher-${packageInfo.version}-x64-setup.exe`;
    const installer = path.join(output, installerName);
    const metadata = path.join(output, 'latest.yml');
    await fs.access(installer); await fs.access(metadata);
    const finalized = spawnSync(process.execPath, [path.join(root, 'scripts', 'finalize-launcher-feed.cjs'), '--metadata', metadata, '--installer', installer, '--version', packageInfo.version, '--output', metadata], { cwd: root, encoding: 'utf8', windowsHide: true });
    if (finalized.status !== 0) throw new Error((finalized.stderr || finalized.stdout || 'No se pudo validar latest.yml.').trim());
    const digest = await sha256(installer);
    await fs.writeFile(installer + '.sha256.txt', `${digest}  ${installerName}\n`, { flag: 'wx' });
    const privateKeyPath = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local'), 'GDC7-Launcher-Secrets', 'launcher-update-private.pem');
    try {
      await fs.access(privateKeyPath);
      const signed = spawnSync(process.execPath, [path.join(root, 'scripts', 'sign-launcher-channel.cjs'), '--metadata', metadata, '--installer', installer, '--version', packageInfo.version, '--private-key', privateKeyPath, '--output', path.join(output, 'latest.json')], { cwd: root, encoding: 'utf8', windowsHide: true });
      if (signed.status !== 0) throw new Error((signed.stderr || signed.stdout || 'No se pudo firmar el canal local.').trim());
      process.stdout.write(signed.stdout);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    process.stdout.write(JSON.stringify({ installer, bytes: (await fs.stat(installer)).size, sha256: digest, metadata, localOnly: true }) + '\n');
  } finally { await fs.rm(markerPath, { force: true }); }
}

main().catch(error => { process.stderr.write((error?.message || 'No se pudo empaquetar el instalador.') + '\n'); process.exitCode = 1; });
