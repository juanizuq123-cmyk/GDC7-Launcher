'use strict';
const { ENDPOINTS } = require('../auth-transport.cjs');
const CONFIG = { schema: 1, clientId: '11111111-1111-4111-8111-111111111111', minecraftApiAccessConfirmed: true };
const SECRETS = ['fixture-device-secret', 'fixture-msa-access', 'fixture-refresh-1', 'fixture-refresh-2', 'fixture-xbox-token', 'fixture-xsts-token', 'fixture-minecraft-token'];
function fixture() {
  const state = { time: 1000000, stored: null, available: true, pending: 1, pollError: null, xerr: null, game: true, profileStatus: 200, name: 'FixturePlayer', id: '0123456789abcdef0123456789abcdef', failEndpoint: null, saveError: false, clearError: false, slow: false, hash: '12345678' };
  const calls = [], opened = [], waits = [], saves = [];
  const vault = { available: () => state.available, load: async () => structuredClone(state.stored), save: async value => { if (state.saveError) throw new Error('fixture-refresh-1'); state.stored = structuredClone(value); saves.push(structuredClone(value)); }, clear: async () => { if (state.clearError) { const { AuthError } = require('../auth-errors.cjs'); throw new AuthError('LOGOUT_FAILED'); } state.stored = null; } };
  const request = async (url, options) => {
    calls.push({ url, ...options });
    if (state.failEndpoint === url) throw new Error('fixture-refresh-1');
    if (state.slow) await new Promise(resolve => { if (options.signal.aborted) resolve(); else options.signal.addEventListener('abort', resolve, { once: true }); });
    let json, status = 200;
    if (url === ENDPOINTS.device) json = { device_code: SECRETS[0], user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 };
    else if (url === ENDPOINTS.token) {
      const body = new URLSearchParams(options.body);
      if (state.pollError) { status = 400; json = { error: state.pollError, error_description: SECRETS.join(' ') }; }
      else if (body.get('grant_type') !== 'refresh_token' && state.pending-- > 0) { status = 400; json = { error: 'authorization_pending' }; }
      else json = { token_type: 'Bearer', access_token: SECRETS[1], refresh_token: body.get('grant_type') === 'refresh_token' ? SECRETS[3] : SECRETS[2], expires_in: 3600 };
    } else if (url === ENDPOINTS.xbox) json = { Token: SECRETS[4], DisplayClaims: { xui: [{ uhs: '12345678' }] } };
    else if (url === ENDPOINTS.xsts) { status = state.xerr ? 401 : 200; json = state.xerr ? { XErr: state.xerr } : { Token: SECRETS[5], DisplayClaims: { xui: [{ uhs: state.hash, xid: '2533274791234567' }] } }; }
    else if (url === ENDPOINTS.minecraft) json = { access_token: SECRETS[6], expires_in: 3600 };
    else if (url === ENDPOINTS.entitlements) json = { items: state.game ? [{ name: 'game_minecraft' }] : [] };
    else if (url === ENDPOINTS.profile) { status = state.profileStatus; json = { id: state.id, name: state.name, skins: [{ url: 'https://untrusted.example/ignored.png' }] }; }
    else throw new Error('Unexpected endpoint');
    return { status, json };
  };
  const wait = async (ms, signal) => { waits.push(ms); if (signal.aborted) throw new Error('abort'); state.time += ms; };
  return { config: { ...CONFIG }, vault, request, openExternal: async url => opened.push(url), wait, now: () => state.time, state, calls, opened, waits, saves };
}
module.exports = { fixture, CONFIG, SECRETS };
