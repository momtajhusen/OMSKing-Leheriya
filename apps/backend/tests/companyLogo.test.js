const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { logoDataUri, brandMarkHtml } = require('../src/lib/companyLogo');

test('brandMarkHtml uses img when logoSrc is a data URI', () => {
  const html = brandMarkHtml('Leheriya', 'data:image/png;base64,abc', {
    escapeHtml: (s) => String(s).replace(/</g, '&lt;'),
  });
  assert.match(html, /brand-logo/);
  assert.match(html, /data:image\/png;base64,abc/);
  assert.doesNotMatch(html, /brand-mark/);
});

test('brandMarkHtml falls back to brand text without logo', () => {
  const html = brandMarkHtml('Leheriya', '', { escapeHtml: (s) => s });
  assert.match(html, /brand-mark/);
  assert.match(html, /Leheriya/);
});

test('logoDataUri reads a file under uploads into a data URI', () => {
  const { uploadsRoot } = require('../src/middleware/uploadImage');
  const dir = path.join(uploadsRoot, 'logo-test-tenant');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'mark.png');
  // 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  fs.writeFileSync(file, png);
  try {
    const uri = logoDataUri('/uploads/logo-test-tenant/mark.png');
    assert.match(uri, /^data:image\/png;base64,/);
    assert.ok(uri.length > 40);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('logoDataUri rejects path traversal', () => {
  assert.equal(logoDataUri('/uploads/../etc/passwd'), '');
  assert.equal(logoDataUri(''), '');
});
