import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isCancelled, netSales } from './orderMetrics.js';

describe('dashboard net sales', () => {
  it('excludes cancelled orders from the total', () => {
    const orders = [
      { status: 'New', total: 100, items: [{ sku: 'KURTA', qty: 1 }] },
      { status: 'Cancelled', total: 500, items: [{ sku: 'SAREE', qty: 2 }] },
      { status: 'Delivered', total: 40, items: [{ sku: 'KURTA', qty: 1 }] },
    ];
    assert.equal(isCancelled(orders[1]), true);
    assert.equal(netSales(orders), 140);
  });
});
