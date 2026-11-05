import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  groupLinks, linkableWarehouses, channelsForType, linkCount, deleteSummary, shipWarehouseTag, backupFileName, historyTime,
} from './channelWarehouse.js';

const channels = [{ id: 'shopify', name: 'Shopify' }, { id: 'myntra', name: 'Myntra' }, { id: 'newmart', name: 'NewMart' }];
const warehouses = [
  { id: 'w1', code: 'WH-001', type: 'physical', status: 'active' },
  { id: 'w2', code: 'WH-002', type: 'virtual', status: 'active' },
  { id: 'w3', code: 'WH-003', type: 'physical', status: 'inactive' },
  { id: 'w4', code: 'WH-004', type: 'physical', status: 'active' },
];
const links = [
  { id: 'l1', channel: 'myntra', warehouseId: 'w4', warehouseCode: 'WH-004', isPrimaryForChannel: false },
  { id: 'l2', channel: 'myntra', warehouseId: 'w1', warehouseCode: 'WH-001', isPrimaryForChannel: true },
];

test('every channel shows, even a new one with no links, and the main warehouse comes first', () => {
  const grouped = groupLinks(channels, links);
  assert.deepEqual(grouped.map((row) => row.id), ['shopify', 'myntra', 'newmart']);
  assert.deepEqual(grouped[1].links.map((row) => row.warehouseCode), ['WH-001', 'WH-004']);
  assert.equal(grouped[2].links.length, 0);
});

test('link choices skip linked, inactive, and virtual-for-non-Shopify warehouses', () => {
  assert.deepEqual(linkableWarehouses(warehouses, links, 'myntra').map((wh) => wh.code), []);
  assert.deepEqual(linkableWarehouses(warehouses, links, 'shopify').map((wh) => wh.code), ['WH-001', 'WH-002', 'WH-004']);
  assert.deepEqual(linkableWarehouses(warehouses, links, 'newmart').map((wh) => wh.code), ['WH-001', 'WH-004']);
  assert.deepEqual(channelsForType(channels, 'virtual').map((row) => row.id), ['shopify']);
  assert.equal(linkCount(links, 'w1'), 1);
});

test('delete confirmation: blocked, warned, or clean', () => {
  assert.equal(deleteSummary({ warehouse: { code: 'WH-004' }, canDelete: false, blockers: ['3 products still have stock here.'] }).tone, 'block');
  const warn = deleteSummary({ warehouse: { code: 'WH-004' }, canDelete: true, blockers: [], warnings: ['Its 1 channel link (Myntra) will be removed.'] });
  assert.equal(warn.tone, 'warn');
  assert.equal(warn.confirmLabel, 'Delete WH-004');
  assert.equal(deleteSummary({ warehouse: { code: 'WH-009' }, canDelete: true, warnings: [] }).tone, 'ok');
});

test('order "ships from" tag, backup file name and history time', () => {
  assert.equal(shipWarehouseTag({}), null);
  const tag = shipWarehouseTag({ shipWarehouse: { code: 'WH-020', name: 'Delhi', source: 'channel location' } });
  assert.equal(tag.code, 'WH-020');
  assert.match(tag.title, /Ships from WH-020 · Delhi \(matched the channel location id\)/);
  assert.equal(backupFileName('csv', new Date('2026-11-26T10:00:00Z')), 'channel-warehouse-2026-11-26.csv');
  assert.equal(backupFileName('json', new Date('2026-11-26T10:00:00Z')), 'channel-warehouse-2026-11-26.json');
  assert.equal(historyTime('not a date'), '—');
  const settings = fs.readFileSync(new URL('../components/settings/ChannelWarehouseSettings.jsx', import.meta.url), 'utf8');
  assert.match(settings, /\/warehouses\/links\/history/);
  assert.match(settings, /\/warehouses\/links\/export/);
  for (const file of ['../pages/admin/OrdersPage.jsx', '../pages/admin/OrderDetailPage.jsx']) {
    assert.match(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), /shipWarehouseTag\(order\)/);
  }
});

test('warehouse page does not swap itself for a full-page loader on reload, and its buttons do not lift on hover', () => {
  const page = fs.readFileSync(new URL('../pages/admin/WarehousesPage.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /if \(loading\) return <PageLoader/);
  assert.match(page, /hover:translate-y-0/);
  assert.match(page, /DeleteWarehouseDialog/);
  const settings = fs.readFileSync(new URL('../pages/admin/SettingsPage.jsx', import.meta.url), 'utf8');
  assert.match(settings, /id: 'links'/);
  assert.match(settings, /ChannelWarehouseSettings/);
  const layout = fs.readFileSync(new URL('../components/layout/AdminLayout.jsx', import.meta.url), 'utf8');
  assert.match(layout, /useState\(\(\) => readBillCache\(cacheKey\)\)/, 'the bill notice paints from cache instead of pushing the page down after load');
});
