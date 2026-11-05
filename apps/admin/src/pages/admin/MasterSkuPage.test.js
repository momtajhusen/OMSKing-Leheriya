import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const page = fs.readFileSync(new URL('./MasterSkuPage.jsx', import.meta.url), 'utf8');
const card = fs.readFileSync(new URL('../../components/settings/PackageDefaultsCard.jsx', import.meta.url), 'utf8');
const couriers = fs.readFileSync(new URL('../../components/settings/CourierSettings.jsx', import.meta.url), 'utf8');

test('Master SKU create and edit send courier weight and dimensions', () => {
  const sends = page.match(/weightKg: Number\([^)]*\) \|\| 0,\s*dimensionsCm: dims\(/g) || [];
  assert.equal(sends.length, 2, 'both create and edit save weight + L/B/H');
  ['Weight (kg)', 'Length (cm)', 'Breadth (cm)', 'Height (cm)'].forEach((label) => {
    assert.ok(page.includes(label), `${label} field is shown`);
  });
});

test('tenant default package is editable and can be applied to all products', () => {
  assert.match(card, /api\.get\('\/settings\/package-defaults'\)/);
  assert.match(card, /api\.patch\('\/settings\/package-defaults'/);
  assert.match(card, /applyToAll/);
  ['Weight (kg)', 'Length (cm)', 'Breadth (cm)', 'Height (cm)'].forEach((label) => {
    assert.ok(card.includes(label), `${label} default is shown`);
  });
  assert.match(couriers, /<PackageDefaultsCard \/>/, 'shown on Courier Settings');
});
