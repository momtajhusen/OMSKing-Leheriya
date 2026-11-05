import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentModeOf, prepaidLabelledCod } from './labelPayment.js';

test('payment mode shows COD or Prepaid', () => {
  assert.equal(paymentModeOf({ paymentMode: 'COD' }), 'COD');
  assert.equal(paymentModeOf({ paymentMode: 'Cash on Delivery' }), 'COD');
  assert.equal(paymentModeOf({ paymentMode: 'Prepaid' }), 'Prepaid');
  assert.equal(paymentModeOf({ paymentMode: 'Razorpay' }), 'Prepaid');
  assert.equal(paymentModeOf({ paymentMode: 'Void' }), 'Void');
  assert.equal(paymentModeOf({}), '');
});

test('only a Prepaid order whose courier label came back COD is flagged', () => {
  assert.equal(prepaidLabelledCod({ paymentMode: 'Prepaid', labelPaymentMode: 'COD' }), true);
  assert.equal(prepaidLabelledCod({ paymentMode: 'Prepaid', labelPaymentMode: 'Prepaid' }), false);
  assert.equal(prepaidLabelledCod({ paymentMode: 'Prepaid', labelPaymentMode: '' }), false);
  assert.equal(prepaidLabelledCod({ paymentMode: 'COD', labelPaymentMode: 'COD' }), false);
  assert.equal(prepaidLabelledCod({ paymentMode: 'Void', labelPaymentMode: 'COD' }), false);
});
