const crypto = require('crypto');
const config = require('../config');

function keyBuf() {
  const raw = config.channelEncryptionKey || config.jwt.accessSecret;
  return crypto.createHash('sha256').update(String(raw)).digest();
}

function encryptObject(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf(), iv);
  const json = JSON.stringify(obj || {});
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptObject(payload) {
  if (!payload) return {};
  const [ivHex, tagHex, dataHex] = String(payload).split(':');
  if (!dataHex) return {};
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const json = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
  return JSON.parse(json);
}

function mask(value) {
  const s = String(value || '');
  if (s.length <= 4) return s ? '••••' : '';
  return `${'•'.repeat(Math.min(12, s.length - 4))}${s.slice(-4)}`;
}

module.exports = { encryptObject, decryptObject, mask };
