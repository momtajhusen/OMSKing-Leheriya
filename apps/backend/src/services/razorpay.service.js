const crypto = require('crypto');
const { HttpError } = require('../utils/httpError');

function safeEqual(expected, actual) {
  const left = Buffer.from(String(expected));
  const right = Buffer.from(String(actual || ''));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function verifyCheckoutSignature(orderId, paymentId, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

function verifyWebhookSignature(rawBody, signature, secret) {
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(expected, signature);
}

async function razorpayJson(url, { keyId, keySecret, method = 'GET', body, fetchImpl = fetch }) {
  const res = await fetchImpl(url, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, json?.error?.description || 'UPI checkout could not reach Razorpay');
  return json;
}

async function createRazorpayOrder({ keyId, keySecret, amountPaise, receipt, notes, fetchImpl }) {
  return razorpayJson('https://api.razorpay.com/v1/orders', {
    keyId,
    keySecret,
    method: 'POST',
    fetchImpl,
    body: { amount: amountPaise, currency: 'INR', receipt, notes, payment_capture: 1 },
  });
}

async function fetchRazorpayPayment({ keyId, keySecret, paymentId, fetchImpl }) {
  return razorpayJson(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    keyId,
    keySecret,
    fetchImpl,
  });
}

module.exports = {
  verifyCheckoutSignature,
  verifyWebhookSignature,
  createRazorpayOrder,
  fetchRazorpayPayment,
};
