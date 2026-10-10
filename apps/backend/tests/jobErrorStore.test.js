process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { processDueJobs } = require('../src/services/jobQueue.service');
const Tenant = require('../src/models/Tenant');
const IntegrationJob = require('../src/models/IntegrationJob');

const TOKEN = 'shpat_jobstoretoken';
const BEARER = 'jobbearertokenvalue';
const API_KEY = 'jobapikeyvalue';
const URL_PASSWORD = 'joburlpassword';

let memory;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('a failed job stores the error with tokens and secrets masked', async () => {
  const tenant = await Tenant.create({
    name: 'Job Error Shop',
    slug: `job-error-${Date.now()}`,
    kind: 'merchant',
    status: 'active',
  });
  const job = await IntegrationJob.create({
    tenantId: tenant._id,
    channel: 'shopify',
    jobType: 'manual',
    direction: 'pull',
    status: 'queued',
    nextRunAt: new Date(),
    payload: {
      failMessage: `Pull failed Bearer ${BEARER} api_key=${API_KEY} https://seller:${URL_PASSWORD}@example.com/admin token=${TOKEN}`,
    },
  });

  await processDueJobs();

  const stored = await IntegrationJob.findById(job._id).setOptions({ skipTenantFilter: true });
  assert.equal(stored.status, 'failed');
  const text = `${stored.lastError}\n${stored.shortSummary}`;
  assert.match(text, /Pull failed/);
  for (const secret of [TOKEN, BEARER, API_KEY, URL_PASSWORD]) {
    assert.equal(text.includes(secret), false);
  }
});
