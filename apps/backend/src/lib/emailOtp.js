const crypto = require('crypto');
const PasswordReset = require('../models/PasswordReset');
const { hashToken } = require('./tokens');
const { mailConfigured, assertMailConfigured, mailboxOf, sendMail } = require('./mailer');
const { resetOtpEmail, verifyOtpEmail } = require('./mailTemplates');
const { HttpError } = require('../utils/httpError');

const OTP_TTL_MS = 10 * 60 * 1000;

function otpHash(userId, purpose, otp) {
  if (purpose === 'reset') return hashToken(`otp:${userId}:${otp}`);
  return hashToken(`otp:${purpose}:${userId}:${otp}`);
}

function openPurposeQuery(purpose) {
  if (purpose === 'reset') {
    return { $or: [{ purpose: 'reset' }, { purpose: { $exists: false } }] };
  }
  return { purpose };
}

async function issueEmailOtp({ user, purpose, platformOnly = false, required = false }) {
  const tenantId = user.tenantId?._id || user.tenantId;
  const own = platformOnly ? null : await mailboxOf(tenantId);
  const usePlatform = !own;
  if (usePlatform && !(await mailConfigured())) {
    if (!required) return false;
    await assertMailConfigured();
  }

  await PasswordReset.updateMany(
    { userId: user._id, usedAt: { $exists: false }, ...openPurposeQuery(purpose) },
    { usedAt: new Date() },
  ).setOptions({ skipTenantFilter: true });

  const otp = String(crypto.randomInt(100000, 1000000));
  await PasswordReset.create({
    tenantId,
    userId: user._id,
    purpose,
    tokenHash: otpHash(user._id, purpose, otp),
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  const mail = purpose === 'reset'
    ? resetOtpEmail({ name: user.fullName, otp })
    : verifyOtpEmail({ name: user.fullName, otp, purpose });
  await sendMail({
    to: user.email,
    ...(usePlatform ? {} : { tenantId }),
    ...mail,
  });
  return true;
}

async function takeEmailOtp({ user, purpose, otp }) {
  const row = await PasswordReset.findOne({
    userId: user._id,
    usedAt: { $exists: false },
    ...openPurposeQuery(purpose),
  }).sort({ createdAt: -1 }).setOptions({ skipTenantFilter: true });

  if (!row || row.expiresAt < new Date()) {
    throw new HttpError(400, 'OTP is invalid or expired. Request a new one.');
  }
  if (row.attempts >= 5) {
    row.usedAt = new Date();
    await row.save();
    throw new HttpError(400, 'Too many attempts. Request a new OTP.');
  }
  if (row.tokenHash !== otpHash(user._id, purpose, otp)) {
    row.attempts += 1;
    if (row.attempts >= 5) row.usedAt = new Date();
    await row.save();
    throw new HttpError(400, row.usedAt ? 'Too many attempts. Request a new OTP.' : 'OTP is invalid or expired. Request a new one.');
  }
  row.usedAt = new Date();
  await row.save();
}

module.exports = { issueEmailOtp, takeEmailOtp };
