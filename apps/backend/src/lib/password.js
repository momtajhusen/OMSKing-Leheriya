const bcrypt = require('bcryptjs');
const { HttpError } = require('../utils/httpError');

const BCRYPT_COST = 12;
const PASSWORD_MIN = 12;
const PASSWORD_MAX_AGE_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_COST);
}

function passwordProblem(plain) {
  const value = String(plain || '');
  if (value.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters`;
  if (!/[A-Z]/.test(value)) return 'Add at least one uppercase letter';
  if (!/[a-z]/.test(value)) return 'Add at least one lowercase letter';
  if (!/[0-9]/.test(value)) return 'Add at least one number';
  if (!/[^A-Za-z0-9]/.test(value)) return 'Add at least one special character, like ! @ # or -';
  return '';
}

function assertStrongPassword(plain) {
  const problem = passwordProblem(plain);
  if (problem) throw new HttpError(400, problem);
}

/** Accounts saved before passwordChangedAt existed count from when they were created. */
function passwordExpired(user, now = Date.now()) {
  const since = user?.passwordChangedAt || user?.createdAt;
  if (!since) return false;
  return now - new Date(since).getTime() > PASSWORD_MAX_AGE_DAYS * DAY_MS;
}

module.exports = {
  hashPassword,
  passwordProblem,
  assertStrongPassword,
  passwordExpired,
  BCRYPT_COST,
  PASSWORD_MIN,
  PASSWORD_MAX_AGE_DAYS,
};
