const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '../src/controllers/orders.controller.js'), 'utf8');
const block = src.match(/async function orderSummary[\s\S]*?\nasync function /)[0];

test('orderSummary builds settledOrderNos from desk data, not a missing rows binding', () => {
  assert.match(block, /settledOrderNos = data\.filter/);
  assert.doesNotMatch(block, /settledOrderNos = rows\.filter/);
});
