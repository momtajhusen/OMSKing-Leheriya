const jwt = require('jsonwebtoken');
const config = require('../config');

const TRUST_COOKIE = 'login_trust';
const TRUST_PURPOSE = 'login_trust';

function trustDays() {
  const days = Number(config.auth?.trustDeviceDays);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

function trustMaxAgeMs() {
  return trustDays() * 24 * 60 * 60 * 1000;
}

function setTrustCookie(res, userId) {
  const token = jwt.sign(
    { sub: String(userId), p: TRUST_PURPOSE },
    config.jwt.refreshSecret,
    { expiresIn: `${trustDays()}d` },
  );
  res.cookie(TRUST_COOKIE, token, {
    httpOnly: true,
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    secure: config.nodeEnv === 'production',
    path: '/',
    maxAge: trustMaxAgeMs(),
  });
}

function clearTrustCookie(res) {
  res.clearCookie(TRUST_COOKIE, {
    path: '/',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
    secure: config.nodeEnv === 'production',
  });
}

function trustedUserId(req) {
  const token = req.cookies?.[TRUST_COOKIE];
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.jwt.refreshSecret);
    if (decoded?.p !== TRUST_PURPOSE || !decoded?.sub) return null;
    return String(decoded.sub);
  } catch {
    return null;
  }
}

function isTrustedDevice(req, userId) {
  return trustedUserId(req) === String(userId);
}

module.exports = {
  TRUST_COOKIE,
  trustDays,
  setTrustCookie,
  clearTrustCookie,
  isTrustedDevice,
};
