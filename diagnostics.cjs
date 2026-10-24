'use strict';

const { EVENTS } = require('./event-store.cjs');

function formatDiagnosticReport(state, system = {}) {
  const knownEvents = EVENTS.map(event => {
    const live = state.events?.find(item => item.id === event.id);
    return {
      id: event.id,
      readiness: live?.canPlay ? 'verified' : event.status === 'early-access' ? 'early-access' : 'pending-manifest',
      target: event.target ? {
        minecraft: event.target.minecraft,
        loader: event.target.loader,
        javaMajor: event.target.javaMajor
      } : null
    };
  });
  const account = state.account || {};
  const prism = state.prism || {};
  const report = {
    schema: 1,
    launcher: { name: 'GDC7 Launcher', version: String(state.version || 'unknown').slice(0, 40) },
    system: {
      platform: String(system.platform || 'unknown').slice(0, 20),
      architecture: String(system.architecture || 'unknown').slice(0, 20),
      release: String(system.release || 'unknown').slice(0, 40)
    },
    account: {
      status: account.authorized ? 'connected' : account.configured ? 'configured' : 'not-configured',
      protectedStorageAvailable: account.protectedStorage === true
    },
    prism: ['preparing', 'running', 'closed', 'error'].includes(prism.status) ? prism.status : 'closed',
    updates: {
      launcher: ['manual-transition', 'checking', 'current', 'downloading', 'installing', 'unavailable', 'error'].includes(state.launcherUpdate?.status) ? state.launcherUpdate.status : 'unknown',
      profile: ['idle', 'checking', 'downloading', 'recovering', 'applying', 'updated', 'current', 'ready-to-install', 'deferred', 'unavailable', 'target-change-pending', 'launcher-update-required', 'waiting-launcher-update'].includes(state.profileUpdate?.status) ? state.profileUpdate.status : 'unknown',
      currentProfileVersion: String(state.profileUpdate?.currentVersion || '').slice(0, 40),
      latestProfileVersion: String(state.profileUpdate?.latestVersion || '').slice(0, 40)
    },
    events: knownEvents,
    services: { eventNews: 'not-configured', serverStatus: 'not-configured' },
    personalDataIncluded: false
  };
  return JSON.stringify(report, null, 2);
}

module.exports = { formatDiagnosticReport };
