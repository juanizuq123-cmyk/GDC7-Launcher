'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appFiles } = require('../scripts/production-files.cjs');
const builder = require('../electron-builder.config.cjs');

test('development runtime and Windows installer bundle Boreal Constructor code, pack, and audit manifest', () => {
  assert.ok(appFiles.includes('boreal-constructor.cjs'));
  assert.ok(appFiles.includes('boreal-channel-config.json'));
  assert.ok(appFiles.includes('provider/packs'));
  assert.ok(appFiles.includes('pack/source/boreal-constructor-26.1.2-neoforge-v0.2.4.json'));
  assert.ok(builder.files.includes('*.cjs'));
  assert.ok(builder.files.includes('provider/packs/**/*'));
  assert.ok(builder.files.includes('boreal-channel-config.json'));
  assert.ok(builder.files.includes('pack/source/boreal-constructor-26.1.2-neoforge-v0.2.4.json'));
});
