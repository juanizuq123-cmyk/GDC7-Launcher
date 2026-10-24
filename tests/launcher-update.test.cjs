'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash, generateKeyPairSync } = require('node:crypto');
const { LauncherUpdater } = require('../launcher-updater.cjs');
const { signJson } = require('../update-signature.cjs');
const keys = require('../update-keys.cjs');

function signedChannel(version, bytes, privateKey, repo = 'juanizuq123-cmyk/GDC7-Launcher') {
  const sha512 = createHash('sha512').update(bytes).digest('hex');
  const assetName = `GDC7-Launcher-${version}-x64-setup.exe`;
  const assetUrl = `https://github.com/${repo}/releases/download/launcher-v${version}/${assetName}`;
  const ymlUrl = 'https://juanizuq123-cmyk.github.io/GDC7-Launcher/updates/launcher/stable/latest.yml';
  const pointer = {
    schema: 1, channel: 'stable', version, assetUrl, latestYmlUrl: ymlUrl,
    size: bytes.length, sha512, notes: 'Prueba de actualización firmada.'
  };
  const signed = signJson(pointer, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const yml = `version: ${version}\nfiles:\n  - url: ${assetUrl}\n    sha512: ${Buffer.from(sha512, 'hex').toString('base64')}\n    size: ${bytes.length}\n`;
  return { pointer: { ...pointer, ...JSON.parse(signed.toString('utf8')) }, metadata: { version, assetUrl, size: bytes.length, sha512, files: [{ url: assetUrl, size: bytes.length, sha512: Buffer.from(sha512, 'hex').toString('base64') }] }, ymlUrl };
}

function updaterStub(downloadUpdate) {
  const updater = new EventEmitter();
  updater.autoDownload = true;
  let checks = 0;
  updater.checkForUpdates = async () => { checks += 1; updater.emit('update-available', { ...updater.channelInfo, version: updater.channelInfo.version, files: updater.channelInfo.files }); };
  updater.downloadUpdate = downloadUpdate;
  updater.quitAndInstall = () => { updater.installed = true; };
  return { updater, checks: () => checks };
}

test('launcher channel rejects an invalid signature before asking electron-updater to download', async () => {
  const generated = generateKeyPairSync('ed25519');
  const valid = signedChannel('0.1.4', Buffer.from('candidate installer'), generated.privateKey);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-update-signature-'));
  const currentInstallation = path.join(temp, 'installed-app.marker');
  await fs.writeFile(currentInstallation, 'installed 0.1.3');
  let downloaded = false;
  const stub = updaterStub(async () => { downloaded = true; return []; });
  stub.updater.channelInfo = valid.metadata;
  const controller = new LauncherUpdater({
    updater: stub.updater,
    currentVersion: '0.1.3',
    channel: { ymlUrl: valid.ymlUrl, check: async () => { throw new Error('La firma del manifiesto no es válida.'); } },
    quitAndInstall: () => { stub.updater.installed = true; }
  });
  const result = await controller.check();
  assert.equal(result.status, 'unavailable');
  assert.equal(stub.checks(), 0);
  assert.equal(downloaded, false);
  assert.equal(await fs.readFile(currentInstallation, 'utf8'), 'installed 0.1.3');
  await fs.rm(temp, { recursive: true, force: true });
});

test('failed and hash-mismatched launcher downloads never install over the current application', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'launcher-update-download-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const installed = path.join(temp, 'installed-app.marker');
  await fs.writeFile(installed, 'installed 0.1.3');
  const candidate = path.join(temp, 'candidate-installer.exe');
  await fs.writeFile(candidate, 'corrupt candidate');
  const expectedBytes = Buffer.from('correct signed candidate installer');
  const feedKeys = generateKeyPairSync('ed25519');
  const feed = signedChannel('0.1.4', expectedBytes, feedKeys.privateKey);
  const scenarios = [
    async () => { throw new Error('falló la descarga'); },
    async () => [candidate]
  ];
  for (const downloadUpdate of scenarios) {
    const stub = updaterStub(downloadUpdate);
    stub.updater.channelInfo = feed.metadata;
    let installs = 0;
    const controller = new LauncherUpdater({
      updater: stub.updater, currentVersion: '0.1.3',
      channel: { ymlUrl: feed.ymlUrl, check: async () => ({ pointer: feed.pointer, metadata: feed.metadata }) },
      quitAndInstall: () => { installs += 1; }
    });
    await controller.check();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(installs, 0);
    assert.equal(await fs.readFile(installed, 'utf8'), 'installed 0.1.3');
    assert.equal(controller.snapshot().status, 'error');
  }
  assert.notEqual(keys.launcher, keys.profile);
});
