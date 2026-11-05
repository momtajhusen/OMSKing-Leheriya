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
const Tenant = require('../src/models/Tenant');
const Role = require('../src/models/Role');
const User = require('../src/models/User');
const app = require('../src/app');

let memory;
let server;
let base;
let platformToken;
let ownerToken;
let opsToken;
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
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function textForm(fields) {
  const form = new FormData();
  Object.entries(fields).forEach(([k, v]) => form.append(k, String(v)));
  return form;
}

async function login(email) {
  const res = await api('POST', '/api/v1/auth/login', { json: { email, password: 'Password1' } });
  assert.equal(res.status, 200, `login ${email}`);
  return res.body.data.accessToken;
}

async function addUser(tenant, roleCode, email, fullName) {
  const role = await Role.findOne({ tenantId: tenant._id, code: roleCode }).setOptions({ skipTenantFilter: true });
  await User.create({
    tenantId: tenant._id,
    fullName,
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
    fullName: 'Momtaj',
    email: 'momtaj-updates@omsking.com',
    passwordHash: await hashPassword('Password1'),
    roleId: role._id,
    status: 'active',
    emailVerified: true,
  });
  ({ tenant: leheriya } = await provisionMerchant({
    name: 'Leheriya Updates', ownerEmail: 'owner-upd@leheriya.com', ownerName: 'Leheriya Owner', password: 'Password1', status: 'active',
  }));
  ({ tenant: surat } = await provisionMerchant({
    name: 'Surat Updates', ownerEmail: 'ravi-upd@suratsilks.com', ownerName: 'Ravi', password: 'Password1', status: 'active',
  }));
  await addUser(leheriya, 'operations', 'ops-upd@leheriya.com', 'Ops Asha');
  await addUser(leheriya, 'vendor', 'vendor-upd@leheriya.com', 'Vendor Vinod');

  platformToken = await login('momtaj-updates@omsking.com');
  ownerToken = await login('owner-upd@leheriya.com');
  opsToken = await login('ops-upd@leheriya.com');
  vendorToken = await login('vendor-upd@leheriya.com');
  suratToken = await login('ravi-upd@suratsilks.com');
});

test.after(async () => {
  server.close();
  await mongoose.disconnect();
  if (memory) await memory.stop();
  const dir = path.join(__dirname, '../private-uploads/support');
  [leheriya, surat].forEach((t) => t && fs.rmSync(path.join(dir, String(t._id)), { recursive: true, force: true }));
});

let labelUpdate;
let labelMessage;

test('a client sends a report as a tracked update and replies group under it', async () => {
  const sent = await api('POST', '/api/v1/support/messages', {
    token: ownerToken,
    form: textForm({ text: 'Label not printing for order #1001', trackAsUpdate: 'true', tenantId: String(surat._id) }),
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  labelMessage = sent.body.data;
  assert.equal(labelMessage.update.status, 'pending');
  assert.equal(labelMessage.update.title, 'Label not printing for order #1001');
  assert.equal(labelMessage.update.markedBy, 'tenant', 'the chat filter knows the client marked it pending');

  const list = await api('GET', '/api/v1/support/updates', { token: ownerToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.data.length, 1);
  [labelUpdate] = list.body.data;
  assert.equal(labelUpdate.createdByName, 'Leheriya Owner');
  assert.equal(labelUpdate.createdSide, 'tenant');
  assert.equal(labelUpdate.messageCount, 1);
  assert.equal(list.body.meta.counts.pending, 1);

  const reply = await api('POST', `/api/v1/support/threads/${leheriya._id}/messages`, {
    token: platformToken,
    form: textForm({ text: 'Looking into it', replyTo: labelMessage.id }),
  });
  assert.equal(reply.body.data.update.id, labelUpdate.id, 'a reply joins the update of the message it quotes');

  const again = await api('GET', '/api/v1/support/updates', { token: ownerToken });
  assert.equal(again.body.data[0].messageCount, 2);
  assert.deepEqual(again.body.data[0].messages.map((m) => m.text), ['Label not printing for order #1001', 'Looking into it']);

  const suratList = await api('GET', '/api/v1/support/updates', { token: suratToken });
  assert.equal(suratList.body.data.length, 0, 'tenantId in the body must not move the update to another company');
});

test('tracking a reply to a tracked message keeps it in the same update instead of failing', async () => {
  const reply = await api('POST', '/api/v1/support/messages', {
    token: ownerToken,
    form: textForm({ text: 'Screenshot of the error attached earlier', replyTo: labelMessage.id, trackAsUpdate: 'true' }),
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.data.update.id, labelUpdate.id);
  const list = await api('GET', '/api/v1/support/updates', { token: ownerToken });
  assert.equal(list.body.data.length, 1, 'no second update was created');
});

test('any earlier message can be tracked later, once, with an edited title', async () => {
  const plain = await api('POST', '/api/v1/support/messages', { token: opsToken, form: textForm({ text: 'Myntra stock is 0 for SKU LEH-22' }) });
  assert.equal(plain.body.data.update, null);

  const tracked = await api('POST', '/api/v1/support/updates', {
    token: opsToken,
    json: { messageId: plain.body.data.id, title: 'Myntra stock shows 0' },
  });
  assert.equal(tracked.status, 201, JSON.stringify(tracked.body));
  assert.equal(tracked.body.data.title, 'Myntra stock shows 0');
  assert.equal(tracked.body.data.status, 'pending');

  const dup = await api('POST', '/api/v1/support/updates', { token: opsToken, json: { messageId: plain.body.data.id } });
  assert.equal(dup.status, 409);

  const foreign = await api('POST', '/api/v1/support/updates', { token: suratToken, json: { messageId: plain.body.data.id } });
  assert.equal(foreign.status, 404);

  const blank = await api('PATCH', `/api/v1/support/updates/${tracked.body.data.id}`, { token: opsToken, json: { action: 'rename', title: '  ' } });
  assert.equal(blank.status, 400);
  const tooLong = await api('PATCH', `/api/v1/support/updates/${tracked.body.data.id}`, { token: opsToken, json: { action: 'rename', title: 'x'.repeat(161) } });
  assert.equal(tooLong.status, 400);
});

test('developers mark progress and done; each mark leaves a label in the chat', async () => {
  const merchantFix = await api('PATCH', `/api/v1/support/updates/${labelUpdate.id}`, { token: ownerToken, json: { action: 'complete' } });
  assert.equal(merchantFix.status, 403, 'only the platform marks work as done');

  const started = await api('PATCH', `/api/v1/support/threads/${leheriya._id}/updates/${labelUpdate.id}`, {
    token: platformToken, json: { action: 'start' },
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(started.body.data.status, 'in_progress');

  const done = await api('PATCH', `/api/v1/support/threads/${leheriya._id}/updates/${labelUpdate.id}`, {
    token: platformToken, json: { action: 'complete', note: 'Pincode check added' },
  });
  assert.equal(done.body.data.status, 'done');
  assert.equal(done.body.data.doneByName, 'Momtaj');
  assert.deepEqual(done.body.data.history.map((h) => h.action), ['created', 'start', 'complete']);
  assert.equal(done.body.data.history[2].note, 'Pincode check added');

  const again = await api('PATCH', `/api/v1/support/threads/${leheriya._id}/updates/${labelUpdate.id}`, {
    token: platformToken, json: { action: 'start' },
  });
  assert.equal(again.status, 400, 'cannot move a done item back to in progress without reopening');

  const chat = await api('GET', '/api/v1/support/messages', { token: ownerToken });
  const events = chat.body.data.filter((m) => m.event);
  assert.deepEqual(events.map((m) => m.event.action), ['start', 'complete']);
  assert.equal(events[1].senderName, 'Momtaj');
  assert.equal(events[1].event.title, 'Label not printing for order #1001');
  assert.equal(events[1].event.note, 'Pincode check added');
  const source = chat.body.data.find((m) => m.id === labelMessage.id);
  assert.equal(source.update.status, 'done', 'the original bubble shows the latest status');
  assert.equal(source.update.markedBy, 'platform', 'the chat filter knows the developer made the last mark');

  const unread = await api('GET', '/api/v1/support/unread', { token: ownerToken });
  assert.ok(unread.body.data.unread >= 3, 'status labels notify the client');
});

test('the client confirms a done item or reopens it, and the platform sees who confirmed', async () => {
  const suratTry = await api('PATCH', `/api/v1/support/updates/${labelUpdate.id}`, { token: suratToken, json: { action: 'confirm' } });
  assert.equal(suratTry.status, 404);

  const reopened = await api('PATCH', `/api/v1/support/updates/${labelUpdate.id}`, {
    token: opsToken, json: { action: 'reopen', note: 'Still failing on COD orders' },
  });
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.data.status, 'pending');

  await api('PATCH', `/api/v1/support/threads/${leheriya._id}/updates/${labelUpdate.id}`, { token: platformToken, json: { action: 'complete' } });
  const confirmed = await api('PATCH', `/api/v1/support/updates/${labelUpdate.id}`, { token: ownerToken, json: { action: 'confirm' } });
  assert.equal(confirmed.body.data.status, 'confirmed');
  assert.equal(confirmed.body.data.confirmedByName, 'Leheriya Owner');

  const platformView = await api('GET', `/api/v1/support/threads/${leheriya._id}/updates`, { token: platformToken });
  const row = platformView.body.data.find((u) => u.id === labelUpdate.id);
  assert.equal(row.status, 'confirmed');
  assert.deepEqual(row.history.map((h) => `${h.side}:${h.action}`), [
    'tenant:created', 'platform:start', 'platform:complete', 'tenant:reopen', 'platform:complete', 'tenant:confirm',
  ]);
});

test('the platform sees every company\'s open updates in one list', async () => {
  const s = await api('POST', '/api/v1/support/messages', { token: suratToken, form: textForm({ text: 'Invoice GST wrong', trackAsUpdate: '1' }) });
  assert.equal(s.status, 201);

  const merchantAll = await api('GET', '/api/v1/support/all-updates', { token: ownerToken });
  assert.equal(merchantAll.status, 403);

  const all = await api('GET', '/api/v1/support/all-updates', { token: platformToken });
  assert.equal(all.status, 200);
  assert.ok(all.body.data.some((u) => u.tenantName === 'Surat Updates' && u.title === 'Invoice GST wrong'));
  assert.ok(all.body.data.some((u) => u.tenantName === 'Leheriya Updates'));

  const open = await api('GET', '/api/v1/support/all-updates?status=pending', { token: platformToken });
  assert.ok(open.body.data.every((u) => u.status === 'pending'));

  const threads = await api('GET', '/api/v1/support/threads', { token: platformToken });
  const lehRow = threads.body.data.find((t) => t.tenantId === String(leheriya._id));
  const suratRow = threads.body.data.find((t) => t.tenantId === String(surat._id));
  assert.equal(lehRow.openUpdates, 1, 'Myntra item still open, label item confirmed');
  assert.equal(suratRow.openUpdates, 1);
});

test('"Not fixed" can carry a voice note and screenshots that join the update', async () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
  const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(64, 3)]);
  const evidence = (file, type, name, extra = {}) => {
    const form = new FormData();
    Object.entries({ updateId: labelUpdate.id, ...extra }).forEach(([k, v]) => form.append(k, String(v)));
    form.append('file', new Blob([file], { type }), name);
    return form;
  };

  const reopened = await api('PATCH', `/api/v1/support/updates/${labelUpdate.id}`, {
    token: ownerToken, json: { action: 'reopen', note: 'Still blank on COD' },
  });
  assert.equal(reopened.status, 200, JSON.stringify(reopened.body));

  const voice = await api('POST', '/api/v1/support/messages', { token: ownerToken, form: evidence(WEBM, 'audio/webm', 'v.webm', { durationSec: 4 }) });
  assert.equal(voice.status, 201, JSON.stringify(voice.body));
  assert.equal(voice.body.data.update.id, labelUpdate.id);
  assert.equal(voice.body.data.replyTo, null, 'evidence is linked to the update, not shown as a quote');
  const shot = await api('POST', '/api/v1/support/messages', { token: ownerToken, form: evidence(PNG, 'image/png', 's.png') });
  assert.equal(shot.status, 201);

  const list = await api('GET', '/api/v1/support/updates', { token: ownerToken });
  const row = list.body.data.find((u) => u.id === labelUpdate.id);
  assert.equal(row.status, 'pending');
  assert.deepEqual(row.messages.slice(-2).map((m) => m.attachment.kind), ['audio', 'image']);

  const foreign = await api('POST', '/api/v1/support/messages', { token: suratToken, form: evidence(PNG, 'image/png', 's.png') });
  assert.equal(foreign.status, 400, 'another company cannot attach to this update');
  const junk = await api('POST', '/api/v1/support/messages', { token: ownerToken, form: textForm({ text: 'x', updateId: 'nope' }) });
  assert.equal(junk.status, 400);
});

test('deleting the message that started an update withdraws it; status labels cannot be deleted', async () => {
  const sent = await api('POST', '/api/v1/support/messages', {
    token: ownerToken, form: textForm({ text: 'Sent by mistake', trackAsUpdate: 'true' }),
  });
  assert.equal(sent.body.data.update.status, 'pending');
  const gone = await api('DELETE', `/api/v1/support/messages/${sent.body.data.id}`, { token: ownerToken });
  assert.equal(gone.status, 200);
  assert.equal(gone.body.data.update, null);
  const list = await api('GET', '/api/v1/support/updates', { token: ownerToken });
  assert.equal(list.body.data.some((u) => u.id === sent.body.data.update.id), false);

  const chat = await api('GET', `/api/v1/support/threads/${leheriya._id}/messages`, { token: platformToken });
  const label = chat.body.data.find((m) => m.event && m.mine);
  assert.ok(label, 'the platform made a status mark earlier');
  const labelTry = await api('DELETE', `/api/v1/support/threads/${leheriya._id}/messages/${label.id}`, { token: platformToken });
  assert.equal(labelTry.status, 404);
});

test('vendors cannot see or mark updates', async () => {
  const list = await api('GET', '/api/v1/support/updates', { token: vendorToken });
  assert.equal(list.status, 403);
  const mark = await api('PATCH', `/api/v1/support/updates/${labelUpdate.id}`, { token: vendorToken, json: { action: 'confirm' } });
  assert.equal(mark.status, 403);
});

test('a completed update carries a short issue / fix summary that the client chat and module list both get', async () => {
  const sent = await api('POST', '/api/v1/support/messages', {
    token: ownerToken, form: textForm({ text: 'Inventory page is not opening', trackAsUpdate: 'true' }),
  });
  const updateId = sent.body.data.update.id;
  const mark = (json, token = platformToken) => api('PATCH', `/api/v1/support/threads/${leheriya._id}/updates/${updateId}`, { token, json });
  const summary = {
    action: 'summary', issue: 'Inventory page atak jaata tha', fix: 'Inventory API halki ki', area: 'Stock → Inventory', check: 'Inventory kholo; list load hoti hai',
  };

  assert.equal((await mark(summary)).status, 400, 'only a completed update gets a summary');
  await mark({ action: 'complete' });
  const merchantTry = await api('PATCH', `/api/v1/support/updates/${updateId}`, { token: ownerToken, json: summary });
  assert.equal(merchantTry.status, 403, 'only the OMSKing team writes the summary');
  assert.equal((await mark({ ...summary, issue: 'x'.repeat(201) })).status, 400);
  assert.equal((await mark({ ...summary, check: 'x'.repeat(301) })).status, 400);

  const saved = await mark(summary);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.status, 'done', 'a summary does not change the status');

  const chat = await api('GET', '/api/v1/support/messages', { token: ownerToken });
  const source = chat.body.data.find((m) => m.id === sent.body.data.id);
  assert.equal(source.update.issue, 'Inventory page atak jaata tha');
  assert.equal(source.update.fix, 'Inventory API halki ki');
  assert.equal(source.update.area, 'Stock → Inventory', 'the chat can open the page the fix was on');
  assert.equal(source.update.check, 'Inventory kholo; list load hoti hai', 'the chat shows how to verify the fix');
  assert.equal(source.update.markedBy, 'platform', 'the summary is not a status mark');
  assert.equal(chat.body.data.filter((m) => m.event?.action === 'summary').length, 0, 'no status label is posted for it');

  const list = await api('GET', '/api/v1/support/summaries', { token: opsToken });
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.data.find((s) => s.messageId === sent.body.data.id), {
    messageId: sent.body.data.id, area: 'Stock → Inventory', issue: 'Inventory page atak jaata tha', fix: 'Inventory API halki ki',
  });
  const surat = await api('GET', '/api/v1/support/summaries', { token: suratToken });
  assert.equal(surat.body.data.length, 0, 'another company never sees these summaries');
  const vendor = await api('GET', '/api/v1/support/summaries', { token: vendorToken });
  assert.notEqual(vendor.status, 200, 'vendors cannot read support summaries');
});

test('the first chat page carries the filter counts of the whole chat, for this company only', async () => {
  const counts = async (token = ownerToken) => (await api('GET', '/api/v1/support/messages?limit=1', { token })).body.meta.counts;
  const before = await counts();
  const suratBefore = await counts(suratToken);

  await api('POST', '/api/v1/support/messages', { token: ownerToken, form: textForm({ text: 'Orders page slow hai' }) });
  await api('POST', `/api/v1/support/threads/${leheriya._id}/messages`, { token: platformToken, form: textForm({ text: 'Dekh raha hoon' }) });
  const tracked = await api('POST', '/api/v1/support/messages', { token: ownerToken, form: textForm({ text: 'Label nahi ban raha', trackAsUpdate: 'true' }) });
  await api('PATCH', `/api/v1/support/threads/${leheriya._id}/updates/${tracked.body.data.update.id}`, { token: platformToken, json: { action: 'start' } });

  const after = await counts();
  assert.equal(after.all - before.all, 3, 'status labels are not counted');
  assert.equal(after.pending - before.pending, 1, 'a client message is pending until work starts; replies are not');
  assert.equal(after.progress - before.progress, 1);
  assert.equal(after.fixed, before.fixed);
  assert.equal(after.developer - before.developer, 1);
  assert.deepEqual(await counts(suratToken), suratBefore, 'another company never counts these messages');
  const older = await api('GET', `/api/v1/support/messages?limit=1&before=${tracked.body.data.id}`, { token: ownerToken });
  assert.equal(older.body.meta.counts, undefined, 'older pages do not recount');
});

test('an open update carries why it is waiting (stage + English reason) that the client chat shows and the filters count', async () => {
  const counts = async () => (await api('GET', '/api/v1/support/messages?limit=1', { token: ownerToken })).body.meta.counts;
  const before = await counts();
  const sent = await api('POST', '/api/v1/support/messages', {
    token: ownerToken, form: textForm({ text: 'Amazon labels are not generated', trackAsUpdate: 'true' }),
  });
  const updateId = sent.body.data.update.id;
  const mark = (json, token = platformToken) => api('PATCH', `/api/v1/support/threads/${leheriya._id}/updates/${updateId}`, { token, json });
  const why = { action: 'reason', stage: 'waiting_client', reason: 'Waiting for the client: do you ship Amazon orders with Easy Ship or Self Ship?' };

  const merchantTry = await api('PATCH', `/api/v1/support/updates/${updateId}`, { token: ownerToken, json: why });
  assert.equal(merchantTry.status, 403, 'only the OMSKing team writes the reason');
  assert.equal((await mark({ ...why, stage: 'sleeping' })).status, 400, 'unknown stage');
  assert.equal((await mark({ ...why, reason: 'x'.repeat(401) })).status, 400);
  const saved = await mark(why);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.data.status, 'pending', 'a reason does not change the status');

  const chat = await api('GET', '/api/v1/support/messages', { token: ownerToken });
  const source = chat.body.data.find((m) => m.id === sent.body.data.id);
  assert.equal(source.update.stage, 'waiting_client');
  assert.equal(source.update.reason, why.reason);
  assert.equal(source.update.markedBy, 'tenant', 'the reason is not a status mark');
  assert.equal(chat.body.data.filter((m) => m.event?.action === 'reason').length, 0, 'no status label is posted for it');

  const after = await counts();
  assert.equal(after.waiting - (before.waiting || 0), 1, 'counted under Waiting for client');
  assert.equal(after.pending - before.pending, 0, 'and not under Pending any more');

  await mark({ action: 'complete' });
  assert.equal((await mark(why)).status, 400, 'a completed update has no pending reason');
  const done = (await api('GET', '/api/v1/support/messages', { token: ownerToken })).body.data.find((m) => m.id === sent.body.data.id);
  assert.deepEqual([done.update.stage, done.update.reason], ['', ''], 'completing clears the reason');
});
