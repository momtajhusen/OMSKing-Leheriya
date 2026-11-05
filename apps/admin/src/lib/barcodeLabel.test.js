import test from 'node:test';
import assert from 'node:assert/strict';
import { code128Modules, barcodeBars, barcodeLabelPdf, LABEL_WIDTH_PT, LABEL_HEIGHT_PT } from './barcodeLabel.js';

test('Code 128B encodes start, data, checksum and stop', () => {
  // "A" = value 33, checksum (104 + 33) % 103 = 34
  assert.deepEqual(code128Modules('A'), [
    2, 1, 1, 2, 1, 4,
    1, 1, 1, 3, 2, 3,
    1, 3, 1, 1, 2, 3,
    2, 3, 3, 1, 1, 1, 2,
  ]);
  const modules = code128Modules('8901234567890');
  assert.equal(modules.reduce((sum, w) => sum + w, 0), 11 * 15 + 13);
});

test('Code 128B rejects empty or non-printable values', () => {
  assert.throws(() => code128Modules(''));
  assert.throws(() => code128Modules('AB\u00e9'));
});

test('the barcode label is a one-page PDF of 51 mm by 25 mm', () => {
  assert.equal(LABEL_WIDTH_PT, 144.57);
  assert.equal(LABEL_HEIGHT_PT, 70.87);
  const pdf = barcodeLabelPdf({ value: 'SKU-001', name: 'Silk (Red) Saree' });
  assert.ok(pdf.startsWith('%PDF-1.4'));
  assert.ok(pdf.trimEnd().endsWith('%%EOF'));
  assert.match(pdf, /\/MediaBox \[0 0 144\.57 70\.87\]/);
  assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 1);
  assert.match(pdf, /\(SKU-001\) Tj/);
  assert.match(pdf, /\(Silk \\\(Red\\\) Saree\) Tj/);
  const bars = (pdf.match(/ re$/gm) || []).length;
  assert.equal(bars, code128Modules('SKU-001').filter((_, i) => i % 2 === 0).length);
  const startxref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(startxref, startxref + 4), 'xref');
  const offsets = [...pdf.matchAll(/(\d{10}) 00000 n \n/g)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 5);
  offsets.forEach((offset, i) => {
    assert.equal(pdf.slice(offset, offset + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
  });
});

test('barcode bars for the on-screen barcode follow the same Code 128 pattern as the printed label', () => {
  const modules = code128Modules('A');
  const { bars, width } = barcodeBars('A');
  assert.equal(width, modules.reduce((sum, w) => sum + w, 0));
  assert.equal(bars.length, Math.ceil(modules.length / 2));
  assert.deepEqual(bars[0], { x: 0, w: modules[0] });
  assert.deepEqual(bars[1], { x: modules[0] + modules[1], w: modules[2] });
  assert.deepEqual(barcodeBars(''), { bars: [], width: 0 }, 'nothing to draw for an empty value');
  assert.deepEqual(barcodeBars('रंग'), { bars: [], width: 0 }, 'non-ASCII value draws nothing instead of crashing the page');
});
