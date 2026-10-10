process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const {
  helloSupportsTransactions,
  replicaSetAvailable,
  assertTransactionSupport,
  resetReplicaSetCache,
} = require('../src/lib/withTransaction');

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  resetReplicaSetCache();
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('hello treats a replica set and Atlas mongos as transaction-capable', () => {
  assert.equal(helloSupportsTransactions({ setName: 'atlas-rs-0' }), true);
  assert.equal(helloSupportsTransactions({ msg: 'isdbgrid' }), true);
  assert.equal(helloSupportsTransactions({}), false);
  assert.equal(helloSupportsTransactions({ isWritablePrimary: true }), false);
});

test('standalone Mongo is not a replica set or Atlas', async () => {
  resetReplicaSetCache();
  assert.equal(await replicaSetAvailable(), false);
});

test('startup check throws in production on standalone Mongo', async () => {
  resetReplicaSetCache();
  await assert.rejects(
    () => assertTransactionSupport({ env: 'production' }),
    /replica set or Atlas/,
  );
});

test('startup check does not throw outside production on standalone Mongo', async () => {
  resetReplicaSetCache();
  assert.equal(await assertTransactionSupport({ env: 'test' }), false);
});
