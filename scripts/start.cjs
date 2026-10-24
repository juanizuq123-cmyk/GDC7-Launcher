'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { appFiles } = require('./production-files.cjs');
const packageInfo = require('../package.json');
const brand = require('../brand.cjs');

const root = path.resolve(__dirname, '..');
const runtimeRoot = path.join(root, 'build-tools', 'electron-44.5.1-win32-x64');
const executable = path.join(runtimeRoot, 'GDC7.exe');
const appRoot = path.resolve(runtimeRoot, 'resources', 'app');
const allowedRoot = path.resolve(runtimeRoot, 'resources') + path.sep;

async function prepareLocalApp() {
  if (!appRoot.startsWith(allowedRoot)) throw new Error('La carpeta local del launcher no es válida.');
  await fs.mkdir(appRoot, { recursive: true });
  for (const file of appFiles) {
    const source = path.join(root, file);
    const target = path.join(appRoot, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: true, force: true, dereference: true });
  }
  for (const dependency of ['yauzl', 'pend']) {
    const source = path.join(root, 'node_modules', dependency);
    const target = path.join(appRoot, 'node_modules', dependency);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: true, force: true, dereference: true });
  }
  await fs.writeFile(path.join(appRoot, 'package.json'), JSON.stringify({
    name: packageInfo.name,
    productName: brand.name,
    version: packageInfo.version,
    main: 'main.cjs',
    private: true
  }, null, 2) + '\n');
}

async function main() {
  await fs.access(executable);
  await prepareLocalApp();
  const child = spawn(executable, [], { cwd: runtimeRoot, stdio: 'inherit', shell: false, windowsHide: false });
  child.once('error', error => {
    process.stderr.write(`No se pudo abrir Electron (${error.code || 'ERROR'}).\n`);
    process.exitCode = 1;
  });
  child.once('close', code => { if (Number.isInteger(code)) process.exitCode = code; });
}

main().catch(error => {
  process.stderr.write(`${error?.message || 'No se pudo preparar la aplicación local.'}\n`);
  process.exitCode = 1;
});
