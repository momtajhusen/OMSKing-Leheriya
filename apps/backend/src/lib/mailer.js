const nodemailer = require('nodemailer');
const config = require('../config');
const { HttpError } = require('../utils/httpError');

function mailConfigured() {
  return Boolean(config.mail.user && config.mail.pass);
}

function assertMailConfigured() {
  if (!mailConfigured()) {
    throw new HttpError(
      503,
      'Gmail is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to apps/backend/.env (use a Google App Password).',
    );
  }
}

function transporter() {
  assertMailConfigured();
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: config.mail.user,
      pass: config.mail.pass.replace(/\s+/g, ''),
    },
  });
}

async function sendMail({ to, subject, html, text }) {
  assertMailConfigured();
  await transporter().sendMail({
    from: `"OMSKing" <${config.mail.from || config.mail.user}>`,
    to,
    subject,
    text: text || subject,
    html,
  });
}

module.exports = { mailConfigured, assertMailConfigured, sendMail };
