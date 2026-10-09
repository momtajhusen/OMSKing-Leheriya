const crypto = require('crypto');

function hmacHex(secret, raw) {
  return crypto.createHmac('sha256', String(secret)).update(raw).digest('hex');
}

function hmacBase64(secret, raw) {
  return crypto.createHmac('sha256', String(secret)).update(raw).digest('base64');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function header(headers, name) {
  if (!headers) return '';
  const wanted = String(name).toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === wanted);
  const value = key ? headers[key] : '';
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function verifyHmac({ rawBody, headers, secret }) {
  if (!secret) return false;
  const hex = header(headers, 'x-oms-signature');
  const b64 = header(headers, 'x-shopify-hmac-sha256');
  if (hex && safeEqual(hex, hmacHex(secret, rawBody))) return true;
  if (b64 && safeEqual(b64, hmacBase64(secret, rawBody))) return true;
  return false;
}

module.exports = {
  hmacHex,
  hmacBase64,
  safeEqual,
  header,
  verifyHmac,
};
