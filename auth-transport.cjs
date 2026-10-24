'use strict';
const { AuthError } = require('./auth-errors.cjs');
const ENDPOINTS = Object.freeze({
  device: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode',
  token: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  xbox: 'https://user.auth.xboxlive.com/user/authenticate',
  xsts: 'https://xsts.auth.xboxlive.com/xsts/authorize',
  minecraft: 'https://api.minecraftservices.com/authentication/login_with_xbox',
  entitlements: 'https://api.minecraftservices.com/entitlements/mcstore',
  profile: 'https://api.minecraftservices.com/minecraft/profile'
});
function validateEndpoint(url) { if (!Object.values(ENDPOINTS).includes(url)) throw new AuthError('RESPONSE'); }
// Main process only. No redirects, cookies, response logging or TLS exceptions.
function jsonRequest(net, url, { signal, method = 'POST', body, headers = {} }, validate = validateEndpoint) {
  return new Promise((resolve, reject) => {
    let request, response, timer, settled = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const finish = (error, result) => { if (settled) return; settled = true; cleanup(); if (error) { request?.abort(); response?.destroy(); reject(error); } else resolve(result); };
    const abort = () => finish(new AuthError('CANCELLED'));
    try {
      validate(url);
      if (signal?.aborted) return abort();
      if (!['GET', 'POST'].includes(method) || (body && Buffer.byteLength(body) > 131072)) throw new AuthError('RESPONSE');
      request = net.request({ url, method, redirect: 'manual', credentials: 'omit', useSessionCookies: false, referrerPolicy: 'no-referrer', cache: 'no-store', bypassCustomProtocolHandlers: true });
      timer = setTimeout(() => finish(new AuthError('NETWORK')), 30000);
      signal?.addEventListener('abort', abort, { once: true });
      request.on('error', () => finish(new AuthError('NETWORK')));
      request.on('redirect', () => finish(new AuthError('RESPONSE')));
      request.on('response', incoming => {
        response = incoming; const chunks = []; let size = 0;
        response.on('error', () => finish(new AuthError('NETWORK')));
        response.on('aborted', () => finish(new AuthError('NETWORK')));
        response.on('close', () => { if (!response.complete) finish(new AuthError('NETWORK')); });
        response.on('data', chunk => { size += chunk.length; if (size > 262144) return finish(new AuthError('RESPONSE')); chunks.push(chunk); });
        response.on('end', () => { try { finish(null, { status: response.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); } catch { finish(new AuthError('RESPONSE')); } });
      });
      request.setHeader('Accept', 'application/json');
      for (const [key, value] of Object.entries(headers)) request.setHeader(key, value);
      request.end(body);
    } catch (e) { finish(e instanceof AuthError ? e : new AuthError('NETWORK')); }
  });
}
module.exports = { ENDPOINTS, jsonRequest, validateEndpoint };
