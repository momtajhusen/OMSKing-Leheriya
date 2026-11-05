import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { BULK_IMPORT_GUIDE } from './bulkImportGuide.js';

const page = fs.readFileSync(new URL('../pages/admin/ProductImportPage.jsx', import.meta.url), 'utf8');

test('bulk import guide explains what it is for and when to use it', () => {
  assert.ok(BULK_IMPORT_GUIDE.purpose.length >= 2);
  const purpose = BULK_IMPORT_GUIDE.purpose.join(' ');
  assert.match(purpose, /Master SKU/);
  assert.match(purpose, /Unmapped/);
});

test('bulk import guide walks through Shopify, Myntra, Amazon in order and the mapping step', () => {
  const steps = BULK_IMPORT_GUIDE.steps.map((s) => s.title);
  assert.deepEqual(steps.slice(0, 3).map((t) => t.split(' ')[0]), ['Shopify', 'Myntra', 'Amazon']);
  assert.match(BULK_IMPORT_GUIDE.steps[2].text, /never creates a new Master SKU/);
  assert.match(BULK_IMPORT_GUIDE.steps.at(-1).text, /SKU mapping/);
});

test('bulk import guide explains pull vs CSV and every result label', () => {
  const sources = BULK_IMPORT_GUIDE.sources.map((s) => s.label);
  assert.deepEqual(sources, ['Pull live catalog', 'Upload CSV']);
  const results = BULK_IMPORT_GUIDE.results.map((r) => r.label);
  assert.deepEqual(results, ['Created', 'Auto-mapped', 'Unmapped', 'Exists', 'Failed']);
  for (const r of BULK_IMPORT_GUIDE.results) assert.ok(r.text.length > 10);
  assert.match(BULK_IMPORT_GUIDE.notes.join(' '), /stock/);
});

test('bulk import page shows the guide', () => {
  assert.match(page, /BULK_IMPORT_GUIDE/);
  assert.match(page, /How Bulk import works/);
  assert.match(page, /<details/);
});
