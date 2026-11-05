import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const router = read('../../router/index.jsx');
const page = read('./FulfilmentPage.jsx');
const vendors = read('./VendorsPage.jsx');
const reports = read('./ReportsPage.jsx');

test('vendor assignment page is called Assignment in the menu so it is not confused with Shipping', () => {
  assert.match(router, /path: '\/fulfilment',\s*label: 'Assignment',/);
  assert.doesNotMatch(router, /label: 'Fulfilment'/);
});

test('Assignment page heading and loader use the new name', () => {
  assert.match(page, /<h1 className="text-xl font-bold">Assignment<\/h1>/);
  assert.match(page, /<PageLoader label="Loading assignment\.\.\." \/>/);
});

test('hints on other pages point to Assignment, not Fulfilment', () => {
  assert.match(vendors, /Assignment can only assign saved vendors\./);
  assert.match(vendors, /description="Assignments will show here\."/);
  assert.match(reports, /Assign sub-orders to vendors on Assignment\./);
  assert.match(vendors, /When on, Assignment picks the Shopify vendor name automatically/);
  assert.doesNotMatch(vendors + reports, /Fulfilment|fulfilment assigns/);
});
