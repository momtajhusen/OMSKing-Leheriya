import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./ReturnsPage.jsx', import.meta.url), 'utf8');

test('Returns table fits the page: fixed layout, stacked columns, restock select instead of radio row', () => {
  const table = page.slice(page.indexOf('Return Requests'), page.indexOf('Restock Destination Options'));
  assert.match(table, /table-fixed/);
  assert.match(table, /Return · Order/);
  assert.match(table, /Customer · Reason/);
  assert.match(table, /aria-label=\{`Restock for \$\{ret\.id\}`\}/);
  assert.doesNotMatch(table, /type="radio"/);
  assert.doesNotMatch(table, /Return ID<\/TableHead>/);
  assert.equal((table.match(/<TableHead[\s>]/g) || []).length, 7);
});
