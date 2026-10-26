'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const invoke = async (channel, ...args) => {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

function subscribe(channel, callback) {
  if (typeof callback !== 'function') throw new Error('Suscripción inválida.');
  const listener = (_event, state) => callback(state);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('launcher', Object.freeze({
  bootstrap: () => invoke('launcher:bootstrap'),
  selectEvent: id => invoke('launcher:select-event', id),
  setInstanceDir: id => invoke('launcher:choose-instance-dir', id),
  openInstanceDir: id => invoke('launcher:open-instance-dir', id),
  setProfileValue: (id, key, value) => invoke('launcher:set-profile-value', id, key, value),
  setReducedMotion: value => invoke('launcher:set-reduced-motion', value),
  saveAuthConfig: config => invoke('launcher:save-auth-config', config),
  accountLogin: () => invoke('launcher:account-login'),
  accountCancel: () => invoke('launcher:account-cancel'),
  accountLogout: () => invoke('launcher:account-logout'),
  accountRefresh: () => invoke('launcher:account-refresh'),
  accountOpenBrowser: () => invoke('launcher:account-open-browser'),
  openPrismAccounts: () => invoke('launcher:prism-accounts-open'),
  installClientProfile: () => invoke('launcher:client-profile-install'),
  playClientProfile: nickname => invoke('launcher:client-profile-play', nickname),
  installBorealProfile: () => invoke('launcher:boreal-profile-install'),
  playBorealProfile: nickname => invoke('launcher:boreal-profile-play', nickname),
  installBorealConstructorProfile: () => invoke('launcher:boreal-constructor-install'),
  playBorealConstructorProfile: nickname => invoke('launcher:boreal-constructor-play', nickname),
  checkUpdates: () => invoke('launcher:check-updates'),
  copyDiagnostics: () => invoke('launcher:copy-diagnostics'),
  window: action => invoke('launcher:window', action),
  onState: callback => subscribe('launcher:state', callback),
  onNotice: callback => subscribe('launcher:notice', callback),
  onAccount: callback => subscribe('launcher:account-state', callback),
  onPrism: callback => subscribe('launcher:prism-state', callback)
}));
