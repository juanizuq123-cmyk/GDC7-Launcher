'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { CLIENT_PACK } = require('../client-pack.cjs');
const { readZip } = require('../safe-zip.cjs');

const sourceFile = path.join(__dirname, '..', 'pack', 'source', CLIENT_PACK.sourceManifest);

test('GDC7 pack source pins the confirmed NeoForge client target and exact mod versions', async () => {
  const manifest = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  assert.equal(manifest.eventId, 'gdc7');
  assert.deepEqual(manifest.target, {
    minecraft: '26.1.2', loader: 'neoforge', loaderVersion: '26.1.2.95', javaMajor: 25, installSide: 'client'
  });
  assert.equal(manifest.mods.length, CLIENT_PACK.modCount);
  assert.equal(manifest.gameplayModGdc7Included, false);
  assert.equal(manifest.serverOnlyModsInstalledOnClient, false);

  const projects = new Set(manifest.mods.map(mod => mod.projectId));
  const modIds = new Set(manifest.mods.map(mod => mod.modId));
  assert.equal(projects.size, manifest.mods.length);
  assert.ok(!modIds.has('jei'));
  assert.ok(!modIds.has('gdc7'));
  for (const mod of manifest.mods) {
    assert.ok(mod.gameVersions.includes('26.1.2'), `${mod.name} omits 26.1.2`);
    assert.ok(mod.loaders.includes('neoforge'), `${mod.name} omits NeoForge`);
    assert.ok(['required', 'optional'].includes(mod.env.client), `${mod.name} cannot be client-side`);
    assert.ok(['required', 'optional', 'unsupported'].includes(mod.env.server));
    assert.ok(/^[a-f0-9]{40}$/i.test(mod.file.hashes.sha1));
    assert.ok(/^[a-f0-9]{128}$/i.test(mod.file.hashes.sha512));
    assert.ok(mod.file.url.startsWith(`https://cdn.modrinth.com/data/${mod.projectId}/versions/${mod.versionId}/`));
    for (const dependency of mod.dependencies.filter(item => item.type === 'required')) assert.ok(dependency.included && projects.has(dependency.projectId), `${mod.name} misses ${dependency.name}`);
  }
  const excluded = new Map(manifest.excludedMods.map(mod => [mod.name, mod]));
  assert.match(excluded.get('Pick Up Notifier').reason, /26\.1\.2\.99/);
  assert.match(excluded.get('More Culling').reason, /<0\.6\.7/);
  assert.equal(excluded.get('Immersive Damage Indicators').name, 'Immersive Damage Indicators');
  const damageAlternative = excluded.get('Immersive Damage Indicators').possibleAlternative;
  assert.equal(damageAlternative.name, 'Highly Customizable Damage Numbers');
  assert.equal(damageAlternative.installed, false);
  assert.deepEqual(damageAlternative.gameVersions, ['26.1.2']);
  assert.deepEqual(damageAlternative.loaders, ['neoforge']);
  assert.deepEqual(damageAlternative.projectSide, { client: 'required', server: 'unsupported' });
  assert.equal(manifest.exactBuildChecks.length, 8);
  assert.ok(manifest.exactBuildChecks.every(check => check.expectedVersionCount === 0));
  assert.deepEqual(excluded.get('WorldEdit').checkedVersion.supportedEnvironments, ['server-side', 'singleplayer']);
});

test('GDC7 MRPack has exact runtime, pinned hashes and accurate side flags', async t => {
  const packFile = path.join(__dirname, '..', 'provider', 'packs', CLIENT_PACK.packFile);
  const manifest = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'gdc7-mrpack-test-'));
  t.after(() => fs.rm(stage, { recursive: true, force: true }));
  const artifacts = await readZip(packFile, { stageDir: stage, maxEntries: 10, maxBytes: 1024 * 1024 });
  assert.equal(artifacts.length, 2);
  const indexArtifact = artifacts.find(item => item.target === 'modrinth.index.json');
  const markerArtifact = artifacts.find(item => item.target === 'overrides/config/gdc7-launcher-profile.json');
  assert.ok(indexArtifact);
  assert.ok(markerArtifact);
  const index = JSON.parse(await fs.readFile(indexArtifact.source, 'utf8'));
  const marker = JSON.parse(await fs.readFile(markerArtifact.source, 'utf8'));
  assert.equal(index.formatVersion, 1);
  assert.equal(index.game, 'minecraft');
  assert.deepEqual(index.dependencies, { minecraft: '26.1.2', neoforge: '26.1.2.95' });
  assert.equal(index.files.length, CLIENT_PACK.modCount);

  const byFilename = new Map(manifest.mods.map(mod => [mod.file.filename, mod]));
  for (const file of index.files) {
    const filename = file.path.split('/').at(-1);
    const source = byFilename.get(filename);
    assert.ok(source, `Archivo no fijado en el manifiesto: ${filename}`);
    assert.equal(file.path, `mods/${filename}`);
    assert.deepEqual(file.hashes, source.file.hashes);
    assert.deepEqual(file.env, source.env);
    assert.equal(file.fileSize, source.file.size);
    assert.equal(new URL(file.downloads[0]).hostname, 'cdn.modrinth.com');
  }
  assert.equal(marker.profileId, CLIENT_PACK.id);
  assert.equal(marker.version, CLIENT_PACK.version);
  assert.equal(marker.minecraft, CLIENT_PACK.minecraft);
  assert.equal(marker.loader, CLIENT_PACK.loaderVersion);
});

test('old Fabric GDC7 pack is archived and no longer ships beside the active pack', async () => {
  const activeOldPack = path.join(__dirname, '..', 'provider', 'packs', 'GDC7-Classic-Client-0.2.0.mrpack');
  const archiveRoot = path.join(__dirname, '..', 'pack', 'archive', 'gdc7-fabric-1.21.11-20261021', 'retired');
  await assert.rejects(fs.access(activeOldPack), { code: 'ENOENT' });
  await fs.access(path.join(archiveRoot, 'GDC7-Classic-Client-0.2.0.mrpack'));
  await fs.access(path.join(archiveRoot, 'gdc7-pack-1.21.11-v0.1.0.json'));
  await fs.access(path.join(archiveRoot, 'gdc7-client-utilities-v0.2.0.json'));
});
