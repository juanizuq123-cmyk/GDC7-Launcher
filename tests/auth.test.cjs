'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createCipheriv, createDecipheriv } = require('node:crypto');
const { AccountManager, configCheck, loadAuthConfig, verificationUri, SCOPE } = require('../auth.cjs');
const { SessionVault } = require('../auth-vault.cjs');
const { ENDPOINTS, validateEndpoint } = require('../auth-transport.cjs');
const { AuthError } = require('../auth-errors.cjs');
const { fixture, CONFIG, SECRETS } = require('./auth-fixture.cjs');
function setup(t, f = fixture()) { const a = new AccountManager(f); t.after(() => a.shutdown()); return { a, f }; }
async function login(a) { a.login(); await a.completion; }
function noSecrets(value) { const s = JSON.stringify(value); for (const secret of SECRETS) assert.equal(s.includes(secret), false, secret); }
test('own registration required; public configuration refuses secrets, arbitrary URLs and unknown fields', async t => {
  const { a, f } = setup(t); a.config = { schema: 1, clientId: null, minecraftApiAccessConfirmed: false };
  assert.throws(() => a.login(), { code: 'NOT_CONFIGURED' }); assert.equal(f.calls.length, 0); assert.equal(a.snapshot().authorized, false);
  a.config = { ...CONFIG, minecraftApiAccessConfirmed: false }; assert.throws(() => a.login(), { code: 'APP_ACCESS_PENDING' });
  for (const patch of [{ clientSecret: 'secret' }, { clientId: 'another-launcher' }, { clientId: '00000000-0000-0000-0000-000000000000' }, { endpoints: {} }, { minecraftApiAccessConfirmed: 'true' }]) assert.throws(() => configCheck({ ...CONFIG, ...patch }), { code: 'INVALID_CONFIG' });
  assert.deepEqual(configCheck(require('../auth-config.json')), { schema: 1, clientId: null, minecraftApiAccessConfirmed: false });
  assert.equal((await loadAuthConfig('/missing/config.json')).error, 'INVALID_CONFIG');
});
test('strict official endpoints and browser allowlist', () => {
  Object.values(ENDPOINTS).forEach(validateEndpoint);
  for (const url of ['http://login.microsoftonline.com/consumers/oauth2/v2.0/token', ENDPOINTS.token + '?secret=x', 'https://evil.example', 'https://login.microsoftonline.com.evil.example']) assert.throws(() => validateEndpoint(url));
  for (const url of ['https://microsoft.com/devicelogin?code=x', 'https://microsoft.com@evil.example/devicelogin', 'file:///tmp/foo', 'https://evil.example']) assert.throws(() => verificationUri(url));
});
test('complete protocol obtains Java profile and rights, uses public client, redacts state/diagnosis', async t => {
  const { a, f } = setup(t); const events = []; a.onChange = s => events.push(s); await login(a);
  const s = a.snapshot(); assert.equal(s.authorized, true); assert.equal(s.profile.name, 'FixturePlayer'); assert.deepEqual(Object.keys(s.profile).sort(), ['id', 'name']);
  assert.deepEqual(f.opened, ['https://microsoft.com/devicelogin']); assert.deepEqual(f.waits, [5000, 5000]);
  const device = f.calls.find(c => c.url === ENDPOINTS.device); assert.equal(new URLSearchParams(device.body).get('client_id'), CONFIG.clientId); assert.equal(new URLSearchParams(device.body).get('scope'), SCOPE);
  assert.equal(JSON.stringify(f.calls).includes('client_secret'), false);
  assert.equal(JSON.parse(f.calls.find(c => c.url === ENDPOINTS.xbox).body).Properties.RpsTicket, 'd=' + SECRETS[1]);
  assert.equal(JSON.parse(f.calls.find(c => c.url === ENDPOINTS.xsts).body).RelyingParty, 'rp://api.minecraftservices.com/');
  assert.equal(JSON.parse(f.calls.find(c => c.url === ENDPOINTS.minecraft).body).identityToken, 'XBL3.0 x=12345678;' + SECRETS[5]);
  assert.equal(f.calls.find(c => c.url === ENDPOINTS.profile).headers.Authorization, 'Bearer ' + SECRETS[6]);
  noSecrets(s); noSecrets(events); noSecrets(a.diagnostic()); assert.equal(JSON.stringify(a.diagnostic()).includes('ABCD-EFGH'), false);
  s.profile.name = 'Modified'; assert.equal(a.snapshot().profile.name, 'FixturePlayer');
});
test('refresh rotates credential, checks game/profile again and excludes tokens from diagnostics', async t => {
  const { a, f } = setup(t); await login(a); const before = f.calls.length; a.refresh(); assert.equal(a.snapshot().authorized, false); await a.completion;
  assert.equal(a.snapshot().authorized, true); assert.equal(f.state.stored.refreshToken, SECRETS[3]);
  assert.equal(f.calls.slice(before).some(c => c.url === ENDPOINTS.entitlements), true); noSecrets(a.snapshot());
});
test('automatic renewal runs before expiry and shutdown clears its timer', async t => {
  const { a, f } = setup(t); await login(a); clearTimeout(a.timer); f.state.time = a.session.expiresAt - 1000;
  const refreshing = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('renewal timer did not run')), 2500); a.onChange = s => { if (s.status === 'refreshing') { clearTimeout(timeout); resolve(); } }; });
  a.scheduleRenewal(); await refreshing; await a.completion; assert.equal(a.snapshot().authorized, true); assert.equal(f.state.stored.refreshToken, SECRETS[3]);
  const timer = a.timer; await a.shutdown(); assert.equal(timer._destroyed, true);
});
test('UI observers cannot interrupt credential storage or cleanup', async t => {
  const { a, f } = setup(t); a.onChange = () => { throw new Error('observer failure'); }; await login(a); assert.equal(a.snapshot().authorized, true); await a.logout(); assert.equal(f.state.stored, null); assert.equal(a.snapshot().active, false);
});
test('restored cached profile remains unauthorized until renewal; expired access is never accepted', async t => {
  const first = setup(t); await login(first.a); first.f.state.stored.expiresAt = 1;
  const second = setup(t, first.f); second.f.state.slow = true; await second.a.initialize(); assert.equal(second.a.snapshot().authorized, false); assert.equal(second.a.snapshot().status, 'refreshing');
  await second.a.cancel(); assert.equal(second.a.snapshot().authorized, false);
  first.f.state.time = first.a.session.expiresAt + 1; assert.equal(first.a.snapshot().authorized, false); assert.equal(first.a.snapshot().status, 'expired');
});
test('rejected refresh removes stored credentials and requires a new login', async t => {
  const { a, f } = setup(t); await login(a); f.state.pollError = 'invalid_grant'; a.refresh(); await a.completion;
  assert.equal(a.snapshot().error.code, 'REAUTH_REQUIRED'); assert.equal(a.snapshot().hasSession, false); assert.equal(f.state.stored, null); noSecrets(a.snapshot());
});
test('a later network error preserves rotated refresh for retry but never claims authorization', async t => {
  const { a, f } = setup(t); await login(a); f.state.failEndpoint = ENDPOINTS.xsts; a.refresh(); await a.completion;
  assert.equal(a.snapshot().authorized, false); assert.equal(a.snapshot().error.code, 'NETWORK'); assert.equal(f.state.stored.refreshToken, SECRETS[3]);
  f.state.failEndpoint = null; a.refresh(); await a.completion; assert.equal(a.snapshot().authorized, true);
});
test('cancel during authentication aborts requests and erases the visible code', async t => {
  const { a, f } = setup(t); f.state.slow = true; a.login(); assert.throws(() => a.login(), { code: 'BUSY' }); await a.cancel();
  assert.equal(a.snapshot().status, 'cancelled'); assert.equal(a.snapshot().device, null); assert.equal(a.snapshot().authorized, false); assert.equal(f.state.stored, null);
});
test('cancel while waiting, reopening only fixed Microsoft URL, then retry', async t => {
  const { a, f } = setup(t); a.wait = (_ms, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')), { once: true }));
  a.login(); await new Promise(resolve => setImmediate(resolve)); assert.equal(a.snapshot().status, 'waiting'); await a.reopenBrowser(); assert.equal(f.opened.length, 2); await a.cancel(); assert.equal(a.snapshot().device, null);
  a.wait = f.wait; await login(a); assert.equal(a.snapshot().authorized, true);
});
test('device deadline stops polling instead of claiming a login', async t => {
  const { a, f } = setup(t); f.state.pending = 999; await login(a); assert.equal(a.snapshot().error.code, 'EXPIRED'); assert.equal(a.snapshot().device, null); assert.equal(f.state.stored, null);
  assert.equal(f.calls.filter(c => c.url === ENDPOINTS.token).length, 179);
});
test('slow_down increases poll interval before retry', async t => {
  const { a, f } = setup(t); const original = f.request; let first = true;
  a.request = async (url, opts) => { if (url === ENDPOINTS.token && first) { first = false; return { status: 400, json: { error: 'slow_down' } }; } return original(url, opts); };
  await login(a); assert.deepEqual(f.waits, [5000, 10000, 10000]); assert.equal(a.snapshot().authorized, true);
});
for (const [code, expected] of [['authorization_declined', 'DENIED'], ['expired_token', 'EXPIRED'], ['invalid_client', 'APP_REJECTED']]) test(`sanitized OAuth ${code}`, async t => {
  const { a, f } = setup(t); f.state.pollError = code; await login(a); assert.equal(a.snapshot().error.code, expected); assert.equal(a.snapshot().authorized, false); noSecrets(a.snapshot());
});
for (const [setting, value, expected] of [['game', false, 'NO_GAME'], ['profileStatus', 404, 'NO_PROFILE'], ['xerr', 2148916233, 'XBOX_ACCOUNT'], ['xerr', 2148916238, 'XBOX_RESTRICTED'], ['hash', '999', 'RESPONSE'], ['name', '<script>', 'RESPONSE']]) test(`game/Xbox failure ${expected}: ${setting}`, async t => {
  const { a, f } = setup(t); f.state[setting] = value; await login(a); assert.equal(a.snapshot().error.code, expected); assert.equal(a.snapshot().authorized, false); assert.equal(f.state.stored, null);
});
test('changed profile during renewal forces reauthentication and deletes cache', async t => {
  const { a, f } = setup(t); await login(a); f.state.id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; a.refresh(); await a.completion; assert.equal(a.snapshot().error.code, 'PROFILE_CHANGED'); assert.equal(f.state.stored, null);
});
test('logout deletes session and cancels concurrent authentication; refuses new login until deletion completes', async t => {
  const { a, f } = setup(t); await login(a); let release; const clear = a.vault.clear; a.vault.clear = () => new Promise(resolve => { release = () => { f.state.stored = null; resolve(); }; });
  const logout = a.logout(); await new Promise(resolve => setImmediate(resolve)); assert.throws(() => a.login(), { code: 'BUSY' }); release(); await logout;
  assert.equal(a.snapshot().status, 'signed-out'); assert.equal(a.snapshot().hasSession, false); assert.equal(f.state.stored, null);
  a.vault.clear = clear;
  f.state.slow = true; a.login(); await a.logout(); assert.equal(a.snapshot().authorized, false); assert.equal(f.state.stored, null); assert.equal(a.snapshot().status, 'signed-out');
});
test('logout deletion failure is visible and can be retried', async t => {
  const { a, f } = setup(t); await login(a); f.state.clearError = true; await a.logout(); assert.equal(a.snapshot().error.code, 'LOGOUT_FAILED'); assert.equal(a.snapshot().authorized, false);
  f.state.clearError = false; await a.logout(); assert.equal(f.state.stored, null);
});
test('no login without protected storage; saving failure never publishes authorization', async t => {
  const { a, f } = setup(t); f.state.available = false; assert.throws(() => a.login(), { code: 'STORAGE_UNAVAILABLE' }); assert.equal(f.calls.length, 0);
  f.state.available = true; f.state.saveError = true; await login(a); assert.equal(a.snapshot().authorized, false); noSecrets(a.snapshot());
});
function protectedFixture() {
  const key = randomBytes(32);
  return { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret', encryptString: plain => { const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), data]); }, decryptString: bytes => { const d = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); d.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([d.update(bytes.subarray(28)), d.final()]).toString('utf8'); } };
}
test('vault roundtrip is encrypted, private, atomic; corrupt ciphertext never becomes plaintext', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gdc7-vault-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const v = new SessionVault(path.join(temp, 'account'), protectedFixture(), 'linux'); const data = { refreshToken: SECRETS[2] };
  await v.save(data); assert.deepEqual(await v.load(), data); const bytes = await fs.readFile(v.file); assert.equal(bytes.includes(Buffer.from(SECRETS[2])), false);
  if (process.platform !== 'win32') assert.equal((await fs.stat(v.file)).mode & 0o777, 0o600);
  assert.equal((await fs.readdir(v.directory)).some(n => n.endsWith('.part')), false);
  bytes[bytes.length - 1] ^= 1; await fs.writeFile(v.file, bytes); await assert.rejects(v.load(), { code: 'STORAGE_ERROR' }); await v.clear(); assert.equal(await v.load(), null);
});
test('vault rejects basic_text and unavailable OS protection, never writes a credential file', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gdc7-vault-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  for (const safe of [{ ...protectedFixture(), getSelectedStorageBackend: () => 'basic_text' }, { ...protectedFixture(), isEncryptionAvailable: () => false }]) { const v = new SessionVault(path.join(temp, 'account'), safe, 'linux'); await assert.rejects(v.save({ token: SECRETS[2] }), { code: 'STORAGE_UNAVAILABLE' }); }
  assert.deepEqual(await fs.readdir(temp), []);
});
test('vault refuses symlink/hardlink destinations and failed encryption without losing old encrypted data', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'gdc7-vault-')); t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const safe = protectedFixture(), v = new SessionVault(path.join(temp, 'account'), safe, 'linux'); await v.save({ refreshToken: 'first' }); const old = await fs.readFile(v.file);
  safe.encryptString = () => { throw new Error('secret'); }; await assert.rejects(v.save({ refreshToken: 'second' }), { code: 'STORAGE_ERROR' }); assert.deepEqual(await fs.readFile(v.file), old);
  await fs.link(v.file, path.join(temp, 'link')); await assert.rejects(v.load(), { code: 'STORAGE_ERROR' }); await fs.unlink(v.file);
  const target = path.join(temp, 'user-file'); await fs.writeFile(target, 'preserve');
  try { await fs.symlink(target, v.file); }
  catch (error) { if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) throw error; t.diagnostic('Symlink subcase unavailable: this Windows account cannot create file symlinks.'); return; }
  await assert.rejects(v.save({}), { code: 'STORAGE_ERROR' }); await assert.rejects(v.clear(), { code: 'LOGOUT_FAILED' }); assert.equal(await fs.readFile(target, 'utf8'), 'preserve');
});
