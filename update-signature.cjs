'use strict';

const { createPrivateKey, createPublicKey, sign, verify } = require('node:crypto');

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('El documento contiene un número no válido.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('El documento contiene un valor no válido.');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`;
}

function unsigned(document) {
  const copy = { ...document };
  delete copy.signature;
  return copy;
}

function canonicalBytes(document) { return Buffer.from(canonicalValue(unsigned(document)), 'utf8'); }

function verifySignedJson(bytes, publicKey) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 4 * 1024 * 1024) throw new Error('El manifiesto supera el tamaño permitido.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const document = JSON.parse(text);
  if (!document || typeof document !== 'object' || Array.isArray(document) || typeof document.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(document.signature)) throw new Error('El manifiesto firmado no tiene el formato esperado.');
  // Requiring canonical bytes rejects duplicate keys and alternate encodings before signature validation.
  const canonical = canonicalValue(document);
  if (text !== canonical) throw new Error('El manifiesto firmado no usa la codificación canónica esperada.');
  if (!verify(null, canonicalBytes(document), createPublicKey(publicKey), Buffer.from(document.signature, 'base64'))) throw new Error('La firma del manifiesto no es válida.');
  return document;
}

function signJson(document, privateKey) {
  const body = unsigned(document);
  body.signature = sign(null, Buffer.from(canonicalValue(body), 'utf8'), createPrivateKey(privateKey)).toString('base64');
  return Buffer.from(canonicalValue(body), 'utf8');
}

module.exports = { canonicalValue, canonicalBytes, verifySignedJson, signJson };
