import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { vendorPick } from '../../lib/vendorLines.js';

const page = fs.readFileSync(new URL('./OrderDetailPage.jsx', import.meta.url), 'utf8');

test('picking a vendor only selects it; Assign is ready once the pick differs from the saved vendor', () => {
  const sub = { id: 'SHP-1-1', assignedVendor: '' };
  assert.deepEqual(vendorPick({}, sub), { value: '', changed: false });
  assert.deepEqual(vendorPick({ 'SHP-1-1': 'ABL' }, sub), { value: 'ABL', changed: true });
  const saved = { id: 'SHP-1-2', assignedVendor: 'ABL' };
  assert.deepEqual(vendorPick({ 'SHP-1-2': 'ABL' }, saved), { value: 'ABL', changed: false });
  assert.deepEqual(vendorPick({ 'SHP-1-2': '' }, saved), { value: '', changed: true });
});

test('the sub-order vendor dropdown waits for the Assign button at the far right of the row', () => {
  const table = page.slice(page.indexOf('Fulfilment & vendor tracking'));
  const select = table.slice(table.indexOf('<Select'), table.indexOf('</Select>'));
  assert.doesNotMatch(select, /assignSubOrder/, 'choosing a vendor does not assign it straight away');
  assert.match(select, /setPicks/);
  const lastCell = table.slice(table.lastIndexOf('<TableCell'));
  assert.match(lastCell, />\s*Assign\s*</, 'Assign sits in the last column');
  assert.match(lastCell, /assignPicked\(sub\)/);
  assert.match(lastCell, /disabled=\{!vendorPick\(picks, sub\)\.changed/);
});

test('when the company has no active vendors the row says so and links to the Vendors page', () => {
  assert.match(page, /No vendors yet/);
  assert.match(page, /to="\/vendors"/);
});
