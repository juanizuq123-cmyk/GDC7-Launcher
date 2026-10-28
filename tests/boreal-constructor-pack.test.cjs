'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readZip } = require('../safe-zip.cjs');
const { BOREAL_PROFILE } = require('../boreal-profile.cjs');

test('Boreal Constructor alone includes verified WorldEdit for NeoForge 26.1.2', async t => {
  const root = path.join(__dirname, '..');
  const packPath = path.join(root, 'provider', 'packs', 'Boreal-Constructor-Client-0.2.4.mrpack');
  const manifestPath = path.join(root, 'pack', 'source', 'boreal-constructor-26.1.2-neoforge-v0.2.4.json');
  const audit = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const packBytes = await fs.readFile(packPath);
  assert.equal(createHash('sha256').update(packBytes).digest('hex'), audit.pack.sha256);
  assert.equal(packBytes.length, audit.pack.size);
  assert.deepEqual(audit.target, { minecraft: '26.1.2', loader: 'neoforge', loaderVersion: '26.1.2.95', javaMajor: 25, installSide: 'client' });
  assert.deepEqual(audit.mods.map(mod => mod.modId).sort(), ['borealexpedition', 'worldedit']);
  const worldedit = audit.mods.find(mod => mod.modId === 'worldedit');
  assert.equal(worldedit.version, '7.4.3-beta-01+80c6d6122');
  assert.equal(worldedit.file.filename, 'worldedit-mod-7.4.3-beta-01.jar');
  assert.equal(worldedit.file.size, 5398033);
  assert.equal(worldedit.file.sha512, 'a84f894c7d8ccc63aaa34a3d183fd7a8cf3cf80bcec7b00885bd1783b084519cbdfd64b645a4389553a7bec5d5eaf3c4b51dc18b4c1b943d7cc7e7e2eec792c2');
  assert.equal(audit.eventPackContainsWorldEdit, false);

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'boreal-constructor-pack-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const files = await readZip(packPath, { stageDir: temp, maxEntries: 100, maxBytes: 128 * 1024 * 1024 });
  const names = files.map(file => file.target).sort();
  assert.deepEqual(names, [
    'modrinth.index.json',
    'overrides/config/boreal-constructor-launcher-profile.json',
    'overrides/mods/borealexpedition-0.2.4.jar',
    'overrides/mods/worldedit-mod-7.4.3-beta-01.jar'
  ].sort());
  assert.equal(names.some(name => /gdc7|server\.properties|eula\.txt|saves\//i.test(name)), false);

  const index = JSON.parse(await fs.readFile(path.join(temp, 'modrinth.index.json'), 'utf8'));
  assert.deepEqual(index.dependencies, { minecraft: '26.1.2', neoforge: '26.1.2.95' });
  assert.equal(index.files.length, 0);
  const borealBytes = await fs.readFile(path.join(temp, 'overrides/mods/borealexpedition-0.2.4.jar'));
  assert.equal(createHash('sha256').update(borealBytes).digest('hex'), BOREAL_PROFILE.modSha256);
  const marker = JSON.parse(await fs.readFile(path.join(temp, 'overrides/config/boreal-constructor-launcher-profile.json'), 'utf8'));
  assert.equal(marker.version, '0.2.4');
  assert.equal(marker.modSha256, BOREAL_PROFILE.modSha256);
  const worldeditBytes = await fs.readFile(path.join(temp, 'overrides/mods/worldedit-mod-7.4.3-beta-01.jar'));
  assert.equal(worldeditBytes.length, worldedit.file.size);
  assert.equal(createHash('sha512').update(worldeditBytes).digest('hex'), worldedit.file.sha512);
  const eventPack = await fs.readFile(path.join(root, 'provider', 'packs', BOREAL_PROFILE.packFile));
  assert.equal(createHash('sha256').update(eventPack).digest('hex'), BOREAL_PROFILE.packSha256);
});
