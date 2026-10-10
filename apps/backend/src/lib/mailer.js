const nodemailer = require('nodemailer');
const { HttpError } = require('../utils/httpError');
const { decryptObject } = require('./secretBox');

async function platformMailbox() {
  const { platformMailboxFromSettings } = require('../services/platformSettings.service');
  return platformMailboxFromSettings();
}

async function mailConfigured() {
  return Boolean(await platformMailbox());
}

async function assertMailConfigured() {
  if (!(await mailConfigured())) {
    throw new HttpError(
      503,
      'Save the Gmail that sends client OTP in Platform → Settings. Use a Google App Password.',
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
        : 'Save the Gmail that sends client OTP in Platform → Settings.',
    );
  }
  const { emailBrandSync, fromNameSync } = require('../services/platformSettings.service');
  const brand = emailBrandSync();
  const fromName = box.fromName || fromNameSync();
  return transporter(box).sendMail({
    from: `"${fromName}" <${box.from}>`,
    to,
    subject,
    text: text || subject,
    html: String(html || '').replaceAll('{{omsBrand}}', brand),
    attachments,
  });
}

module.exports = { mailConfigured, assertMailConfigured, mailboxOf, platformMailbox, sendMail };
