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

function setRefreshCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
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
