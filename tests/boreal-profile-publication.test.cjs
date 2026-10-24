'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { main } = require('../scripts/verify-boreal-profile-release.cjs');

test('release publisher accepts only the exact audited client pack, objective, and immutable release tag', async t => {
  const root = path.join(__dirname, '..');
  const audit = JSON.parse(await fs.readFile(path.join(root, 'pack/source/boreal-constructor-26.1.2-neoforge-v0.1.0.json'), 'utf8'));
  const packPath = path.join(root, 'provider/packs', audit.pack.filename);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'boreal-release-input-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const manifest = {
    schema: 1,
    eventId: 'boreal-constructor',
    channel: 'stable',
    releaseId: '0.1.0',
    minLauncherVersion: '0.1.0',
    target: { minecraft: '26.1.2', loader: 'neoforge', loaderVersion: '26.1.2.95', javaMajor: 25, installSide: 'client' },
    installPack: {
      url: 'https://github.com/example/boreal-updates/releases/download/boreal-constructor-0.1.0/Boreal-Constructor-Client-0.1.0.mrpack',
      filename: audit.pack.filename,
      size: audit.pack.size,
      sha256: audit.pack.sha256
    },
    modCount: 2,
    notes: 'Perfil de construcción auditado.'
  };
  const manifestPath = path.join(temp, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await assert.doesNotReject(main([manifestPath, packPath, 'boreal-constructor-0.1.0']));
  await assert.rejects(main([manifestPath, packPath, 'estacion-boreal-0.1.0']), /tag publicado/i);
  manifest.installPack.sha256 = '0'.repeat(64);
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(main([manifestPath, packPath, 'boreal-constructor-0.1.0']), /SHA-256/i);
});
