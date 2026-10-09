const nodemailer = require('nodemailer');
const config = require('../config');
const { HttpError } = require('../utils/httpError');
const { decryptObject } = require('./secretBox');

function platformMailbox() {
  if (!config.mail.user || !config.mail.pass) return null;
  return {
    user: config.mail.user,
    pass: config.mail.pass.replace(/\s+/g, ''),
    from: config.mail.from || config.mail.user,
  };
}

function mailConfigured() {
  return Boolean(platformMailbox());
}

function assertMailConfigured() {
  if (!mailConfigured()) {
    throw new HttpError(
      503,
      'Platform Gmail is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to apps/backend/.env (use a Google App Password).',
    );
  }
}

async function mailboxOf(tenantId) {
  if (!tenantId) return platformMailbox();
  const Tenant = require('../models/Tenant');
  const tenant = await Tenant.findById(tenantId).setOptions({ skipTenantFilter: true });
  if (!tenant) return null;
  if (tenant.kind === 'platform') return platformMailbox();
  const mail = tenant.settings?.mail || {};
  const user = String(mail.gmailUser || '').trim();
  const pass = String(decryptObject(mail.gmailAppPasswordEnc).pass || '').replace(/\s+/g, '');
  if (!user || !pass) return null;
  return { user, pass, from: user };
}

function transporter(box) {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: box.user, pass: box.pass },
  });
}

async function sendMail({ to, subject, html, text, tenantId, attachments }) {
  const box = await mailboxOf(tenantId);
  if (!box) {
    throw new HttpError(
      503,
      tenantId
        ? 'Save this company Gmail in Settings. Another company mailbox is not used.'
        : 'Platform Gmail is not configured.',
    );
  }
  return transporter(box).sendMail({
    from: `"OMSKing" <${box.from}>`,
    to,
    subject,
    text: text || subject,
    html,
    attachments,
  });
}

module.exports = { mailConfigured, assertMailConfigured, mailboxOf, sendMail };
