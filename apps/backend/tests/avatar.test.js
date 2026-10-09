process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Role = require('../src/models/Role');
const User = require('../src/models/User');
const { uploadMyAvatar, clearMyAvatar } = require('../src/controllers/auth.controller');
const { uploadsRoot } = require('../src/middleware/uploadImage');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

function call(fn, req) {
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); },
    };
    fn(req, res).catch(reject);
  });
}

test('any login can save and replace its own profile photo', async () => {
  const tenant = await Tenant.create({ name: 'Photo Shop', slug: `photo-${Date.now()}`, kind: 'merchant' });
  const role = await Role.create({ tenantId: tenant._id, name: 'Ops', code: 'operations', permissions: [] });
  const user = await User.create({
    tenantId: tenant._id,
    fullName: 'Ops User',
    email: `ops-${Date.now()}@example.com`,
    passwordHash: 'hash',
    roleId: role._id,
  });
  const folder = String(tenant._id);
  const dir = path.join(uploadsRoot, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'first.png'), 'one');
  fs.writeFileSync(path.join(dir, 'second.png'), 'two');

  const req = {
    user: { id: String(user._id), homeTenantId: folder, impersonating: false },
    tenantId: folder,
    avatarFolder: folder,
    file: { filename: 'first.png' },
  };
  const first = await call(uploadMyAvatar, req);
  assert.equal(first.body.data.avatarUrl, `/uploads/${folder}/first.png`);

  req.file = { filename: 'second.png' };
  const second = await call(uploadMyAvatar, req);
  assert.equal(second.body.data.avatarUrl, `/uploads/${folder}/second.png`);
  assert.equal(fs.existsSync(path.join(dir, 'first.png')), false);

  const cleared = await call(clearMyAvatar, req);
  assert.equal(cleared.body.data.avatarUrl, '');
  assert.equal(fs.existsSync(path.join(dir, 'second.png')), false);
});
