import test from 'node:test';
import assert from 'node:assert/strict';
import { isMyntraHyperlocal } from './myntraHyperlocal.js';

test('Myntra MNOW / SFX_HL AWB is Hyperlocal Order', () => {
  assert.equal(isMyntraHyperlocal({
    channel: 'Myntra',
    awb: 'MYSFXHL1000929078',
    courier: 'Myntra Logistics',
  }), true);
  assert.equal(isMyntraHyperlocal({
    channel: 'Myntra',
    hyperlocal: true,
    awb: '',
  }), true);
  assert.equal(isMyntraHyperlocal({
    channel: 'Myntra',
    channelLines: [{ courierCode: 'SFX_HL', trackingNumber: 'X' }],
  }), true);
  assert.equal(isMyntraHyperlocal({
    channel: 'Myntra',
    awb: 'MYEC123',
    courier: 'Myntra Logistics',
  }), false);
  assert.equal(isMyntraHyperlocal({ channel: 'Shopify', awb: 'MYSFXHL1' }), false);
});
