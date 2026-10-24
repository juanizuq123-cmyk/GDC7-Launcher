'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EVENTS, LauncherStore, canLaunchEvent } = require('../event-store.cjs');

test('event catalog keeps the GDC7 target and declares Boreal target without a published manifest', () => {
  const gdc7 = EVENTS.find(event => event.id === 'gdc7');
  const boreal = EVENTS.find(event => event.id === 'estacion-boreal');
  assert.deepEqual(gdc7.target, { minecraft: '26.1.2', loader: 'NeoForge 26.1.2.95', javaMajor: 25 });
  assert.equal(gdc7.manifest, null);
  assert.equal(gdc7.playerCount, null);
  assert.equal(gdc7.news, null);
  assert.equal(boreal.status, 'early-access');
  assert.deepEqual(boreal.target, { minecraft: '26.1.2', loader: 'NeoForge 26.1.2.95', javaMajor: 25 });
  assert.equal(boreal.manifest, null);
  assert.equal(boreal.playerCount, null);
  assert.equal(boreal.news, null);
});

test('profiles keep separate instance folders and event state after switching selection', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gdc7-launcher-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LauncherStore(path.join(root, 'settings.json'), path.join(root, 'instances'));
  await store.load();
  const initial = store.snapshot();
  assert.notEqual(initial.profiles.gdc7.instanceDir, initial.profiles['estacion-boreal'].instanceDir);
  await store.setProfileValue('gdc7', 'ramMb', 6144);
  await store.selectEvent('estacion-boreal');
  assert.equal(store.snapshot().selectedEventId, 'estacion-boreal');
  assert.equal(store.snapshot().profiles.gdc7.ramMb, 6144);
  assert.equal(store.snapshot().profiles['estacion-boreal'].ramMb, 4096);
  assert.notEqual(store.snapshot().profiles.gdc7.instanceDir, store.snapshot().profiles['estacion-boreal'].instanceDir);
});

test('Boreal Constructor gets its own selectable instance and migrates old settings without changing GDC7 or Boreal', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gdc7-constructor-profile-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const oldWorkspace = {
    schema: 1,
    selectedEventId: 'estacion-boreal',
    preferences: { reducedMotion: true },
    profiles: {
      gdc7: { eventId: 'gdc7', instanceDir: path.join(root, 'gdc7-custom'), ramMb: 6144, installation: { status: 'pending-manifest' } },
      'estacion-boreal': { eventId: 'estacion-boreal', instanceDir: path.join(root, 'boreal-custom'), ramMb: 5120, installation: { status: 'unavailable' } }
    }
  };
  await fs.writeFile(file, JSON.stringify(oldWorkspace));
  const store = new LauncherStore(file, path.join(root, 'instances'));
  await store.load();
  const before = store.snapshot();
  await store.selectEvent('boreal-constructor');
  const after = store.snapshot();
  assert.equal(after.selectedEventId, 'boreal-constructor');
  assert.equal(after.profiles.gdc7.instanceDir, oldWorkspace.profiles.gdc7.instanceDir);
  assert.equal(after.profiles.gdc7.ramMb, 6144);
  assert.equal(after.profiles['estacion-boreal'].instanceDir, oldWorkspace.profiles['estacion-boreal'].instanceDir);
  assert.equal(after.profiles['estacion-boreal'].ramMb, 5120);
  assert.notEqual(after.profiles['boreal-constructor'].instanceDir, after.profiles.gdc7.instanceDir);
  assert.notEqual(after.profiles['boreal-constructor'].instanceDir, after.profiles['estacion-boreal'].instanceDir);
  assert.notEqual(before.profiles['boreal-constructor'], after.profiles['boreal-constructor']);
});

test('instance folders cannot be reused or nested across events', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gdc7-launcher-path-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new LauncherStore(path.join(root, 'settings.json'), path.join(root, 'instances'));
  await store.load();
  const gdc7Dir = store.snapshot().profiles.gdc7.instanceDir;
  await assert.rejects(store.setInstanceDir('estacion-boreal', gdc7Dir), /carpeta.*otra instancia/i);
  await assert.rejects(store.setInstanceDir('gdc7', path.dirname(gdc7Dir)), /carpeta.*otra instancia/i);
});

test('event without an installed verified manifest cannot be launched', () => {
  const event = EVENTS.find(item => item.id === 'gdc7');
  const digest = 'a'.repeat(64);
  const manifest = { eventId: 'gdc7', target: event.target, verified: true, sha256: digest };
  const profile = { eventId: 'gdc7', installation: { status: 'verified', manifestSha256: digest } };
  assert.equal(canLaunchEvent(event, profile), false);
  assert.equal(canLaunchEvent({ ...event, manifest: { ...manifest, target: null } }, profile), false);
  assert.equal(canLaunchEvent({ ...event, manifest }, profile), true);
  assert.equal(canLaunchEvent({ ...event, manifest: { ...manifest, target: { ...event.target, minecraft: '1.21.11' } } }, profile), false);
  assert.equal(canLaunchEvent({ ...event, manifest }, { ...profile, installation: { ...profile.installation, manifestSha256: 'b'.repeat(64) } }), false);
  assert.equal(canLaunchEvent(event, { ...profile, eventId: 'estacion-boreal' }), false);
  assert.equal(canLaunchEvent(EVENTS.find(item => item.id === 'estacion-boreal'), { eventId: 'estacion-boreal', installation: { status: 'verified', manifestSha256: digest } }), false);
});
