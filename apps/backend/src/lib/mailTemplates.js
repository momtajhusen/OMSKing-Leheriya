const { loginUrlSync } = require('../services/platformSettings.service');

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function wrap({ title, bodyHtml }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;background:#e7f0eb;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:28px 12px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #d5e4dc;">
          <tr>
            <td style="background:#0D5C45;padding:22px 28px;">
              <p style="margin:0;font-size:11px;letter-spacing:0.22em;color:#d7f3e8;font-weight:700;">OMSKING</p>
              <p style="margin:8px 0 0;font-size:20px;line-height:1.35;color:#ffffff;font-weight:700;">${esc(title)}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              ${bodyHtml}
              <p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e5eeea;font-size:12px;line-height:1.6;color:#64748b;">
                {{omsBrand}}<br>
                This is a service message from OMSKing. Please do not share codes, passwords, or payment references.
              </p>
            </td>
          </tr>
        </table>
        <p style="margin:14px 0 0;font-size:11px;letter-spacing:0.04em;color:#7d9088;">OMSKing · Omnichannel order operations</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function companyText(title, detail, { whatsapp = false } = {}) {
  const brand = whatsapp ? '*OMSKing*' : 'OMSKing';
  const foot = whatsapp
    ? '_OMSKing · sent for your company. Please do not share this message._'
    : 'OMSKing · sent for your company. Please do not share this message.';
  return [brand, title, '', String(detail || '').trim(), '', foot].filter((line) => line !== undefined).join('\n');
}

function operationalEmail({ title, detail }) {
  const lines = String(detail || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const rows = lines.map((line) => {
    const cut = line.indexOf(':');
    if (cut > 0 && cut < 32) {
      return `<tr>
        <td style="padding:9px 16px 9px 0;color:#5c6f68;font-size:13px;vertical-align:top;width:148px;">${esc(line.slice(0, cut))}</td>
        <td style="padding:9px 0;color:#12241d;font-size:14px;font-weight:700;">${esc(line.slice(cut + 1).trim())}</td>
      </tr>`;
    }
    return `<tr><td colspan="2" style="padding:8px 0;color:#24332e;font-size:14px;line-height:1.55;">${esc(line)}</td></tr>`;
  }).join('');
  const subject = String(title || 'OMSKing').startsWith('OMSKing') ? title : `OMSKing · ${title}`;
  return {
    subject,
    text: companyText(title, detail),
    html: wrap({
      title,
      bodyHtml: `<p style="margin:0 0 16px;color:#334155;font-size:14px;line-height:1.6;">Hello,</p><table width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
    }),
  };
}

function loginUrl() {
  return loginUrlSync();
}

function accountCreatedEmail({ name, email, password, roleLabel }) {
  const url = loginUrl();
  return {
    subject: 'Your OMSKing account and password',
    text: `Hi ${name}, your OMSKing account is ready.\nEmail: ${email}\nPassword: ${password}\nSign in: ${url}\nChange this password after first login.`,
    html: wrap({
      title: 'Your account is ready',
      bodyHtml: `
        <p style="color:#334155;font-size:14px;line-height:1.6;">Hi ${esc(name || 'there')},</p>
        <p style="color:#334155;font-size:14px;line-height:1.6;">An OMSKing login was created${roleLabel ? ` with role <strong>${esc(roleLabel)}</strong>` : ''}.</p>
        <p style="color:#334155;font-size:14px;"><strong>Email:</strong> ${esc(email)}<br/><strong>Temporary password:</strong></p>
        <p style="font-size:18px;letter-spacing:0.04em;background:#f4faf7;border:1px solid #d5e4dc;border-radius:10px;padding:14px 16px;font-family:Consolas,monospace;color:#0D5C45;">${esc(password)}</p>
        <p style="margin:20px 0;"><a href="${url}" style="background:#0D5C45;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;">Sign in</a></p>
        <p style="color:#64748b;font-size:13px;">After sign-in you can use Forgot password. A 6-digit OTP will be sent to this Gmail.</p>
      `,
    }),
  };
}

function welcomeEmail({ name, email }) {
  const url = loginUrl();
  return {
    subject: 'Welcome to OMSKing',
    text: `Hi ${name}, your merchant trial is ready. Sign in at ${url} with ${email} and the password you chose.`,
    html: wrap({
      title: 'Welcome to OMSKing',
      bodyHtml: `
        <p style="color:#334155;font-size:14px;line-height:1.6;">Hi ${esc(name || 'there')},</p>
        <p style="color:#334155;font-size:14px;line-height:1.6;">Your trial account is live. Sign in with <strong>${esc(email)}</strong> and the password you set during registration.</p>
        <p style="margin:20px 0;"><a href="${url}" style="background:#0D5C45;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;">Open OMSKing</a></p>
      `,
    }),
  };
}

function resetOtpEmail({ name, otp }) {
  return {
    subject: `${otp} is your OMSKing password reset OTP`,
    text: `Hi ${name || 'there'}, your OMSKing password reset OTP is ${otp}. It expires in 10 minutes. If you did not request this, ignore this email.`,
    html: wrap({
      title: 'Password reset OTP',
      bodyHtml: `
        <p style="color:#334155;font-size:14px;line-height:1.6;">Hi ${name || 'there'},</p>
        <p style="color:#334155;font-size:14px;line-height:1.6;">Use this one-time code to set a new password. It expires in <strong>10 minutes</strong>.</p>
        <p style="font-size:28px;letter-spacing:0.28em;font-weight:700;text-align:center;background:#f4faf7;border:1px solid #d5e4dc;border-radius:10px;padding:16px;color:#0D5C45;">${esc(otp)}</p>
        <p style="color:#64748b;font-size:13px;">If you did not request a reset, you can ignore this message. OMSKing will never ask you to share this code.</p>
      `,
    }),
  };
}

function verifyOtpEmail({ name, otp, purpose }) {
  const copy = {
    signup: ['Confirm your email', 'Enter this code to finish creating your OMSKing company. It expires in <strong>10 minutes</strong>.'],
    login: ['Sign-in OTP', 'Enter this code to finish signing in. It expires in <strong>10 minutes</strong>.'],
    'enable-2fa': ['Turn on sign-in OTP', 'Enter this code to require an email OTP at every sign-in. It expires in <strong>10 minutes</strong>.'],
  }[purpose] || ['Verification code', 'Enter this code within <strong>10 minutes</strong>.'];
  return {
    subject: `${otp} is your OMSKing verification code`,
    text: `Hi ${name || 'there'}, your OMSKing verification code is ${otp}. It expires in 10 minutes.`,
    html: wrap({
      title: copy[0],
      bodyHtml: `
        <p style="color:#334155;font-size:14px;line-height:1.6;">Hi ${name || 'there'},</p>
        <p style="color:#334155;font-size:14px;line-height:1.6;">${copy[1]}</p>
        <p style="font-size:28px;letter-spacing:0.28em;font-weight:700;text-align:center;background:#f4faf7;border:1px solid #d5e4dc;border-radius:10px;padding:16px;color:#0D5C45;">${esc(otp)}</p>
        <p style="color:#64748b;font-size:13px;">If you did not request this, you can ignore this message. OMSKing will never ask you to share this code.</p>
      `,
    }),
  };
}

function mailboxTestEmail() {
  return operationalEmail({
    title: 'Mailbox check',
    detail: 'This Gmail is ready to send OMSKing mail.\nClient OTP, welcome mail, and company notices use this mailbox.',
  });
}

module.exports = {
  accountCreatedEmail, welcomeEmail, resetOtpEmail, verifyOtpEmail, operationalEmail, companyText, mailboxTestEmail,
};
