const { apiModeOf } = require('../../apiMode');
const { gatedRequest } = require('../../liveGate');
const { httpsCall, accessToken, lwaDetail } = require('../../amazon');

const LIVE_HOST = 'https://sellingpartnerapi-eu.amazon.com';
const SANDBOX_HOST = 'https://sandbox.sellingpartnerapi-eu.amazon.com';
const SHIPPING = '/shipping/v2';
const BUSINESS_ID = 'AmazonShipping_IN';
const LABEL_SIZE = { width: 4, length: 6, unit: 'INCH' };

function host(creds) {
  return apiModeOf(creds) === 'sandbox' ? SANDBOX_HOST : LIVE_HOST;
}

function refuse(message) {
  const err = new Error(message);
  err.statusCode = 400;
  err.terminal = true;
  return err;
}

function assertCreds(creds) {
  const missing = [
    ['clientId', 'client id'],
    ['clientSecret', 'client secret'],
    ['refreshToken', 'refresh token'],
  ].filter(([key]) => !String(creds?.[key] || '').trim()).map(([, label]) => label);
  if (missing.length) throw refuse(`Amazon Shipping was not called. The ${missing.join(', ')} is missing in Settings › Couriers.`);
}

const ROLE_HINT = 'Add the Amazon Logistics role to this SP-API app (Direct-to-Consumer Shipping is not needed for Shopify or website orders), authorize the app again and paste the new refresh token in Settings › Couriers › Amazon Shipping. Also check the Amazon Shipping account is active with a rate card. Nothing was booked.';

function shippingError(what, res) {
  const detail = lwaDetail(res.text);
  const message = res.status === 403
    ? `Amazon Shipping ${what} returned 403.${detail ? ` ${detail}` : ''} ${ROLE_HINT}`
    : `Amazon Shipping ${what} returned ${res.status}. ${detail || 'Nothing was booked.'}`;
  const err = new Error(message);
  err.statusCode = [400, 401, 403, 404].includes(res.status) ? 400 : 502;
  err.terminal = err.statusCode === 400;
  return err;
}

/** One Amazon token for one batch of Shipping v2 calls; nothing runs unless the courier names its environment. */
async function session(creds, opts = {}) {
  assertCreds(creds);
  const request = gatedRequest(creds, opts.request, httpsCall, { allowSandbox: true });
  const token = await accessToken({
    refreshToken: creds.refreshToken,
    lwaClientId: creds.clientId,
    lwaClientSecret: creds.clientSecret,
  }, request);
  return async (what, method, path, body) => {
    const res = await request(method, `${host(creds)}${SHIPPING}${path}`, {
      headers: {
        'x-amz-access-token': token,
        'x-amzn-shipping-business-id': BUSINESS_ID,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status < 200 || res.status >= 300) throw shippingError(what, res);
    try { return JSON.parse(res.text || '{}').payload || {}; } catch { return {}; }
  };
}

function address({ name, line1, city, state, pincode, phone, email }) {
  return {
    name: String(name || 'Customer').slice(0, 50),
    addressLine1: String(line1 || '').slice(0, 60),
    city: String(city || ''),
    stateOrRegion: String(state || ''),
    postalCode: String(pincode || ''),
    countryCode: 'IN',
    phoneNumber: String(phone || ''),
    ...(email ? { email } : {}),
  };
}

function inr(value) {
  return { value: Math.round((Number(value) || 0) * 100) / 100, unit: 'INR' };
}

function cheapest(rates) {
  return [...rates].sort((a, b) => (Number(a.totalCharge?.value) || 0) - (Number(b.totalCharge?.value) || 0))[0];
}

/** Rates for one parcel, then buys the cheapest; returns the AWB, Amazon shipment id and label PDF. */
async function book(creds, shipment, opts = {}) {
  assertCreds(creds);
  if (!(shipment.weightGrams > 0 && shipment.lengthCm > 0 && shipment.breadthCm > 0 && shipment.heightCm > 0)) {
    throw refuse('Package weight and size are missing for this order. Set them on the order items or in Settings › Package defaults. Amazon Shipping was not called.');
  }
  const call = await session(creds, opts);
  const cod = shipment.paymentMode === 'COD';
  const quantity = Math.max(1, Number(shipment.quantity) || 1);
  const quote = await call('rates', 'POST', '/shipments/rates', {
    shipFrom: address(shipment.pickup || {}),
    shipTo: address({
      name: shipment.name,
      line1: shipment.address,
      city: shipment.city,
      state: shipment.state,
      pincode: shipment.pincode,
      phone: shipment.phone,
      email: shipment.email,
    }),
    packages: [{
      dimensions: { length: shipment.lengthCm, width: shipment.breadthCm, height: shipment.heightCm, unit: 'CENTIMETER' },
      weight: { unit: 'GRAM', value: shipment.weightGrams },
      insuredValue: inr(shipment.amount),
      packageClientReferenceId: shipment.orderNo,
      items: [{
        itemValue: inr(shipment.amount),
        description: String(shipment.description || shipment.orderNo).slice(0, 200),
        quantity,
        weight: { unit: 'GRAM', value: shipment.weightGrams },
      }],
    }],
    channelDetails: { channelType: 'EXTERNAL' },
    ...(cod ? { valueAddedServices: { collectOnDelivery: { amount: inr(shipment.codAmount ?? shipment.amount) } } } : {}),
  });
  const rate = cheapest((quote.rates || []).filter((row) => row?.rateId));
  if (!quote.requestToken || !rate) throw refuse('Amazon Shipping has no service for this pincode and parcel. Nothing was booked.');
  const size = rate.supportedDocumentSpecifications?.find((spec) => spec.format === 'PDF')?.size || LABEL_SIZE;
  const bought = await call('purchase', 'POST', '/shipments', {
    requestToken: quote.requestToken,
    rateId: rate.rateId,
    requestedDocumentSpecification: { format: 'PDF', size, needFileJoining: false, requestedDocumentTypes: ['LABEL'] },
  });
  const pkg = (bought.packageDocumentDetails || [])[0] || {};
  const awb = String(pkg.trackingId || '').trim();
  if (!bought.shipmentId || !awb) {
    const err = new Error('Amazon Shipping bought the label but sent no tracking id. Check the Amazon Shipping account before booking again.');
    err.statusCode = 502;
    throw err;
  }
  const doc = (pkg.packageDocuments || []).find((row) => row.type === 'LABEL' && row.contents);
  return {
    awb,
    shipmentId: String(bought.shipmentId),
    carrierId: String(rate.carrierId || ''),
    paymentMode: cod ? 'COD' : 'Prepaid',
    labelPdf: doc ? Buffer.from(doc.contents, 'base64') : null,
  };
}

async function cancel(creds, shipmentId, opts = {}) {
  const call = await session(creds, opts);
  await call('cancel', 'PUT', `/shipments/${encodeURIComponent(shipmentId)}/cancel`);
  return { cancelled: true };
}

const SCAN_STATUS = {
  PickupDone: 'picked_up',
  ArrivedAtCarrierFacility: 'in_transit',
  Departed: 'in_transit',
  OutForDelivery: 'out_for_delivery',
  Delivered: 'delivered',
  DeliveryAttempted: 'ndr',
  Undeliverable: 'ndr',
  ReturnInitiated: 'rto',
  Rejected: 'rto',
};

const SUMMARY_STATUS = {
  InTransit: 'in_transit',
  OutForDelivery: 'out_for_delivery',
  Delivered: 'delivered',
  DeliveryAttempted: 'ndr',
  Undeliverable: 'ndr',
  Rejected: 'rto',
};

/** Amazon Shipping scans in the same { status, detail, eventKey } shape the tracking service takes from Delhivery. */
async function track(creds, { trackingId, carrierId }, opts = {}) {
  const call = await session(creds, opts);
  const qs = new URLSearchParams({ trackingId, carrierId });
  const payload = await call('tracking', 'GET', `/tracking?${qs}`);
  const summary = String(payload.summary?.status || '');
  const events = (payload.eventHistory || []).map((row) => {
    const status = SCAN_STATUS[row.eventCode];
    if (!status) return null;
    return { status, detail: String(row.eventCode), eventKey: `${trackingId}:${row.eventTime || row.eventCode}:${status}` };
  }).filter(Boolean);
  if (!events.length && SUMMARY_STATUS[summary]) {
    events.push({ status: SUMMARY_STATUS[summary], detail: summary, eventKey: `${trackingId}:${SUMMARY_STATUS[summary]}:current` });
  }
  return { status: summary, events };
}

module.exports = { book, cancel, track, host };
