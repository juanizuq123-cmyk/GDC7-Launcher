'use strict';
const fs = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');
const { AuthError, publicError } = require('./auth-errors.cjs');
const { ENDPOINTS } = require('./auth-transport.cjs');
const SCOPE = 'XboxLive.signin offline_access';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function configCheck(value) {
  if (!value || value.schema !== 1 || Object.keys(value).some(k => !['schema', 'clientId', 'minecraftApiAccessConfirmed'].includes(k)) || typeof value.minecraftApiAccessConfirmed !== 'boolean' || (value.clientId !== null && (typeof value.clientId !== 'string' || !GUID.test(value.clientId) || /^0{8}-/.test(value.clientId)))) throw new AuthError('INVALID_CONFIG');
  return { ...value };
}
async function loadAuthConfig(file) { try { const s = await fs.lstat(file); if (!s.isFile() || s.isSymbolicLink() || s.size > 4096) throw new Error(); return configCheck(JSON.parse(await fs.readFile(file, 'utf8'))); } catch { return { error: 'INVALID_CONFIG' }; } }
function token(value) { if (typeof value !== 'string' || !value.length || value.length > 65536 || /[\x00-\x20\x7f]/.test(value)) throw new AuthError('RESPONSE'); return value; }
function seconds(value, max = 86400) { if (!Number.isInteger(value) || value < 1 || value > max) throw new AuthError('RESPONSE'); return value; }
function profile(value) { if (!value || typeof value.id !== 'string' || typeof value.name !== 'string' || !/^[0-9a-f]{32}$/i.test(value.id) || !/^[A-Za-z0-9_]{1,16}$/.test(value.name)) throw new AuthError('RESPONSE'); return { id: value.id.toLowerCase(), name: value.name }; }
function verificationUri(value) { if (!['https://microsoft.com/devicelogin', 'https://www.microsoft.com/devicelogin', 'https://www.microsoft.com/link'].includes(value)) throw new AuthError('RESPONSE'); return value; }
function checkAbort(signal) { if (signal.aborted) throw new AuthError('CANCELLED'); }
function oauthError(response) {
  const code = response.json?.error;
  if (['authorization_declined', 'access_denied'].includes(code)) return new AuthError('DENIED');
  if (['expired_token', 'code_expired'].includes(code)) return new AuthError('EXPIRED');
  if (['invalid_grant', 'interaction_required', 'login_required', 'consent_required'].includes(code)) return new AuthError('REAUTH_REQUIRED');
  if (['invalid_client', 'unauthorized_client', 'invalid_scope'].includes(code)) return new AuthError('APP_REJECTED');
  return new AuthError(response.status >= 500 || response.status === 429 ? 'NETWORK' : 'RESPONSE');
}
class AccountManager {
  constructor({ config, vault, request, openExternal, onChange = () => {}, now = Date.now, wait = (ms, signal) => delay(ms, undefined, { signal }) }) {
    this.config = config; this.vault = vault; this.request = request; this.openExternal = openExternal; this.onChange = onChange; this.now = now; this.wait = wait;
    this.session = null; this.active = false; this.revision = 0; this.completion = Promise.resolve(); this.state = { status: 'signed-out', error: null, device: null }; this.timer = null; this.closed = false;
  }
  configError() { return this.config.error || (!this.config.clientId ? 'NOT_CONFIGURED' : !this.config.minecraftApiAccessConfirmed ? 'APP_ACCESS_PENDING' : null); }
  snapshot() {
    const configured = !this.configError(), protectedStorage = this.vault.available();
    const authorized = configured && this.state.status === 'signed-in' && Boolean(this.session) && this.session.expiresAt > this.now();
    return { revision: this.revision, configured, protectedStorage, active: Boolean(this.active || this.endingSession), authorized, status: this.state.error?.code === 'LOGOUT_FAILED' ? 'error' : this.configError() ? 'unconfigured' : !protectedStorage ? 'storage-unavailable' : this.state.status === 'signed-in' && !authorized ? 'expired' : this.state.status, profile: this.session?.profile ? { ...this.session.profile } : null, expiresAt: this.session?.expiresAt || null, hasSession: Boolean(this.session), error: this.state.error || (this.configError() ? publicError(new AuthError(this.configError())) : !protectedStorage ? publicError(new AuthError('STORAGE_UNAVAILABLE')) : null), device: this.state.device ? { ...this.state.device } : null };
  }
  diagnostic() { const s = this.snapshot(); return { configured: s.configured, protectedStorage: s.protectedStorage, active: s.active, authorized: s.authorized, status: s.status, errorCode: s.error?.code || null }; }
  emit() { this.revision++; try { this.onChange(this.snapshot()); } catch { /* UI observers cannot interrupt account cleanup. */ } }
  requireReady() { const e = this.configError(); if (e) throw new AuthError(e); if (this.closed) throw new AuthError('CANCELLED'); if (this.active || this.endingSession) throw new AuthError('BUSY'); if (!this.vault.available()) throw new AuthError('STORAGE_UNAVAILABLE'); }
  async initialize() {
    if (this.configError() || !this.vault.available()) return this.snapshot();
    try {
      const stored = await this.vault.load();
      if (!stored) return this.snapshot();
      if (stored.schema !== 1 || stored.clientId !== this.config.clientId) throw new AuthError('REAUTH_REQUIRED');
      this.session = { schema: 1, clientId: stored.clientId, refreshToken: token(stored.refreshToken), accessToken: token(stored.accessToken), expiresAt: stored.expiresAt, profile: profile(stored.profile) };
      if (!Number.isSafeInteger(stored.expiresAt) || stored.expiresAt < 0) throw new AuthError('STORAGE_ERROR');
      // A cached profile is never treated as verified before a fresh service check.
      return this.refresh();
    } catch (e) { this.session = null; this.state = { status: 'error', error: publicError(e instanceof AuthError ? e : new AuthError('STORAGE_ERROR')), device: null }; this.emit(); return this.snapshot(); }
  }
  async call(endpoint, body, signal, bearer) {
    checkAbort(signal);
    const form = endpoint === ENDPOINTS.device || endpoint === ENDPOINTS.token;
    const headers = body === undefined ? {} : { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' };
    if (endpoint === ENDPOINTS.xbox || endpoint === ENDPOINTS.xsts) headers['x-xbl-contract-version'] = '1';
    if (bearer) headers.Authorization = `Bearer ${token(bearer)}`;
    const response = await this.request(endpoint, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : form ? new URLSearchParams(body).toString() : JSON.stringify(body), signal });
    checkAbort(signal);
    if (!response || !Number.isInteger(response.status) || !response.json || typeof response.json !== 'object' || Array.isArray(response.json)) throw new AuthError('RESPONSE');
    return response;
  }
  async deviceLogin(signal) {
    const r = await this.call(ENDPOINTS.device, { client_id: this.config.clientId, scope: SCOPE }, signal);
    if (r.status !== 200) throw oauthError(r);
    const d = r.json, deviceCode = token(d.device_code);
    if (!/^[A-Z0-9-]{6,24}$/.test(d.user_code)) throw new AuthError('RESPONSE');
    const uri = verificationUri(d.verification_uri), deadline = this.now() + seconds(d.expires_in, 1800) * 1000;
    let interval = seconds(d.interval ?? 5, 60) * 1000;
    this.state.device = { userCode: d.user_code, verificationUri: uri, expiresAt: deadline }; this.state.status = 'waiting'; this.emit();
    // The response message is intentionally ignored: it can contain arbitrary text.
    await this.openExternal(uri); checkAbort(signal);
    while (this.now() < deadline) {
      try { await this.wait(Math.min(interval, deadline - this.now()), signal); } catch { throw new AuthError('CANCELLED'); }
      checkAbort(signal); if (this.now() >= deadline) break;
      const result = await this.call(ENDPOINTS.token, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: this.config.clientId, device_code: deviceCode }, signal);
      if (result.status === 200) return result.json;
      if (result.json.error === 'authorization_pending') continue;
      if (result.json.error === 'slow_down') { interval += 5000; continue; }
      throw oauthError(result);
    }
    throw new AuthError('EXPIRED');
  }
  async minecraftSession(ms, signal) {
    const msa = token(ms.access_token);
    const xbox = await this.call(ENDPOINTS.xbox, { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msa}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }, signal);
    if (xbox.status !== 200) throw new AuthError(xbox.status >= 500 || xbox.status === 429 ? 'NETWORK' : 'DENIED');
    const userToken = token(xbox.json.Token), userHash = token(xbox.json.DisplayClaims?.xui?.[0]?.uhs);
    const xsts = await this.call(ENDPOINTS.xsts, { Properties: { SandboxId: 'RETAIL', UserTokens: [userToken] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' }, signal);
    if (xsts.status !== 200) throw new AuthError(xsts.json.XErr === 2148916233 ? 'XBOX_ACCOUNT' : [2148916235, 2148916236, 2148916237, 2148916238].includes(xsts.json.XErr) ? 'XBOX_RESTRICTED' : xsts.status >= 500 || xsts.status === 429 ? 'NETWORK' : 'DENIED');
    const xToken = token(xsts.json.Token), hash = token(xsts.json.DisplayClaims?.xui?.[0]?.uhs);
    if (hash !== userHash || !/^\d{1,32}$/.test(hash)) throw new AuthError('RESPONSE');
    const mc = await this.call(ENDPOINTS.minecraft, { identityToken: `XBL3.0 x=${hash};${xToken}` }, signal);
    if (mc.status !== 200) throw new AuthError(mc.status >= 500 || mc.status === 429 ? 'NETWORK' : mc.status === 403 || mc.status === 400 ? 'APP_REJECTED' : 'DENIED');
    const accessToken = token(mc.json.access_token), expiresAt = this.now() + seconds(mc.json.expires_in) * 1000;
    const rights = await this.call(ENDPOINTS.entitlements, undefined, signal, accessToken);
    if (rights.status !== 200) throw new AuthError(rights.status >= 500 || rights.status === 429 ? 'NETWORK' : 'REAUTH_REQUIRED');
    if (!Array.isArray(rights.json.items)) throw new AuthError('RESPONSE');
    if (!rights.json.items.some(item => ['game_minecraft', 'product_minecraft'].includes(item?.name))) throw new AuthError('NO_GAME');
    const p = await this.call(ENDPOINTS.profile, undefined, signal, accessToken);
    if (p.status !== 200) throw new AuthError(p.status === 404 ? 'NO_PROFILE' : p.status >= 500 || p.status === 429 ? 'NETWORK' : 'REAUTH_REQUIRED');
    const xid = xsts.json.DisplayClaims?.xui?.[0]?.xid;
    if (xid !== undefined && (typeof xid !== 'string' || !/^\d{1,20}$/.test(xid))) throw new AuthError('RESPONSE');
    const next = { schema: 1, clientId: this.config.clientId, refreshToken: token(ms.refresh_token), accessToken, expiresAt, profile: profile(p.json) };
    // Needed only by a fresh launch; do not persist the Xbox identifier.
    this.launchXuid = xid || null;
    return next;
  }
  begin(refresh) {
    this.requireReady(); if (refresh && !this.session) throw new AuthError('NO_SESSION');
    if (!refresh && this.session) throw new AuthError('BUSY');
    clearTimeout(this.timer); this.launchXuid = null; this.active = true; this.controller = new AbortController(); const signal = this.controller.signal;
    this.state = { status: refresh ? 'refreshing' : 'starting', error: null, device: null }; this.emit();
    this.completion = (async () => {
      let loginSaved = false;
      try {
        let ms;
        if (refresh) {
          const r = await this.call(ENDPOINTS.token, { client_id: this.config.clientId, grant_type: 'refresh_token', refresh_token: this.session.refreshToken, scope: SCOPE }, signal);
          if (r.status !== 200) throw oauthError(r);
          ms = r.json;
          if (!ms.refresh_token) ms.refresh_token = this.session.refreshToken;
          // Persist refresh-token rotation even when a later service is unavailable.
          token(ms.access_token); this.session.refreshToken = token(ms.refresh_token);
          await this.vault.save(this.session); checkAbort(signal);
        } else ms = await this.deviceLogin(signal);
        this.state.status = 'verifying'; this.state.device = null; this.emit();
        const next = await this.minecraftSession(ms, signal);
        if (refresh && next.profile.id !== this.session.profile.id) throw new AuthError('PROFILE_CHANGED');
        await this.vault.save(next); loginSaved = !refresh; checkAbort(signal);
        this.session = next; this.state = { status: 'signed-in', error: null, device: null };
      } catch (e) {
        let error = publicError(e);
        if (loginSaved || ['REAUTH_REQUIRED', 'PROFILE_CHANGED'].includes(error.code)) {
          this.session = null; try { await this.vault.clear(); } catch (clearError) { error = publicError(clearError); }
        }
        this.state = { status: error.code === 'CANCELLED' ? 'cancelled' : error.code === 'EXPIRED' ? 'expired' : 'error', error, device: null };
      } finally { this.active = false; this.controller = null; this.emit(); if (this.state.status === 'signed-in') this.scheduleRenewal(); }
    })();
    return this.snapshot();
  }
  login() { return this.begin(false); }
  refresh() { return this.begin(true); }
  // Main-process API only. Never exposed through preload or diagnostics.
  async authorizeLaunch(signal) {
    checkAbort(signal);
    if (this.active) { await this.completion; checkAbort(signal); }
    this.requireReady(); if (!this.session) throw new AuthError('NO_SESSION');
    this.refresh();
    const abort = () => this.controller?.abort(); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    try {
      await this.completion; checkAbort(signal);
      if (!this.snapshot().authorized) throw new AuthError(this.state.error?.code || 'REAUTH_REQUIRED');
      if (typeof this.launchXuid !== 'string' || !/^\d{1,20}$/.test(this.launchXuid)) throw new AuthError('IDENTITY_INCOMPLETE');
      return { accessToken: this.session.accessToken, expiresAt: this.session.expiresAt, clientId: this.session.clientId, xuid: this.launchXuid, profile: { ...this.session.profile }, secrets: [this.session.accessToken, this.session.refreshToken] };
    } finally { signal.removeEventListener('abort', abort); }
  }
  scheduleRenewal() {
    if (this.closed || !this.session) return;
    const ms = Math.max(1000, this.session.expiresAt - this.now() - 60000);
    this.timer = setTimeout(() => { try { this.refresh(); } catch (e) { this.state.error = publicError(e); this.emit(); } }, Math.min(ms, 2147483647)); this.timer.unref?.();
  }
  async cancel() { this.controller?.abort(); await this.completion; return this.snapshot(); }
  async logout() {
    if (this.endingSession) return this.logoutCompletion;
    this.endingSession = true; clearTimeout(this.timer); this.controller?.abort(); this.state = { status: 'signing-out', error: null, device: null }; this.emit();
    this.logoutCompletion = (async () => {
      await this.completion; this.session = null; this.launchXuid = null;
      this.state = { status: 'signed-out', error: null, device: null };
      try { await this.vault.clear(); } catch (e) { this.state = { status: 'error', error: publicError(e), device: null }; }
      this.endingSession = false; this.emit(); return this.snapshot();
    })();
    return this.logoutCompletion;
  }
  async reopenBrowser() { if (!this.active || !this.state.device) throw new AuthError('NO_SESSION'); await this.openExternal(verificationUri(this.state.device.verificationUri)); return true; }
  async shutdown() { this.closed = true; clearTimeout(this.timer); await this.cancel(); if (this.logoutCompletion) await this.logoutCompletion; this.launchXuid = null; }
}
module.exports = { AccountManager, loadAuthConfig, configCheck, verificationUri, SCOPE };
