'use strict';

const { createPublicKey, verify } = require('node:crypto');

function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('El manifiesto Boreal contiene un número no válido.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('El manifiesto Boreal contiene un valor no válido.');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(',')}}`;
}

function unsignedManifest(document) {
  const unsigned = { ...document };
  delete unsigned.signature;
  return unsigned;
}

function verifyBorealManifestSignature(bytes, publicKey) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 4 * 1024 * 1024) throw new Error('El manifiesto Boreal supera el tamaño permitido.');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const document = JSON.parse(text);
  if (!document || typeof document !== 'object' || Array.isArray(document) || typeof document.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(document.signature)) {
    throw new Error('El manifiesto Boreal no tiene una firma Ed25519 Base64 válida.');
  }
  if (text !== canonicalValue(document)) throw new Error('El manifiesto Boreal no usa JSON canónico.');
  const payload = Buffer.from(canonicalValue(unsignedManifest(document)), 'utf8');
  if (!verify(null, payload, createPublicKey(publicKey), Buffer.from(document.signature, 'base64'))) throw new Error('La firma Ed25519 del manifiesto Boreal no es válida.');
  return document;
}

module.exports = { canonicalValue, unsignedManifest, verifyBorealManifestSignature };
