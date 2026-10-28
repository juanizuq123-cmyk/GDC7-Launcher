'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readZip } = require('../safe-zip.cjs');
const { BOREAL_PROFILE } = require('../boreal-profile.cjs');

test('bundled Boreal pack matches the project manifest and contains only the client profile files', async t => {
  const root = path.join(__dirname, '..');
  const packPath = path.join(root, 'provider', 'packs', BOREAL_PROFILE.packFile);
  const manifestPath = path.join(root, 'pack', 'source', 'estacion-boreal-26.1.2-neoforge-v0.2.4.json');
  const audit = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const packBytes = await fs.readFile(packPath);
  assert.equal(packBytes.length, BOREAL_PROFILE.packSize);
  assert.equal(createHash('sha256').update(packBytes).digest('hex'), BOREAL_PROFILE.packSha256);
  assert.deepEqual(audit.target, { minecraft: '26.1.2', loader: 'neoforge', loaderVersion: '26.1.2.95', javaMajor: 25, installSide: 'client' });
  assert.equal(audit.mods.length, 1);
  assert.equal(audit.mods[0].modId, BOREAL_PROFILE.modId);
  assert.equal(audit.mods[0].file.sha256, BOREAL_PROFILE.modSha256);
  assert.equal(audit.verification.gdc7GameplayModIncluded, false);
  assert.equal(audit.verification.serverOnlyFilesIncludedInClientPack, false);

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'boreal-client-pack-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const files = await readZip(packPath, { stageDir: temp, maxEntries: 100, maxBytes: 64 * 1024 * 1024 });
  const names = files.map(file => file.target).sort();
  assert.deepEqual(names, [
    'modrinth.index.json',
    `overrides/${BOREAL_PROFILE.markerFile}`,
    `overrides/mods/${BOREAL_PROFILE.modFile}`
  ].sort());
  assert.equal(names.some(name => /gdc7|server\.properties|eula\.txt|saves\//i.test(name)), false);

  const index = JSON.parse(await fs.readFile(path.join(temp, 'modrinth.index.json'), 'utf8'));
  assert.equal(index.game, 'minecraft');
  assert.deepEqual(index.dependencies, { minecraft: BOREAL_PROFILE.minecraft, neoforge: BOREAL_PROFILE.loaderVersion });
  assert.equal(index.files.length, 0);

  const marker = JSON.parse(await fs.readFile(path.join(temp, 'overrides', BOREAL_PROFILE.markerFile), 'utf8'));
  assert.equal(marker.eventId, BOREAL_PROFILE.eventId);
  assert.equal(marker.profileId, BOREAL_PROFILE.id);
  assert.equal(marker.version, BOREAL_PROFILE.version);
  assert.equal(marker.modId, BOREAL_PROFILE.modId);
  assert.equal(marker.modSha256, BOREAL_PROFILE.modSha256);

  const jarPath = path.join(temp, 'overrides', 'mods', BOREAL_PROFILE.modFile);
  const jarBytes = await fs.readFile(jarPath);
  assert.equal(jarBytes.length, BOREAL_PROFILE.modSize);
  assert.equal(createHash('sha256').update(jarBytes).digest('hex'), BOREAL_PROFILE.modSha256);
  const jarMetadataDir = path.join(temp, 'metadata');
  await fs.mkdir(jarMetadataDir);
  await readZip(jarPath, {
    stageDir: jarMetadataDir,
    select: name => name === 'META-INF/neoforge.mods.toml' ? name : null,
    maxEntries: 10000,
    maxBytes: 64 * 1024 * 1024
  });
  const metadata = await fs.readFile(path.join(jarMetadataDir, 'META-INF', 'neoforge.mods.toml'), 'utf8');
  assert.match(metadata, /modId="borealexpedition"/);
  assert.match(metadata, /version="0\.2\.4"/);
  assert.match(metadata, /versionRange="\[26\.1\.2\.95,\)"/);
  assert.match(metadata, /versionRange="\[26\.1\.2\]"/);
  assert.doesNotMatch(metadata, /modId="gdc7"/);
});
