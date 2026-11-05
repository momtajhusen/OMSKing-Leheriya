import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimName, claimText, kindOf, refundText, splitByKind } from './returnClaims.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('a return is a customer return or an RTO; lists split on that', () => {
  assert.equal(kindOf({ kind: 'rto' }), 'rto');
  assert.equal(kindOf({ type: 'rto' }), 'rto');
  assert.equal(kindOf({ type: 'customer_return' }), 'customer');
  assert.equal(kindOf({}), 'customer');
  const rows = [{ id: 'a', kind: 'customer' }, { id: 'b', kind: 'rto' }, { id: 'c' }];
  assert.deepEqual(splitByKind(rows), { customer: [rows[0], rows[2]], rto: [rows[1]] });
});

test('claim and refund read as short labels', () => {
  assert.equal(claimName('safet'), 'SAFE-T claim');
  assert.equal(claimName('myntra'), 'Myntra claim');
  assert.equal(claimName(''), '');
  assert.equal(claimText({ type: 'safet', status: 'to_file' }), 'SAFE-T claim: to file');
  assert.equal(claimText({ type: 'safet', status: 'filed', claimId: '123' }), 'SAFE-T claim: filed · 123');
  assert.equal(claimText({ type: 'myntra', status: 'approved', amount: 650 }), 'Myntra claim: approved · ₹650');
  assert.equal(claimText({ type: 'myntra', status: 'none' }), '');
  assert.equal(claimText({ type: '', status: 'none' }), '');
  assert.equal(refundText({ refundStatus: 'refunded', refundAmount: 999 }), 'Refunded ₹999');
  assert.equal(refundText({ refundStatus: 'pending' }), 'Refund pending');
  assert.equal(refundText({ refundStatus: 'not_due' }), 'No refund due');
});

test('Returns page: Customer returns / RTO tabs, QC fail option with a note, claim & refund form saved by API', () => {
  const page = read('../pages/admin/ReturnsPage.jsx');
  const store = read('../stores/returnsStore.js');
  assert.match(page, /splitByKind\(returns\)/);
  assert.match(page, /'Customer returns'/);
  assert.match(page, /<option value="damaged">QC fail/);
  assert.match(page, /setQcNote/);
  assert.match(page, /saveClaim\(claimFor\.id/);
  assert.match(page, /saveRefund\(claimFor\.id/);
  assert.match(store, /api\.patch\(`\/returns\/\$\{encodeURIComponent\(id\)\}\/claim`/);
  assert.match(store, /api\.patch\(`\/returns\/\$\{encodeURIComponent\(id\)\}\/refund`/);
  assert.match(store, /type: row\.type \|\| 'customer_return'/);
  assert.match(store, /\{ destination: action === 'restock' \? dest : 'None', action, qcNote \}/);
});
