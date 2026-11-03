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
const app = require('../src/app');

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 3)]);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypmp42', 'ascii'),
  Buffer.alloc(64, 4),
]);

let memory;
let server;
let base;
let platformToken;
let leheriyaToken;
let leheriyaOpsToken;
let vendorToken;
let suratToken;
let leheriya;
let surat;

async function api(method, url, { token, json, form } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: form || (json !== undefined ? JSON.stringify(json) : undefined),
  });
  const type = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  let body = null;
  if (type.includes('json') && buf.length) body = JSON.parse(buf.toString('utf8'));
  return { status: res.status, body, buf, headers: res.headers };
}

function messageForm({ text, file, type, filename, replyTo, durationSec, tenantId } = {}) {
  const form = new FormData();
  if (text !== undefined) form.append('text', text);
  if (replyTo) form.append('replyTo', replyTo);
  if (durationSec !== undefined) form.append('durationSec', String(durationSec));
  if (tenantId) form.append('tenantId', tenantId);
  if (file) form.append('file', new Blob([file], { type }), filename);
  return form;
}

async function login(email) {
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password: 'Password1' } });
  assert.equal(res.status, 200, `login ${email}`);
  return res.body.data.accessToken;
}

async function addUser(tenant, roleCode, email) {
  const role = await Role.findOne({ tenantId: tenant._id, code: roleCode }).setOptions({ skipTenantFilter: true });
  await User.create({
    tenantId: tenant._id,
    fullName: `${roleCode} user`,
    email,
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });
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
    fullName: 'OMSKing Support',
    email: 'support-chat@omsking.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });

  ({ tenant: leheriya } = await provisionMerchant({
    name: 'Leheriya Chat',
    ownerEmail: 'owner-chat@leheriya.com',
    ownerName: 'Leheriya Owner',
    password: 'Password1',
    status: 'active',
  }));
  ({ tenant: surat } = await provisionMerchant({
    name: 'Surat Chat',
    ownerEmail: 'ravi-chat@suratsilks.com',
    ownerName: 'Ravi',
    password: 'Password1',
    status: 'active',
  }));
  await addUser(leheriya, 'operations', 'ops-chat@leheriya.com');
  await addUser(leheriya, 'vendor', 'vendor-chat@leheriya.com');

  platformToken = await login('support-chat@omsking.com');
  leheriyaToken = await login('owner-chat@leheriya.com');
  leheriyaOpsToken = await login('ops-chat@leheriya.com');
  vendorToken = await login('vendor-chat@leheriya.com');
  suratToken = await login('ravi-chat@suratsilks.com');
});

test.after(async () => {
  server.close();
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('a merchant sends a text report and only its own company sees it', async () => {
  const sent = await api('POST', '/api/v1/support/messages', {
    token: leheriyaToken,
    form: messageForm({ text: 'Order #1001 label is not printing', tenantId: String(surat._id) }),
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.data.text, 'Order #1001 label is not printing');
  assert.equal(sent.body.data.side, 'tenant');
  assert.equal(sent.body.data.mine, true);
  assert.equal(sent.body.data.senderName, 'Leheriya Owner');

  const own = await api('GET', '/api/v1/support/messages', { token: leheriyaToken });
  assert.equal(own.status, 200);
  assert.equal(own.body.data.length, 1);

  const ops = await api('GET', '/api/v1/support/messages', { token: leheriyaOpsToken });
  assert.equal(ops.status, 200);
  assert.equal(ops.body.data.length, 1, 'staff of the same company share the report thread');
  assert.equal(ops.body.data[0].mine, false);

  const other = await api('GET', '/api/v1/support/messages', { token: suratToken });
  assert.equal(other.status, 200);
  assert.equal(other.body.data.length, 0, 'tenantId in the body must not move the message to another company');
});

test('vendors, anonymous users and empty messages are refused', async () => {
  const anonymous = await api('GET', '/api/v1/support/messages');
  assert.equal(anonymous.status, 401);

  const vendor = await api('GET', '/api/v1/support/messages', { token: vendorToken });
  assert.equal(vendor.status, 403);
  const vendorSend = await api('POST', '/api/v1/support/messages', { token: vendorToken, form: messageForm({ text: 'hi' }) });
  assert.equal(vendorSend.status, 403);

  const empty = await api('POST', '/api/v1/support/messages', { token: leheriyaToken, form: messageForm({ text: '   ' }) });
  assert.equal(empty.status, 400);

  const long = await api('POST', '/api/v1/support/messages', { token: leheriyaToken, form: messageForm({ text: 'x'.repeat(4001) }) });
  assert.equal(long.status, 400);
});

test('a screenshot is stored privately and served only through a signed link', async () => {
  const sent = await api('POST', '/api/v1/support/messages', {
    token: leheriyaToken,
    form: messageForm({ text: 'See this screen', file: PNG, type: 'image/png', filename: 'screenshot.png' }),
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  const { attachment } = sent.body.data;
  assert.equal(attachment.kind, 'image');
  assert.equal(attachment.mime, 'image/png');
  assert.match(attachment.url, /^\/api\/v1\/support\/media\/[a-f0-9]{24}\?exp=\d+&sig=[a-f0-9]{64}$/);

  const media = await api('GET', attachment.url);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'image/png');
  assert.equal(media.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(media.buf, PNG);

  const unsigned = await api('GET', attachment.url.split('?')[0]);
  assert.equal(unsigned.status, 403);
  const tampered = await api('GET', attachment.url.replace(/sig=[a-f0-9]{4}/, 'sig=0000'));
  assert.equal(tampered.status, 403);

  const files = fs.readdirSync(uploadsRoot, { recursive: true }).map(String);
  assert.equal(files.some((f) => f.includes('support')), false, 'chat media must not sit under the public /uploads folder');
});

test('a fake image and an unknown file type are rejected and not kept on disk', async () => {
  const fake = await api('POST', '/api/v1/support/messages', {
    token: leheriyaToken,
    form: messageForm({ file: Buffer.from('<script>alert(1)</script>'), type: 'image/png', filename: 'x.png' }),
  });
  assert.equal(fake.status, 400);

  const pdf = await api('POST', '/api/v1/support/messages', {
    token: leheriyaToken,
    form: messageForm({ file: Buffer.from('%PDF-1.4'), type: 'application/pdf', filename: 'x.pdf' }),
  });
  assert.equal(pdf.status, 400);

  const dir = path.join(__dirname, '../private-uploads/support', String(leheriya._id));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.upload')), []);
});

test('voice notes and videos are accepted with their duration', async () => {
  const voice = await api('POST', '/api/v1/support/messages', {
    token: leheriyaToken,
    form: messageForm({ file: WEBM, type: 'audio/webm', filename: 'voice.webm', durationSec: 7 }),
  });
  assert.equal(voice.status, 201, JSON.stringify(voice.body));
  assert.equal(voice.body.data.attachment.kind, 'audio');
  assert.equal(voice.body.data.attachment.durationSec, 7);
  assert.equal(voice.body.data.text, '');

  const video = await api('POST', '/api/v1/support/messages', {
    token: leheriyaToken,
    form: messageForm({ file: MP4, type: 'video/mp4', filename: 'screen.mp4' }),
  });
  assert.equal(video.status, 201, JSON.stringify(video.body));
  assert.equal(video.body.data.attachment.kind, 'video');
  const media = await api('GET', video.body.data.attachment.url);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get('content-type'), 'video/mp4');
});

test('replies quote a message from the same company only', async () => {
  const list = await api('GET', '/api/v1/support/messages', { token: leheriyaToken });
  const original = list.body.data[0];

  const reply = await api('POST', '/api/v1/support/messages', {
    token: leheriyaOpsToken,
    form: messageForm({ text: 'Same issue on my desk', replyTo: original.id }),
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.data.replyTo.id, original.id);
  assert.equal(reply.body.data.replyTo.text, original.text);
  assert.equal(reply.body.data.replyTo.senderName, 'Leheriya Owner');

  const crossTenant = await api('POST', '/api/v1/support/messages', {
    token: suratToken,
    form: messageForm({ text: 'peek', replyTo: original.id }),
  });
  assert.equal(crossTenant.status, 400);
  const bad = await api('POST', '/api/v1/support/messages', {
    token: suratToken,
    form: messageForm({ text: 'peek', replyTo: 'not-an-id' }),
  });
  assert.equal(bad.status, 400);
});

test('platform admin sees every company in the inbox with unread counts and replies', async () => {
  await api('POST', '/api/v1/support/messages', { token: suratToken, form: messageForm({ text: 'Myntra sync stuck' }) });

  const merchantInbox = await api('GET', '/api/v1/support/threads', { token: leheriyaToken });
  assert.equal(merchantInbox.status, 403);
  const platformOwnThread = await api('GET', '/api/v1/support/messages', { token: platformToken });
  assert.equal(platformOwnThread.status, 403);

  const inbox = await api('GET', '/api/v1/support/threads', { token: platformToken });
  assert.equal(inbox.status, 200);
  const lehRow = inbox.body.data.find((row) => row.tenantId === String(leheriya._id));
  const suratRow = inbox.body.data.find((row) => row.tenantId === String(surat._id));
  assert.equal(lehRow.tenantName, 'Leheriya Chat');
  assert.equal(lehRow.unread, 5);
  assert.equal(suratRow.unread, 1);
  assert.equal(suratRow.lastMessage.text, 'Myntra sync stuck');
  assert.equal(inbox.body.data[0].tenantId, String(surat._id), 'latest conversation first');

  const thread = await api('GET', `/api/v1/support/threads/${leheriya._id}/messages`, { token: platformToken });
  assert.equal(thread.status, 200);
  assert.equal(thread.body.data.length, 5);
  assert.ok(thread.body.data.every((m) => m.mine === false));
  assert.ok(thread.body.data.find((m) => m.attachment?.kind === 'image').attachment.url.startsWith('/api/v1/support/media/'));

  const read = await api('POST', `/api/v1/support/threads/${leheriya._id}/read`, { token: platformToken });
  assert.equal(read.status, 200);
  const after = await api('GET', '/api/v1/support/threads', { token: platformToken });
  assert.equal(after.body.data.find((row) => row.tenantId === String(leheriya._id)).unread, 0);

  const ownView = await api('GET', '/api/v1/support/messages', { token: leheriyaToken });
  assert.ok(ownView.body.data.every((m) => m.readAt), 'merchant sees blue ticks once platform reads');

  const reply = await api('POST', `/api/v1/support/threads/${leheriya._id}/messages`, {
    token: platformToken,
    form: messageForm({ text: 'Fixed, please retry', replyTo: thread.body.data[0].id }),
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.data.side, 'platform');
  assert.equal(reply.body.data.mine, true);

  const unread = await api('GET', '/api/v1/support/unread', { token: leheriyaToken });
  assert.equal(unread.status, 200);
  assert.equal(unread.body.data.unread, 1);
  const suratUnread = await api('GET', '/api/v1/support/unread', { token: suratToken });
  assert.equal(suratUnread.body.data.unread, 0);

  const merchantSees = await api('GET', '/api/v1/support/messages', { token: leheriyaToken });
  const last = merchantSees.body.data[merchantSees.body.data.length - 1];
  assert.equal(last.text, 'Fixed, please retry');
  assert.equal(last.side, 'platform');
  assert.equal(last.senderName, 'OMSKing Support');
  assert.equal(last.replyTo.id, thread.body.data[0].id);

  await api('POST', '/api/v1/support/read', { token: leheriyaToken });
  const cleared = await api('GET', '/api/v1/support/unread', { token: leheriyaToken });
  assert.equal(cleared.body.data.unread, 0);

  const suratView = await api('GET', '/api/v1/support/messages', { token: suratToken });
  assert.equal(suratView.body.data.some((m) => m.text === 'Fixed, please retry'), false);
});

test('platform inbox refuses unknown or platform tenants', async () => {
  const missing = await api('GET', `/api/v1/support/threads/${new mongoose.Types.ObjectId()}/messages`, { token: platformToken });
  assert.equal(missing.status, 404);
  const bad = await api('GET', '/api/v1/support/threads/nope/messages', { token: platformToken });
  assert.equal(bad.status, 404);
});

test('older messages load page by page with a before cursor', async () => {
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await api('POST', '/api/v1/support/messages', { token: suratToken, form: messageForm({ text: `bulk ${i}` }) });
  }
  const latest = await api('GET', '/api/v1/support/messages?limit=2', { token: suratToken });
  assert.deepEqual(latest.body.data.map((m) => m.text), ['bulk 2', 'bulk 3']);
  assert.equal(latest.body.meta.hasMore, true);
  const older = await api('GET', `/api/v1/support/messages?limit=2&before=${latest.body.data[0].id}`, { token: suratToken });
  assert.deepEqual(older.body.data.map((m) => m.text), ['bulk 0', 'bulk 1']);
});

test('only the sender deletes a message: the text and file go, a "deleted" placeholder stays', async () => {
  const dir = path.join(__dirname, '../private-uploads/support', String(leheriya._id));
  const sent = await api('POST', '/api/v1/support/messages', {
    token: leheriyaToken,
    form: messageForm({ text: 'Wrong screenshot', file: PNG, type: 'image/png', filename: 'wrong.png' }),
  });
  assert.equal(sent.status, 201);
  const reply = await api('POST', '/api/v1/support/messages', {
    token: leheriyaOpsToken,
    form: messageForm({ text: 'Which order?', replyTo: sent.body.data.id }),
  });
  const filesBefore = fs.readdirSync(dir).length;

  const coworker = await api('DELETE', `/api/v1/support/messages/${sent.body.data.id}`, { token: leheriyaOpsToken });
  assert.equal(coworker.status, 404, 'staff of the same company cannot delete someone else\'s message');
  const otherCompany = await api('DELETE', `/api/v1/support/messages/${sent.body.data.id}`, { token: suratToken });
  assert.equal(otherCompany.status, 404);
  const platformTry = await api('DELETE', `/api/v1/support/threads/${leheriya._id}/messages/${sent.body.data.id}`, { token: platformToken });
  assert.equal(platformTry.status, 404, 'the platform cannot delete a merchant\'s message');
  const junk = await api('DELETE', '/api/v1/support/messages/nope', { token: leheriyaToken });
  assert.equal(junk.status, 404);

  const gone = await api('DELETE', `/api/v1/support/messages/${sent.body.data.id}`, { token: leheriyaToken });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(gone.body.data.deleted, true);
  assert.equal(gone.body.data.text, '');
  assert.equal(gone.body.data.attachment, null);
  assert.equal(fs.readdirSync(dir).length, filesBefore - 1, 'the file is removed from disk');
  const media = await api('GET', sent.body.data.attachment.url);
  assert.equal(media.status, 404);
  const again = await api('DELETE', `/api/v1/support/messages/${sent.body.data.id}`, { token: leheriyaToken });
  assert.equal(again.status, 404);

  const seen = await api('GET', '/api/v1/support/messages', { token: leheriyaOpsToken });
  const placeholder = seen.body.data.find((m) => m.id === sent.body.data.id);
  assert.equal(placeholder.deleted, true, 'the other side sees that a message was deleted');
  assert.equal(placeholder.text, '');
  const quoting = seen.body.data.find((m) => m.id === reply.body.data.id);
  assert.equal(quoting.replyTo.text, 'This message was deleted');

  const own = await api('POST', `/api/v1/support/threads/${leheriya._id}/messages`, { token: platformToken, form: messageForm({ text: 'typo' }) });
  const ownGone = await api('DELETE', `/api/v1/support/threads/${leheriya._id}/messages/${own.body.data.id}`, { token: platformToken });
  assert.equal(ownGone.status, 200);
  const inbox = await api('GET', '/api/v1/support/threads', { token: platformToken });
  assert.equal(inbox.body.data.find((t) => t.tenantId === String(leheriya._id)).lastMessage.text, 'This message was deleted');
});

test.after(() => {
  const dir = path.join(__dirname, '../private-uploads/support');
  [leheriya, surat].forEach((tenant) => {
    if (tenant) fs.rmSync(path.join(dir, String(tenant._id)), { recursive: true, force: true });
  });
});
