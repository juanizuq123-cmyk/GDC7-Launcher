'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EVENTS } = require('../event-store.cjs');
const { formatDiagnosticReport } = require('../diagnostics.cjs');

test('diagnostic report summarizes event readiness without account secrets or personal paths', () => {
  const state = {
    brand: 'GDC7 Launcher',
    version: '0.1.0-alpha.1',
    events: EVENTS.map(event => ({ ...event, canPlay: false, profile: { instanceDir: 'C:\\Users\\player\\private-worlds' } })),
    account: { authorized: true, configured: true, protectedStorage: true, profile: { name: 'PlayerName', id: 'account-id' }, accessToken: 'top-secret-token' },
    prism: { status: 'error', error: 'private provider error with token' }
  };
  const text = formatDiagnosticReport(state, { platform: 'win32', architecture: 'x64', release: '10.0.1' });
  const report = JSON.parse(text);
  assert.equal(report.account.status, 'connected');
  assert.equal(report.events[0].readiness, 'pending-manifest');
  assert.equal(report.events[1].readiness, 'early-access');
  assert.equal(report.events[0].target.minecraft, '26.1.2');
  assert.equal(report.personalDataIncluded, false);
  for (const privateValue of ['player', 'private-worlds', 'PlayerName', 'account-id', 'top-secret-token', 'private provider error']) {
    assert.equal(text.toLowerCase().includes(privateValue.toLowerCase()), false, `report included ${privateValue}`);
  }
});
