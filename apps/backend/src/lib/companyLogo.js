const fs = require('fs');
const path = require('path');
const { uploadsRoot } = require('../middleware/uploadImage');

/** Resolve a stored /uploads/... logo to a data URI so print HTML works from about:blank. */
function logoDataUri(logoUrl) {
  const raw = String(logoUrl || '').trim();
  if (!raw) return '';
  if (/^data:image\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  const rel = raw.replace(/^\/uploads\//, '');
  if (!rel || rel.includes('..')) return '';
  const full = path.join(uploadsRoot, rel);
  if (!fs.existsSync(full)) return '';
  const ext = path.extname(full).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  try {
    return `data:${mime};base64,${fs.readFileSync(full).toString('base64')}`;
  } catch {
    return '';
  }
}

function brandMarkHtml(brand, logoSrc, { escapeHtml }) {
  const name = escapeHtml(brand || 'Company');
  const src = String(logoSrc || '').trim();
  if (src && (/^data:image\//i.test(src) || /^https?:\/\//i.test(src))) {
    return `<img class="brand-logo" src="${escapeHtml(src)}" alt="${name}" />`;
  }
  return `<div class="brand-mark">${name}</div><div class="brand-sub">${name}</div>`;
}

module.exports = { logoDataUri, brandMarkHtml };
