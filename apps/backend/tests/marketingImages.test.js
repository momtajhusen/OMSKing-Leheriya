process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { hashPassword } = require('../src/lib/password');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const { uploadsRoot } = require('../src/middleware/uploadImage');
const Tenant = require('../src/models/Tenant');
const Role = require('../src/models/Role');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const app = require('../src/app');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 2)]);

let memory;
let server;
let base;
let platformToken;
let merchantToken;

async function api(method, url, { token, json, form } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: form || (json !== undefined ? JSON.stringify(json) : undefined),
  });
  const text = await res.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
  }
  return { status: res.status, body, headers: res.headers };
}

function imageForm(bytes, { type = 'image/png', filename = 'shot.png', alt } = {}) {
  const form = new FormData();
  form.append('image', new Blob([bytes], { type }), filename);
  if (alt !== undefined) form.append('alt', alt);
  return form;
}

function storedFile(url) {
  return path.join(uploadsRoot, 'marketing', path.basename(url));
}

async function login(email) {
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password: 'Password1' } });
  assert.equal(res.status, 200, `login ${email}`);
  return res.body.data.accessToken;
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const platform = await Tenant.create({ name: 'OMSKing SaaS', slug: `platform-${Date.now()}`, kind: 'platform', status: 'active' });
  const role = await Role.create({
    tenantId: platform._id,
    code: 'platform_admin',
    name: 'Platform Admin',
    permissions: ['tenants.manage', 'users.manage', 'settings.manage'],
    isSystem: true,
  });
  await User.create({
    tenantId: platform._id,
    fullName: 'Website Editor',
    email: 'website-images@omsking.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });
  await provisionMerchant({
    name: 'Leheriya Prints',
    ownerEmail: 'leheriya-images@example.com',
    ownerName: 'Leheriya Owner',
    password: 'Password1',
    status: 'active',
  });

  platformToken = await login('website-images@omsking.com');
  merchantToken = await login('leheriya-images@example.com');
});

test.after(async () => {
  server.close();
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('the public website reads uploaded images without a login', async () => {
  const res = await api('GET', '/api/v1/marketing-images');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data, {});
});

test('only the platform admin can upload, edit or remove website images', async () => {
  const anonymous = await api('PUT', '/api/v1/marketing-images/home-hero-studio', { form: imageForm(PNG) });
  assert.equal(anonymous.status, 401);

  const merchant = await api('PUT', '/api/v1/marketing-images/home-hero-studio', { token: merchantToken, form: imageForm(PNG) });
  assert.equal(merchant.status, 403);
  assert.equal(fs.existsSync(path.join(uploadsRoot, 'marketing', 'shot.png')), false);

  const list = await api('GET', '/api/v1/marketing-images/manage', { token: merchantToken });
  assert.equal(list.status, 403);
  const patch = await api('PATCH', '/api/v1/marketing-images/home-hero-studio', { token: merchantToken, json: { alt: 'x' } });
  assert.equal(patch.status, 403);
  const removed = await api('DELETE', '/api/v1/marketing-images/home-hero-studio', { token: merchantToken });
  assert.equal(removed.status, 403);
});

test('platform admin uploads, replaces, captions and deletes a website image', async () => {
  const created = await api('PUT', '/api/v1/marketing-images/home-hero-studio', {
    token: platformToken,
    form: imageForm(PNG, { alt: 'Founder with tablet' }),
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const first = created.body.data;
  assert.equal(first.name, 'home-hero-studio');
  assert.match(first.url, /^\/uploads\/marketing\/[\w-]+\.png$/);
  assert.equal(first.alt, 'Founder with tablet');
  assert.equal(first.updatedByName, 'Website Editor');
  assert.equal(fs.existsSync(storedFile(first.url)), true);

  const served = await fetch(`${base}${first.url}`);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type'), /image\/png/);

  const shown = await api('GET', '/api/v1/marketing-images');
  assert.deepEqual(Object.keys(shown.body.data), ['home-hero-studio']);
  assert.equal(shown.body.data['home-hero-studio'].url, first.url);
  assert.equal(shown.body.data['home-hero-studio'].alt, 'Founder with tablet');
  assert.equal(JSON.stringify(shown.body).includes('website-images@omsking.com'), false);
  assert.equal(JSON.stringify(shown.body).includes('Website Editor'), false);

  const replaced = await api('PUT', '/api/v1/marketing-images/home-hero-studio', {
    token: platformToken,
    form: imageForm(JPEG, { type: 'image/jpeg', filename: 'new.jpg' }),
  });
  assert.equal(replaced.status, 200);
  const second = replaced.body.data;
  assert.match(second.url, /\.jpg$/);
  assert.notEqual(second.url, first.url);
  assert.equal(second.alt, 'Founder with tablet', 'replacing the file keeps the caption');
  assert.equal(fs.existsSync(storedFile(first.url)), false, 'old file is removed');
  assert.equal(fs.existsSync(storedFile(second.url)), true);

  const captioned = await api('PATCH', '/api/v1/marketing-images/home-hero-studio', {
    token: platformToken,
    json: { alt: 'Leheriya founder checking orders' },
  });
  assert.equal(captioned.status, 200);
  assert.equal(captioned.body.data.alt, 'Leheriya founder checking orders');
  assert.equal(captioned.body.data.url, second.url);

  const managed = await api('GET', '/api/v1/marketing-images/manage', { token: platformToken });
  assert.equal(managed.status, 200);
  assert.equal(managed.body.data.length, 1);
  assert.equal(managed.body.data[0].name, 'home-hero-studio');

  const audits = await AuditLog.find({ resourceType: 'marketing_image' }).setOptions({ skipTenantFilter: true }).lean();
  assert.ok(audits.length >= 3, 'every change is audited');

  const deleted = await api('DELETE', '/api/v1/marketing-images/home-hero-studio', { token: platformToken });
  assert.equal(deleted.status, 200);
  assert.equal(fs.existsSync(storedFile(second.url)), false, 'deleting removes the file');
  const after = await api('GET', '/api/v1/marketing-images');
  assert.deepEqual(after.body.data, {});

  const missing = await api('DELETE', '/api/v1/marketing-images/home-hero-studio', { token: platformToken });
  assert.equal(missing.status, 404);
  const noCaption = await api('PATCH', '/api/v1/marketing-images/home-hero-studio', { token: platformToken, json: { alt: 'x' } });
  assert.equal(noCaption.status, 404);
});

test('bad names, missing files and fake images are rejected and leave no file behind', async () => {
  const dir = path.join(uploadsRoot, 'marketing');
  const before = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;

  for (const name of ['..%2Fsecrets', 'evil-name', 'home-', 'HOME-HERO']) {
    const res = await api('PUT', `/api/v1/marketing-images/${name}`, { token: platformToken, form: imageForm(PNG) });
    assert.equal(res.status, 400, `name ${name}`);
  }

  const empty = await api('PUT', '/api/v1/marketing-images/home-order-desk', { token: platformToken, form: new FormData() });
  assert.equal(empty.status, 400);
  assert.match(empty.body.message, /Choose an image/);

  const fake = await api('PUT', '/api/v1/marketing-images/home-order-desk', {
    token: platformToken,
    form: imageForm(Buffer.from('<script>alert(1)</script>'), { type: 'image/png', filename: 'fake.png' }),
  });
  assert.equal(fake.status, 400);
  assert.match(fake.body.message, /not a real PNG, JPEG or WebP/);

  const gif = await api('PUT', '/api/v1/marketing-images/home-order-desk', {
    token: platformToken,
    form: imageForm(Buffer.from('GIF89a'), { type: 'image/gif', filename: 'a.gif' }),
  });
  assert.equal(gif.status, 400);

  const longAlt = await api('PUT', '/api/v1/marketing-images/home-order-desk', {
    token: platformToken,
    form: imageForm(PNG, { alt: 'x'.repeat(161) }),
  });
  assert.equal(longAlt.status, 400);

  const after = fs.existsSync(dir) ? fs.readdirSync(dir).length : 0;
  assert.equal(after, before);
  const shown = await api('GET', '/api/v1/marketing-images');
  assert.deepEqual(shown.body.data, {});
});

test('the login page image can be uploaded and removed like the other website images', async () => {
  const created = await api('PUT', '/api/v1/marketing-images/login-hero', { token: platformToken, form: imageForm(PNG) });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.data.name, 'login-hero');
  const removed = await api('DELETE', '/api/v1/marketing-images/login-hero', { token: platformToken });
  assert.equal(removed.status, 200);
  assert.equal(fs.existsSync(storedFile(created.body.data.url)), false);
});
