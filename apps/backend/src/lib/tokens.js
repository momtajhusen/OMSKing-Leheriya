const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

const COOKIE_NAME = 'refresh_token';

function hashToken(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function signAccessToken(payload) {
  return jwt.sign(payload, config.jwt.accessSecret, { expiresIn: config.jwt.accessExpiry });
}

function signRefreshToken(payload) {
  return jwt.sign({ ...payload, typ: 'refresh' }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiry,
  });
}

function verifyAccess(token) {
  return jwt.verify(token, config.jwt.accessSecret);
}

function verifyRefresh(token) {
  return jwt.verify(token, config.jwt.refreshSecret);
}

function refreshMaxAgeMs() {
  const raw = String(config.jwt.refreshExpiry || '30d');
  const match = raw.match(/^(\d+)([dhms])$/i);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const n = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'd') return n * 24 * 60 * 60 * 1000;
  if (unit === 'h') return n * 60 * 60 * 1000;
  if (unit === 'm') return n * 60 * 1000;
  return n * 1000;
}

function setRefreshCookie(res, token) {
  // Production admin (omsking.*) calls API (omskingapi.*) with credentials — SameSite=None is required
  // so the refresh cookie survives and the user is not asked to sign in every 15 minutes.
  const crossSite = config.nodeEnv === 'production';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite || config.nodeEnv === 'production',
    path: '/',
    maxAge: refreshMaxAgeMs(),
  });
}

function clearRefreshCookie(res) {
  const crossSite = config.nodeEnv === 'production';
  res.clearCookie(COOKIE_NAME, {
    path: '/',
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite || config.nodeEnv === 'production',
  });
}

function deviceFromUa(ua = '') {
  if (/mobile/i.test(ua)) return 'Mobile';
  if (/macintosh|mac os/i.test(ua)) return 'macOS';
  if (/windows/i.test(ua)) return 'Windows';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Browser';
}

module.exports = {
  COOKIE_NAME,
  hashToken,
  signAccessToken,
  signRefreshToken,
  verifyAccess,
  verifyRefresh,
  setRefreshCookie,
  clearRefreshCookie,
  deviceFromUa,
};
