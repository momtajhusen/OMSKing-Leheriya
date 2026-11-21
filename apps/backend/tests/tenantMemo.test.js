const test = require('node:test');
const assert = require('node:assert/strict');
const { tenantMemo, bustTenantMemo } = require('../src/lib/tenantMemo');

test('tenantMemo returns the same value within the TTL', async () => {
  bustTenantMemo();
  let hits = 0;
  const first = await tenantMemo('t:a', 50, async () => {
    hits += 1;
    return { n: hits };
  });
  const second = await tenantMemo('t:a', 50, async () => {
    hits += 1;
    return { n: hits };
  });
  assert.equal(first.n, 1);
  assert.equal(second.n, 1);
  assert.equal(hits, 1);
});

test('bustTenantMemo drops matching keys so the next call recomputes', async () => {
  bustTenantMemo();
  let hits = 0;
  await tenantMemo('desk:1:*', 60_000, async () => {
    hits += 1;
    return hits;
  });
  bustTenantMemo('desk:1');
  const next = await tenantMemo('desk:1:*', 60_000, async () => {
    hits += 1;
    return hits;
  });
  assert.equal(next, 2);
});
