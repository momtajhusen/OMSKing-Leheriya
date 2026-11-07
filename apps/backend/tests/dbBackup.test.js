process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { EventEmitter } = require('events');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../src/app');
const Tenant = require('../src/models/Tenant');
const Role = require('../src/models/Role');
const User = require('../src/models/User');
const { hashPassword } = require('../src/lib/password');
const { provisionMerchant } = require('../src/services/tenantOnboard.service');
const backup = require('../src/services/dbBackup.service');

const DUMP = Buffer.from('fake-mongodump-archive-bytes');
const GDRIVE_KEYS = ['GDRIVE_FOLDER_ID', 'GDRIVE_CLIENT_ID', 'GDRIVE_CLIENT_SECRET', 'GDRIVE_REFRESH_TOKEN', 'GDRIVE_SERVICE_ACCOUNT_FILE'];
let memory;
let server;
let base;
let platformToken;
let merchantToken;
let spawned;
let archives;

function fakeSpawn({ code = 0 } = {}) {
  return (cmd, args, opts) => {
    spawned.push({ cmd, args, opts });
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    const archive = args.find((arg) => arg.startsWith('--archive=')).slice('--archive='.length);
    archives.push(archive);
    setImmediate(() => {
      if (code === 0) fs.writeFileSync(archive, DUMP);
      else child.stderr.emit('data', 'error connecting to mongodb://admin:s3cret@127.0.0.1:27017');
      child.emit('close', code);
    });
    return child;
  };
}

function fakeGoogle({ failUpload = false, failFinish = false, verifyAssertion, folders = [] } = {}) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const reply = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
    if (url === 'https://oauth2.googleapis.com/token') {
      if (verifyAssertion) verifyAssertion(new URLSearchParams(init.body));
      return reply(200, { access_token: 'ya29.test-token' });
    }
    if (url.startsWith('https://www.googleapis.com/drive/v3/files?q=')) return reply(200, { files: folders });
    if (url.startsWith('https://www.googleapis.com/drive/v3/files') && init.method === 'POST') {
      const folder = { id: `own-folder-${folders.length + 1}`, ...JSON.parse(init.body) };
      folders.push(folder);
      return reply(200, folder);
    }
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) {
      return failUpload
        ? reply(403, { error: { code: 403, errors: [{ reason: 'storageQuotaExceeded' }], message: 'Service Accounts do not have storage quota.' } })
        : reply(200, {}, { location: 'https://upload.example/session-1' });
    }
    if (url === 'https://upload.example/session-1') {
      return failFinish
        ? reply(403, { error: { code: 403, errors: [{ reason: 'storageQuotaExceeded' }], message: 'Service Accounts do not have storage quota.' } })
        : reply(200, { id: 'drive-file-1' });
    }
    throw new Error(`unexpected ${url}`);
  };
  return { fn, calls };
}

async function download(token) {
  const res = await fetch(`${base}/api/v1/tenants/ops/backup`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });
  const body = Buffer.from(await res.arrayBuffer());
  return { res, body };
}

function clearDriveEnv() {
  GDRIVE_KEYS.forEach((key) => delete process.env[key]);
}

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;

  const platformTenant = await Tenant.create({ name: 'OMSKing SaaS', slug: `plat-${Date.now()}`, kind: 'platform', status: 'active' });
  const role = await Role.create({ tenantId: platformTenant._id, code: 'platform_admin', name: 'Platform Admin', permissions: ['tenants.manage'], isSystem: true });
  const email = `platform-${Date.now()}@omsking.test`;
  await User.create({ tenantId: platformTenant._id, fullName: 'Platform', email, passwordHash: await hashPassword('Password1'), roleId: role._id, status: 'active', emailVerified: true });
  platformToken = (await (await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Password1' }) })).json()).data.accessToken;

  const ownerEmail = `owner-${Date.now()}@example.com`;
  await provisionMerchant({ name: 'Backup Merchant', ownerEmail, ownerName: 'Owner', password: 'Password1', status: 'active' });
  merchantToken = (await (await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: ownerEmail, password: 'Password1' }) })).json()).data.accessToken;
});

test.beforeEach(() => {
  spawned = [];
  archives = [];
  clearDriveEnv();
  backup.deps.spawn = fakeSpawn();
});

test.after(async () => {
  clearDriveEnv();
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
  await memory.stop();
});

test('only the platform admin can take a backup; a company owner cannot download every company\'s data', async () => {
  assert.equal((await download()).res.status, 401);
  assert.equal((await download(merchantToken)).res.status, 403);
  const status = await fetch(`${base}/api/v1/tenants/ops/backup/status`, { headers: { authorization: `Bearer ${merchantToken}` } });
  assert.equal(status.status, 403);
  assert.equal(spawned.length, 0, 'mongodump never ran');
});

test('platform admin gets a fresh gzip mongodump as a file download; the temp file is removed and the run is recorded', async () => {
  const { res, body } = await download(platformToken);
  assert.equal(res.status, 200);
  assert.deepEqual(body, DUMP);
  assert.match(res.headers.get('content-disposition'), /attachment; filename="omsking-backup-\d{4}-\d{2}-\d{2}-\d{4}\.archive\.gz"/);
  assert.equal(res.headers.get('x-backup-drive'), 'not_connected');
  assert.equal(spawned[0].cmd, 'mongodump');
  assert.ok(spawned[0].args.includes('--gzip'));
  assert.equal(spawned[0].opts.shell, undefined, 'no shell, so the URI cannot be injected');
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(fs.existsSync(archives[0]), false, 'server temp copy deleted after sending');

  const auto = await fetch(`${base}/api/v1/tenants/ops/backup?trigger=auto`, { method: 'POST', headers: { authorization: `Bearer ${platformToken}` } });
  assert.equal(auto.status, 200);
  await auto.arrayBuffer();

  const status = await (await fetch(`${base}/api/v1/tenants/ops/backup/status`, { headers: { authorization: `Bearer ${platformToken}` } })).json();
  assert.equal(status.data.drive.connected, false);
  assert.deepEqual(status.data.history.map((row) => [row.trigger, row.status]), [['auto', 'ok'], ['manual', 'ok']], 'newest first, manual vs automatic');
  assert.equal(status.data.last.drive, 'not_connected');
  assert.equal(status.data.last.size, DUMP.length);
  assert.match(status.data.last.name, /^omsking-backup-/);
});

test('with Google Drive OAuth set in env, the same file is uploaded to the folder; the token never reaches the browser', async () => {
  Object.assign(process.env, { GDRIVE_FOLDER_ID: 'folder-123', GDRIVE_CLIENT_ID: 'cid', GDRIVE_CLIENT_SECRET: 'csecret', GDRIVE_REFRESH_TOKEN: 'rtoken' });
  const google = fakeGoogle();
  backup.deps.fetch = google.fn;
  const { res, body } = await download(platformToken);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-backup-drive'), 'uploaded');
  assert.deepEqual(body, DUMP);
  const tokenCall = new URLSearchParams(google.calls[0].init.body);
  assert.equal(tokenCall.get('grant_type'), 'refresh_token');
  assert.equal(tokenCall.get('refresh_token'), 'rtoken');
  const meta = JSON.parse(google.calls[1].init.body);
  assert.deepEqual(meta.parents, ['folder-123']);
  assert.match(meta.name, /^omsking-backup-.*\.archive\.gz$/);
  assert.equal(google.calls[1].init.headers.authorization, 'Bearer ya29.test-token');
  assert.deepEqual(Buffer.from(google.calls[2].init.body), DUMP, 'Drive gets the same bytes as the download');
  const headers = JSON.stringify([...res.headers.entries()]);
  assert.doesNotMatch(headers, /ya29|rtoken|csecret/);
});

test('a Google Drive failure does not block the computer download', async () => {
  Object.assign(process.env, { GDRIVE_FOLDER_ID: 'folder-123', GDRIVE_CLIENT_ID: 'cid', GDRIVE_CLIENT_SECRET: 'csecret', GDRIVE_REFRESH_TOKEN: 'rtoken' });
  backup.deps.fetch = fakeGoogle({ failUpload: true }).fn;
  const { res, body } = await download(platformToken);
  assert.equal(res.status, 200);
  assert.deepEqual(body, DUMP);
  assert.equal(res.headers.get('x-backup-drive'), 'failed');
  assert.equal(res.headers.get('x-backup-drive-reason'), 'Drive refused the upload (403 storageQuotaExceeded)', 'Google\'s reason is shown, e.g. a service account without a Shared Drive');
});

test('when Drive accepts the upload session but refuses the bytes, Google\'s reason is still shown', async () => {
  Object.assign(process.env, { GDRIVE_FOLDER_ID: 'folder-123', GDRIVE_CLIENT_ID: 'cid', GDRIVE_CLIENT_SECRET: 'csecret', GDRIVE_REFRESH_TOKEN: 'rtoken' });
  backup.deps.fetch = fakeGoogle({ failFinish: true }).fn;
  const { res } = await download(platformToken);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-backup-drive'), 'failed');
  assert.equal(res.headers.get('x-backup-drive-reason'), 'Drive upload did not finish (403 storageQuotaExceeded)');
});

test('a service-account key file signs a valid Google JWT for the drive.file scope', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyFile = path.join(os.tmpdir(), `sa-${Date.now()}.json`);
  fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'backup@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  Object.assign(process.env, { GDRIVE_FOLDER_ID: 'shared-folder', GDRIVE_SERVICE_ACCOUNT_FILE: keyFile });
  let claims;
  backup.deps.fetch = fakeGoogle({
    verifyAssertion: (form) => {
      assert.equal(form.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const [head, payload, sig] = form.get('assertion').split('.');
      assert.ok(crypto.createVerify('RSA-SHA256').update(`${head}.${payload}`).verify(publicKey, sig, 'base64url'));
      claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    },
  }).fn;
  const { res } = await download(platformToken);
  fs.rmSync(keyFile, { force: true });
  assert.equal(res.headers.get('x-backup-drive'), 'uploaded');
  assert.equal(claims.iss, 'backup@proj.iam.gserviceaccount.com');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/drive.file');
});

test('a service-account key without a folder id uploads into an "OMSKing Backups" folder the service account owns, created once and reused', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const keyFile = path.join(os.tmpdir(), `sa-own-${Date.now()}.json`);
  fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'backup@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  process.env.GDRIVE_SERVICE_ACCOUNT_FILE = keyFile;
  try {
    const folders = [];
    const first = fakeGoogle({ folders });
    backup.deps.fetch = first.fn;
    const made = { file: keyFile, name: 'omsking-backup-test.archive.gz' };
    const one = await backup.uploadToDrive(made);
    assert.equal(one.status, 'uploaded');
    assert.equal(one.folderId, 'own-folder-1');
    const created = first.calls.find((c) => c.init.method === 'POST' && c.url.startsWith('https://www.googleapis.com/drive/v3/files'));
    assert.deepEqual(JSON.parse(created.init.body), { name: 'OMSKing Backups', mimeType: 'application/vnd.google-apps.folder' });
    const meta = JSON.parse(first.calls.find((c) => c.url.startsWith('https://www.googleapis.com/upload/drive/v3/files')).init.body);
    assert.deepEqual(meta.parents, ['own-folder-1']);

    const second = fakeGoogle({ folders });
    backup.deps.fetch = second.fn;
    const two = await backup.uploadToDrive(made);
    assert.equal(two.folderId, 'own-folder-1');
    assert.equal(folders.length, 1, 'the folder is not created twice');
    assert.equal(backup.driveSettings().configured, true);
  } finally {
    fs.rmSync(keyFile, { force: true });
  }
});

test('a failed mongodump returns a clean error without the database password', async () => {
  backup.deps.spawn = fakeSpawn({ code: 1 });
  const { res, body } = await download(platformToken);
  assert.equal(res.status, 500);
  assert.doesNotMatch(body.toString(), /s3cret|mongodb:\/\//);
  assert.match(JSON.parse(body.toString()).message, /Backup failed on the server/);
  assert.equal(backup.hideUri('mongodb://admin:s3cret@127.0.0.1/x'), 'mongodb://<hidden>@127.0.0.1/x');
  const status = await (await fetch(`${base}/api/v1/tenants/ops/backup/status`, { headers: { authorization: `Bearer ${platformToken}` } })).json();
  assert.equal(status.data.last.status, 'failed', 'a failed run shows in the history');
  assert.match(status.data.last.reason, /Backup failed on the server/);
  assert.doesNotMatch(JSON.stringify(status.data), /s3cret/);
  assert.equal(backup.backupFileName(new Date('2026-11-05T13:00:00Z')), 'omsking-backup-2026-11-05-1830.archive.gz');
});
