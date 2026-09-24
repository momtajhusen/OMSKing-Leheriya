const config = require('../config');

function wrap({ title, bodyHtml }) {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;background:#f3f8f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px;border:1px solid #d8e8e0;">
          <tr>
            <td>
              <p style="margin:0 0 8px;font-size:12px;letter-spacing:0.12em;color:#0D5C45;font-weight:700;">OMSKING</p>
              <h1 style="margin:0 0 16px;font-size:20px;color:#0f172a;">${title}</h1>
              ${bodyHtml}
              <p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">Leheriya Creations · OMSKing. Do not share this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function loginUrl() {
  return `${config.corsOrigin}/auth/login`;
}

function accountCreatedEmail({ name, email, password, roleLabel }) {
  const url = loginUrl();
  return {
    subject: 'Your OMSKing account and password',
    text: `Hi ${name}, your OMSKing account is ready.\nEmail: ${email}\nPassword: ${password}\nSign in: ${url}\nChange this password after first login.`,
    html: wrap({
      title: 'Your account is ready',
      bodyHtml: `
        <p style="color:#334155;font-size:14px;line-height:1.6;">Hi ${name || 'there'},</p>
        <p style="color:#334155;font-size:14px;line-height:1.6;">An OMSKing login was created${roleLabel ? ` with role <strong>${roleLabel}</strong>` : ''}.</p>
        <p style="color:#334155;font-size:14px;"><strong>Email:</strong> ${email}<br/><strong>Temporary password:</strong></p>
        <p style="font-size:18px;letter-spacing:0.04em;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;font-family:monospace;">${password}</p>
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
        <p style="color:#334155;font-size:14px;line-height:1.6;">Hi ${name || 'there'},</p>
        <p style="color:#334155;font-size:14px;line-height:1.6;">Your trial account is live. Sign in with <strong>${email}</strong> and the password you set during registration.</p>
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
        <p style="font-size:28px;letter-spacing:0.28em;font-weight:700;text-align:center;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:16px;color:#0f172a;">${otp}</p>
        <p style="color:#64748b;font-size:13px;">If you did not request a reset, you can ignore this message.</p>
      `,
    }),
  };
}

module.exports = { accountCreatedEmail, welcomeEmail, resetOtpEmail };
