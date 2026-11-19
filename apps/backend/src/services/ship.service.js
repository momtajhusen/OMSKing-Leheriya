const Order = require('../models/Order');
const Shipment = require('../models/Shipment');
const Warehouse = require('../models/Warehouse');
const InventoryReservation = require('../models/InventoryReservation');
const { HttpError } = require('../utils/httpError');
const { getConnection, credsOf } = require('./channelConnection.service');
const { releaseReservation } = require('./inventory.service');
const { enqueue } = require('./jobQueue.service');
const { bookPaymentMode } = require('./orderDesk.service');
const { codCollectAmount } = require('../utils/payment');
const { orderPackage } = require('./packageDefaults.service');
const delhivery = require('../adapters/couriers/delhivery');
const amazonShipping = require('../adapters/couriers/amazonShipping');
const bluedart = require('../adapters/couriers/bluedart');
const maruti = require('../adapters/couriers/maruti');
const shopify = require('../adapters/shopify');
const myntra = require('../adapters/myntra');
const { amazonEasyShipLabel } = require('./amazonLabel.service');

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

function pinOf(order) {
  const match = `${order.city || ''} ${order.address || ''}`.match(/\b(\d{6})\b/);
  return match ? match[1] : '';
}

function cityOf(order) {
  return String(order.city || '').replace(/\b\d{6}\b/, '').replace(/,/g, ' ').trim() || 'City';
}

async function delhiveryCreds(tenantId) {
  const { activeCourierCreds } = require('./courierAccount.service');
  return activeCourierCreds(tenantId, 'delhivery');
}

/** Setup seed used "123 Fashion Street" — never send that on a live courier label. */
function isPlaceholderPickup(line1) {
  return /123\s*fashion\s*street/i.test(String(line1 || '').trim());
}

function legalPickupFrom(tenant) {
  const legal = tenant?.legalEntity || {};
  const line1 = String(legal.address || '').trim();
  if (!line1) return null;
  const district = String(legal.district || '');
  const pinMatch = `${district} ${legal.city || ''}`.match(/\b(\d{6})\b/);
  const city = String(legal.city || '').replace(/\s*-\s*\d{6}.*$/, '').trim();
  const phone = String(legal.phone || '').replace(/\s+/g, '');
  return {
    line1,
    city: city || 'New Delhi',
    state: 'Delhi',
    pincode: pinMatch ? pinMatch[1] : '',
    phone,
    name: String(legal.legalName || tenant.name || '').trim(),
  };
}

async function pickupWarehouse(tenantId) {
  const row = await skip(Warehouse.findOne({ tenantId, code: 'WH-001', status: 'active' }));
  if (!row) {
    const err = new HttpError(400, 'WH-001 is missing. Delhivery pickup was not booked.');
    err.terminal = true;
    throw err;
  }
  let line1 = String(row.address?.line1 || '').trim();
  let city = String(row.address?.city || '').trim();
  let state = String(row.address?.state || '').trim();
  let pincode = String(row.address?.pincode || '').trim();
  let phone = String(row.contactPhone || '').trim();
  let name = String(row.name || '').trim();

  if (isPlaceholderPickup(line1)) {
    const Tenant = require('../models/Tenant');
    const tenant = await skip(Tenant.findById(tenantId).select('name legalEntity'));
    const legal = legalPickupFrom(tenant);
    if (legal?.line1) {
      line1 = legal.line1;
      city = legal.city || city;
      state = legal.state || state;
      if (/^\d{6}$/.test(legal.pincode)) pincode = legal.pincode;
      if (legal.phone) phone = legal.phone;
      if (legal.name) name = legal.name;
    }
  }

  const address = [line1, city, pincode].filter(Boolean).join(', ');
  if (!line1 || !pincode || !phone) {
    const err = new HttpError(400, 'WH-001 needs a street address, pincode, and phone before an AWB is booked.');
    err.terminal = true;
    throw err;
  }
  return {
    address,
    phone,
    name,
    line1,
    city,
    state,
    pincode,
  };
}

async function saveShipment(doc) {
  return Shipment.create(doc);
}

/** AWB/label already booked — Shopify tracking is best-effort so Generate Label still finishes. */
async function pushShopifyTracking(shopCreds, opts) {
  try {
    return await shopify.fulfillOrder(shopCreds, opts);
  } catch {
    return { fulfillmentId: '' };
  }
}

const BOOKING_LOCK_MS = 2 * 60 * 1000;
const NO_LABEL_STATUS = ['Cancelled', 'Delivered'];
const OPEN_STATUS = ['New', 'Processing', 'Pending', 'Packed', 'Ready to Ship'];
const LEFT_STATUS = /^(shipped|in transit|out for delivery|delivered)$/i;
const MOVED_SCANS = ['picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'rto', 'ndr'];

/** One label booking per order at a time; the courier is never called twice for the same order. */
async function withBookingLock(tenantId, orderNo, fn) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (NO_LABEL_STATUS.includes(order.status)) {
    // Allow one more Generate Label click to stamp a booked AWB that never reached the order row.
    const orphan = await skip(Shipment.findOne({ tenantId, orderNo, status: 'booked' }));
    if (!orphan?.awb || String(order.awb || '').trim()) {
      const err = new HttpError(400, `This order is ${order.status}. No label was booked.`);
      err.terminal = true;
      throw err;
    }
  }
  const now = new Date();
  const claim = await skip(Order.updateOne(
    { _id: order._id, tenantId, $or: [{ bookingAt: null }, { bookingAt: { $lt: new Date(now.getTime() - BOOKING_LOCK_MS) } }] },
    { $set: { bookingAt: now } },
  ));
  if (!claim.modifiedCount) throw new HttpError(409, 'A label is already being booked for this order. Try again in a minute.');
  try {
    return await fn();
  } finally {
    await skip(Order.updateOne({ _id: order._id, tenantId, bookingAt: now }, { $set: { bookingAt: null } }));
  }
}

function leftWarehouse(order) {
  return Boolean(order.pickedUpAt) || LEFT_STATUS.test(order.status || '');
}

/** Manual status changes may not undo a booked label or a parcel that already left. */
async function assertStatusChange(tenantId, order, status) {
  if (status === order.status || !(OPEN_STATUS.includes(status) || status === 'Cancelled')) return;
  if (leftWarehouse(order)) {
    throw new HttpError(400, `This order already left the warehouse, so it cannot be set to ${status}. Use RTO or a return instead.`);
  }
  const booked = await skip(Shipment.findOne({ tenantId, orderNo: order.orderNo, status: 'booked' }));
  if (booked) throw new HttpError(400, `This order has a booked AWB ${booked.awb}. Cancel the label first.`);
}

async function bookShopify(tenantId, orderNo, deps = {}) {
  return withBookingLock(tenantId, orderNo, () => bookShopifyNow(tenantId, orderNo, deps));
}

async function bookShopifyNow(tenantId, orderNo, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (String(order.channel).toLowerCase() !== 'shopify') {
    const err = new HttpError(400, `${order.channel} uses the marketplace courier. Delhivery was not called.`);
    err.terminal = true;
    throw err;
  }
  const existing = await skip(Shipment.findOne({ tenantId, orderNo, status: 'booked' }));
  if (existing && existing.courier && existing.courier !== 'delhivery') {
    const who = existing.courier === 'bluedart' ? 'Blue Dart'
      : existing.courier === 'shree-maruti' ? 'Shree Maruti'
        : existing.courier === 'amazon-shipping' ? 'Amazon Shipping'
          : existing.courier;
    throw new HttpError(400, `This order already has a booked ${who} AWB ${existing.awb}. Cancel it first.`);
  }

  /** Put AWB on the order as soon as Delhivery books — packing slip / Shopify must not hide it. */
  async function stampDelhiveryOrder(ship) {
    order.awb = ship.awb;
    order.courier = 'Delhivery';
    if (!NO_LABEL_STATUS.includes(order.status)) order.status = 'Dispatched';
    order.labelGeneratedAt = order.labelGeneratedAt || ship.bookedAt || new Date();
    await order.save();
  }

  // AWB already booked earlier (label PDF or Shopify fulfill may have failed) — show it and finish.
  if (existing?.awb) {
    if (order.awb !== existing.awb || !order.labelGeneratedAt) await stampDelhiveryOrder(existing);
    // Fully done: do not call Delhivery again. Missing packing slip still retries labelPdf below.
    if (existing.shopifyFulfillmentId && existing.labelPdf) return existing;
  }

  const creds = deps.delhiveryCreds || await delhiveryCreds(tenantId);
  const shopCreds = deps.shopifyCreds || await require('./shopifyAuth.service').shopifyCreds(tenantId);
  if (!shopify.hasShopifyAuth(shopCreds)) {
    const err = new HttpError(400, 'Shopify shop URL and admin token are missing. Delhivery was not called.');
    err.terminal = true;
    throw err;
  }
  const pay = bookPaymentMode(order.paymentMode);
  if (pay === 'Void') {
    const err = new HttpError(400, 'This payment is Void. Delhivery was not called, and it is not booked as COD.');
    err.terminal = true;
    throw err;
  }
  const request = deps.delhiveryRequest;
  let shipment = existing;
  if (!shipment?.awb) {
    const pickup = await pickupWarehouse(tenantId);
    const pincode = pinOf(order);
    if (!/^\d{6}$/.test(pincode)) {
      const err = new HttpError(400, 'This order has no 6-digit delivery pincode, so Delhivery was not called.');
      err.terminal = true;
      throw err;
    }
    await delhivery.serviceable(creds, { pincode, paymentMode: pay, request });
    const pack = await orderPackage(tenantId, order.items || []);
    const booked = await delhivery.book(creds, {
      ...pack,
      name: order.customer || 'Customer',
      address: order.address || order.city,
      pincode,
      city: cityOf(order),
      state: '',
      phone: order.phone || pickup.phone,
      orderNo: order.orderNo,
      paymentMode: pay,
      description: (order.items || []).map((item) => item.name || item.sku).filter(Boolean).join(', ') || order.orderNo,
      quantity: (order.items || []).reduce((sum, item) => sum + (Number(item.qty) || 1), 0) || 1,
      amount: order.total || 0,
      codAmount: pay === 'COD' ? codCollectAmount(order) : 0,
      pickupAddress: pickup.address,
    }, { request });
    order.labelPaymentMode = booked.paymentMode || pay;
    shipment = await saveShipment({
      tenantId,
      orderNo: order.orderNo,
      channel: 'shopify',
      courier: 'delhivery',
      awb: booked.awb,
      status: 'booked',
      warehouseCode: 'WH-001',
      labelPdf: null,
      bookedAt: new Date(),
    });
    // Stamp before packing-slip / Shopify so a later failure still shows AWB on the order.
    await stampDelhiveryOrder(shipment);
  }
  if (!order.labelPaymentMode) order.labelPaymentMode = pay;
  if (!shipment.labelPdf) {
    try {
      shipment.labelPdf = await delhivery.labelPdf(creds, shipment.awb, { request });
      await shipment.save();
    } catch {
      /* packing slip is best-effort; AWB stays on the order */
    }
  }
  const fulfilled = await pushShopifyTracking(shopCreds, {
    orderId: order.externalOrderId || order.orderNo,
    trackingNumber: shipment.awb,
    request: deps.shopifyRequest,
  });
  if (fulfilled?.fulfillmentId) {
    shipment.shopifyFulfillmentId = fulfilled.fulfillmentId;
    await shipment.save();
  }
  await stampDelhiveryOrder(shipment);
  return shipment;
}

async function bookOtherCourier(tenantId, orderNo, input = {}, deps = {}) {
  return withBookingLock(tenantId, orderNo, () => bookOtherCourierNow(tenantId, orderNo, input, deps));
}

async function bookOtherCourierNow(tenantId, orderNo, { courier, awb } = {}, deps = {}) {
  const CourierAccount = require('../models/CourierAccount');
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  if (String(order.channel).toLowerCase() !== 'shopify') {
    throw new HttpError(400, `${order.channel} uses the marketplace courier.`);
  }
  const code = String(courier || '').trim();
  const account = await skip(CourierAccount.findOne({ tenantId, code, status: 'active' }));
  if (!account || /^delhivery/.test(code)) throw new HttpError(400, 'This courier is not enabled for this company.');
  if (code === AMAZON_SHIPPING) return bookAmazonShippingNow(tenantId, order, account, deps);
  if (code === BLUE_DART && bluedartApiReady(account, deps)) return bookBluedartNow(tenantId, order, account, deps);
  if (code === SHREE_MARUTI && marutiApiReady(account, deps)) return bookMarutiNow(tenantId, order, account, deps);
  const tracking = String(awb || '').trim();
  if (!tracking) throw new HttpError(400, `Enter the ${account.name} AWB from the courier portal.`);
  const pay = bookPaymentMode(order.paymentMode);
  if (pay === 'Void') throw new HttpError(400, 'This payment is Void. It is not booked as COD.');
  if (await skip(Shipment.findOne({ tenantId, orderNo, status: 'booked' }))) {
    throw new HttpError(400, 'This order already has a booked AWB. Cancel it first.');
  }
  const reused = await skip(Shipment.findOne({ tenantId, awb: tracking, status: 'booked', orderNo: { $ne: order.orderNo } }));
  if (reused) throw new HttpError(400, `AWB ${tracking} is already used on order ${reused.orderNo}.`);
  const shopCreds = deps.shopifyCreds || await require('./shopifyAuth.service').shopifyCreds(tenantId);
  if (!shopify.hasShopifyAuth(shopCreds)) throw new HttpError(400, 'Shopify shop URL and admin token are missing.');
  const fulfilled = await pushShopifyTracking(shopCreds, {
    orderId: order.externalOrderId || order.orderNo,
    trackingNumber: tracking,
    company: account.name,
    request: deps.shopifyRequest,
  });
  const shipment = await saveShipment({
    tenantId,
    orderNo: order.orderNo,
    channel: 'shopify',
    courier: account.code,
    awb: tracking,
    status: 'booked',
    warehouseCode: 'WH-001',
    shopifyFulfillmentId: fulfilled.fulfillmentId,
    bookedAt: new Date(),
  });
  order.awb = tracking;
  order.courier = account.name;
  order.labelPaymentMode = pay;
  order.status = 'Dispatched';
  order.labelGeneratedAt = new Date();
  await order.save();
  return shipment;
}

const AMAZON_SHIPPING = 'amazon-shipping';
const BLUE_DART = 'bluedart';
const SHREE_MARUTI = 'shree-maruti';

function amazonShippingCreds(account, deps) {
  if (deps.amazonShippingCreds) return deps.amazonShippingCreds;
  if (!account) throw new HttpError(400, 'Amazon Shipping is not set up in Settings › Couriers. Amazon was not called.');
  const { decryptObject } = require('../lib/secretBox');
  return decryptObject(account.credentialsEnc);
}

function bluedartCreds(account, deps) {
  if (deps.bluedartCreds) return deps.bluedartCreds;
  if (!account) throw new HttpError(400, 'Bluedart is not set up in Settings › Couriers. Blue Dart was not called.');
  const { decryptObject } = require('../lib/secretBox');
  return decryptObject(account.credentialsEnc);
}

/** Own Bluedart with gateway + profile secrets books by API; platform or incomplete credentials stay on typed AWB. */
function bluedartApiReady(account, deps = {}) {
  if (deps.bluedartCreds) return true;
  if (!account || account.source !== 'own' || !account.credentialsEnc) return false;
  const creds = bluedartCreds(account, {});
  return Boolean(
    String(creds.clientId || '').trim()
    && String(creds.clientSecret || '').trim()
    && String(creds.loginId || '').trim()
    && String(creds.licenceKey || '').trim()
    && String(creds.customerCode || '').trim()
    && (String(creds.apiMode || creds.accountMode || '').trim()),
  );
}

function marutiCreds(account, deps) {
  if (deps.marutiCreds) return deps.marutiCreds;
  if (!account) throw new HttpError(400, 'Shree Maruti is not set up in Settings › Couriers. Shree Maruti was not called.');
  const { decryptObject } = require('../lib/secretBox');
  return decryptObject(account.credentialsEnc);
}

/** Own Shree Maruti with Innofulfill secrets books by API; incomplete credentials stay on typed AWB. */
function marutiApiReady(account, deps = {}) {
  if (deps.marutiCreds) return true;
  if (!account || account.source !== 'own' || !account.credentialsEnc) return false;
  const creds = marutiCreds(account, {});
  return Boolean(
    String(creds.email || '').trim()
    && String(creds.password || '').trim()
    && String(creds.apiKey || '').trim()
    && String(creds.userId || '').trim()
    && String(creds.accountTenantId || '').trim()
    && String(creds.apiMode || '').trim(),
  );
}

/** Shree Maruti books by API: one AWB + label PDF per order; a retry after a failed Shopify fulfil reuses the booked AWB. */
async function bookMarutiNow(tenantId, order, account, deps = {}) {
  const pay = bookPaymentMode(order.paymentMode);
  if (pay === 'Void') throw new HttpError(400, 'This payment is Void. Shree Maruti was not called, and it is not booked as COD.');
  let shipment = await skip(Shipment.findOne({ tenantId, orderNo: order.orderNo, status: 'booked' }));
  if (shipment && (shipment.courier !== SHREE_MARUTI || shipment.shopifyFulfillmentId)) {
    throw new HttpError(400, 'This order already has a booked AWB. Cancel it first.');
  }
  const shopCreds = deps.shopifyCreds || await require('./shopifyAuth.service').shopifyCreds(tenantId);
  if (!shopify.hasShopifyAuth(shopCreds)) throw new HttpError(400, 'Shopify shop URL and admin token are missing. Shree Maruti was not called.');
  if (!shipment) {
    const pincode = pinOf(order);
    if (!/^\d{6}$/.test(pincode)) throw new HttpError(400, 'This order has no 6-digit delivery pincode, so Shree Maruti was not called.');
    const pickup = await pickupWarehouse(tenantId);
    const pack = await orderPackage(tenantId, order.items || []);
    const booked = await maruti.book(marutiCreds(account, deps), {
      ...pack,
      name: order.customer || 'Customer',
      address: order.address || order.city,
      city: cityOf(order),
      state: order.shipState || '',
      pincode,
      phone: order.phone || pickup.phone,
      email: order.email,
      orderNo: order.orderNo,
      paymentMode: pay,
      description: (order.items || []).map((item) => item.name || item.sku).filter(Boolean).join(', ') || order.orderNo,
      quantity: (order.items || []).reduce((sum, item) => sum + (Number(item.qty) || 1), 0) || 1,
      amount: order.total || 0,
      codAmount: pay === 'COD' ? codCollectAmount(order) : 0,
      pickup,
    }, { request: deps.marutiRequest });
    shipment = await saveShipment({
      tenantId,
      orderNo: order.orderNo,
      channel: 'shopify',
      courier: SHREE_MARUTI,
      awb: booked.awb,
      status: 'booked',
      warehouseCode: 'WH-001',
      labelPdf: booked.labelPdf,
      channelPackageId: booked.shipmentId,
      bookedAt: new Date(),
    });
  }
  const fulfilled = await pushShopifyTracking(shopCreds, {
    orderId: order.externalOrderId || order.orderNo,
    trackingNumber: shipment.awb,
    company: account.name,
    request: deps.shopifyRequest,
  });
  shipment.shopifyFulfillmentId = fulfilled.fulfillmentId;
  await shipment.save();
  order.awb = shipment.awb;
  order.courier = account.name;
  order.labelPaymentMode = pay;
  order.status = 'Dispatched';
  order.labelGeneratedAt = new Date();
  await order.save();
  return shipment;
}

/** Amazon Shipping books by API: one label per order, and a retry after a failed Shopify fulfil reuses the booked AWB. */
async function bookAmazonShippingNow(tenantId, order, account, deps = {}) {
  const pay = bookPaymentMode(order.paymentMode);
  if (pay === 'Void') throw new HttpError(400, 'This payment is Void. Amazon Shipping was not called, and it is not booked as COD.');
  let shipment = await skip(Shipment.findOne({ tenantId, orderNo: order.orderNo, status: 'booked' }));
  if (shipment && (shipment.courier !== AMAZON_SHIPPING || shipment.shopifyFulfillmentId)) {
    throw new HttpError(400, 'This order already has a booked AWB. Cancel it first.');
  }
  const shopCreds = deps.shopifyCreds || await require('./shopifyAuth.service').shopifyCreds(tenantId);
  if (!shopify.hasShopifyAuth(shopCreds)) throw new HttpError(400, 'Shopify shop URL and admin token are missing. Amazon Shipping was not called.');
  if (!shipment) {
    const pincode = pinOf(order);
    if (!/^\d{6}$/.test(pincode)) throw new HttpError(400, 'This order has no 6-digit delivery pincode, so Amazon Shipping was not called.');
    const pickup = await pickupWarehouse(tenantId);
    const pack = await orderPackage(tenantId, order.items || []);
    const booked = await amazonShipping.book(amazonShippingCreds(account, deps), {
      ...pack,
      name: order.customer || 'Customer',
      address: order.address || order.city,
      city: cityOf(order),
      state: order.shipState || '',
      pincode,
      phone: order.phone || pickup.phone,
      email: order.email,
      orderNo: order.orderNo,
      paymentMode: pay,
      description: (order.items || []).map((item) => item.name || item.sku).filter(Boolean).join(', ') || order.orderNo,
      quantity: (order.items || []).reduce((sum, item) => sum + (Number(item.qty) || 1), 0) || 1,
      amount: order.total || 0,
      codAmount: pay === 'COD' ? codCollectAmount(order) : 0,
      pickup,
    }, { request: deps.amazonShippingRequest });
    shipment = await saveShipment({
      tenantId,
      orderNo: order.orderNo,
      channel: 'shopify',
      courier: AMAZON_SHIPPING,
      awb: booked.awb,
      status: 'booked',
      warehouseCode: 'WH-001',
      labelPdf: booked.labelPdf,
      channelPackageId: booked.shipmentId,
      carrierId: booked.carrierId,
      bookedAt: new Date(),
    });
  }
  const fulfilled = await pushShopifyTracking(shopCreds, {
    orderId: order.externalOrderId || order.orderNo,
    trackingNumber: shipment.awb,
    company: account.name,
    request: deps.shopifyRequest,
  });
  shipment.shopifyFulfillmentId = fulfilled.fulfillmentId;
  await shipment.save();
  order.awb = shipment.awb;
  order.courier = account.name;
  order.labelPaymentMode = pay;
  order.status = 'Dispatched';
  order.labelGeneratedAt = new Date();
  await order.save();
  return shipment;
}

/** Blue Dart books by API: one waybill + label PDF per order; a retry after a failed Shopify fulfil reuses the booked AWB. */
async function bookBluedartNow(tenantId, order, account, deps = {}) {
  const pay = bookPaymentMode(order.paymentMode);
  if (pay === 'Void') throw new HttpError(400, 'This payment is Void. Blue Dart was not called, and it is not booked as COD.');
  let shipment = await skip(Shipment.findOne({ tenantId, orderNo: order.orderNo, status: 'booked' }));
  if (shipment && (shipment.courier !== BLUE_DART || shipment.shopifyFulfillmentId)) {
    throw new HttpError(400, 'This order already has a booked AWB. Cancel it first.');
  }
  const shopCreds = deps.shopifyCreds || await require('./shopifyAuth.service').shopifyCreds(tenantId);
  if (!shopify.hasShopifyAuth(shopCreds)) throw new HttpError(400, 'Shopify shop URL and admin token are missing. Blue Dart was not called.');
  if (!shipment) {
    const pincode = pinOf(order);
    if (!/^\d{6}$/.test(pincode)) throw new HttpError(400, 'This order has no 6-digit delivery pincode, so Blue Dart was not called.');
    const pickup = await pickupWarehouse(tenantId);
    const pack = await orderPackage(tenantId, order.items || []);
    const booked = await bluedart.book(bluedartCreds(account, deps), {
      ...pack,
      name: order.customer || 'Customer',
      address: order.address || order.city,
      city: cityOf(order),
      state: order.shipState || '',
      pincode,
      phone: order.phone || pickup.phone,
      orderNo: order.orderNo,
      paymentMode: pay,
      description: (order.items || []).map((item) => item.name || item.sku).filter(Boolean).join(', ') || order.orderNo,
      quantity: (order.items || []).reduce((sum, item) => sum + (Number(item.qty) || 1), 0) || 1,
      amount: order.total || 0,
      codAmount: pay === 'COD' ? codCollectAmount(order) : 0,
      pickup,
    }, { request: deps.bluedartRequest });
    shipment = await saveShipment({
      tenantId,
      orderNo: order.orderNo,
      channel: 'shopify',
      courier: BLUE_DART,
      awb: booked.awb,
      status: 'booked',
      warehouseCode: 'WH-001',
      labelPdf: booked.labelPdf,
      channelPackageId: booked.shipmentId,
      bookedAt: new Date(),
    });
  }
  const fulfilled = await pushShopifyTracking(shopCreds, {
    orderId: order.externalOrderId || order.orderNo,
    trackingNumber: shipment.awb,
    company: account.name,
    request: deps.shopifyRequest,
  });
  shipment.shopifyFulfillmentId = fulfilled.fulfillmentId;
  await shipment.save();
  order.awb = shipment.awb;
  order.courier = account.name;
  order.labelPaymentMode = pay;
  order.status = 'Dispatched';
  order.labelGeneratedAt = new Date();
  await order.save();
  return shipment;
}

/** The stored courier label PDF of a Shopify order booked by API; no courier is called. */
async function courierLabelPdf(tenantId, orderNo) {
  const shipment = await skip(Shipment.findOne({
    tenantId, orderNo, status: 'booked',
    courier: { $in: ['delhivery', AMAZON_SHIPPING, BLUE_DART, SHREE_MARUTI] },
  }));
  if (!shipment) throw new HttpError(404, 'This order has no courier label PDF yet.');
  if (!shipment.labelPdf) {
    const who = shipment.courier === 'delhivery' ? 'Delhivery'
      : shipment.courier === BLUE_DART ? 'Blue Dart'
        : shipment.courier === SHREE_MARUTI ? 'Shree Maruti'
          : 'Amazon Shipping';
    throw new HttpError(404, `${who} sent no label PDF for this parcel.`);
  }
  return shipment.labelPdf;
}

/** Short Super-Admin desk line: how this courier books and what still blocks API label. */
function courierDeskNote(code, api) {
  if (code === 'delhivery') return 'API books AWB + label from WH-001.';
  if (code === SHREE_MARUTI) {
    return api
      ? 'API books AWB + Innofulfill shipping label PDF.'
      : 'Add Innofulfill email, password, API key, user id and tenant id in Settings › Couriers.';
  }
  if (code === AMAZON_SHIPPING) {
    return api
      ? 'API books Amazon Shipping (sandbox or live from Settings).'
      : 'Add Amazon Shipping LWA client id, secret and refresh token in Settings › Couriers.';
  }
  if (code === BLUE_DART) {
    return api
      ? 'API books AWB + Blue Dart label PDF.'
      : 'Tracking works with Login ID + licence. API book/label needs Apigee Client ID + Client secret in Settings › Couriers. Until then enter AWB from the Blue Dart portal.';
  }
  return api ? 'API booking is on.' : 'Enter the AWB from the courier portal (no API book).';
}

async function bookingCouriers(tenantId) {
  const CourierAccount = require('../models/CourierAccount');
  const rows = await skip(CourierAccount.find({ tenantId, status: 'active' }).sort({ priority: 1, name: 1 }));
  const seen = new Set(['delhivery']);
  const others = rows.filter((row) => !/^delhivery/.test(row.code) && !seen.has(row.code) && seen.add(row.code));
  const delhiveryRow = rows.find((row) => row.code === 'delhivery') || rows.find((row) => /^delhivery/.test(row.code));
  const list = [
    { code: 'delhivery', name: 'Delhivery', api: true, rateHalfKg: Number(delhiveryRow?.rateHalfKg) || 0 },
    ...others.map((row) => ({
      code: row.code,
      name: row.name,
      api: row.code === AMAZON_SHIPPING || bluedartApiReady(row) || marutiApiReady(row),
      rateHalfKg: Number(row.rateHalfKg) || 0,
    })),
  ];
  return list.map((row) => ({
    ...row,
    bookHow: row.api ? 'api' : 'awb',
    note: courierDeskNote(row.code, row.api),
  }));
}

/** Rate-card estimate: rate per 0.5 kg × 0.5 kg slabs of the heavier of actual and volumetric (L×B×H / 5000) weight. */
function rateEstimate(rateHalfKg, pack = {}) {
  const rate = Number(rateHalfKg) || 0;
  const actual = (Number(pack.weightGrams) || 0) / 1000;
  if (!rate || !actual) return null;
  const volumetric = ((Number(pack.lengthCm) || 0) * (Number(pack.breadthCm) || 0) * (Number(pack.heightCm) || 0)) / 5000;
  const chargeableKg = Math.round(Math.max(actual, volumetric) * 1000) / 1000;
  const slabs = Math.max(1, Math.ceil(chargeableKg / 0.5));
  return { chargeableKg, slabs, amount: slabs * rate };
}

/** Enabled couriers for this order with their rate-card estimate; no courier API is called. */
async function courierRates(tenantId, orderNo) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  const pack = await orderPackage(tenantId, order.items || []);
  const couriers = await bookingCouriers(tenantId);
  return {
    package: pack.weightGrams ? pack : null,
    couriers: couriers.map((courier) => ({ ...courier, estimate: rateEstimate(courier.rateHalfKg, pack) })),
  };
}

async function cancelShopifyLabel(tenantId, orderNo, { releaseReserve = false, deps = {} } = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  const shipment = await skip(Shipment.findOne({
    tenantId, orderNo, status: 'booked', courier: { $in: ['delhivery', AMAZON_SHIPPING, BLUE_DART, SHREE_MARUTI] },
  }));
  if (!shipment) throw new HttpError(400, 'This order has no Delhivery, Amazon Shipping, Blue Dart, or Shree Maruti AWB to cancel.');
  if (leftWarehouse(order) || MOVED_SCANS.includes(shipment.deliveryStatus)) {
    throw new HttpError(400, 'The courier already picked this parcel up, so the label cannot be cancelled. Mark it RTO instead.');
  }
  if (!shipment.courierCancelledAt) {
    if (shipment.courier === AMAZON_SHIPPING) {
      const CourierAccount = require('../models/CourierAccount');
      const account = deps.amazonShippingCreds ? null : await skip(CourierAccount.findOne({ tenantId, code: AMAZON_SHIPPING }));
      await amazonShipping.cancel(amazonShippingCreds(account, deps), shipment.channelPackageId, { request: deps.amazonShippingRequest });
    } else if (shipment.courier === BLUE_DART) {
      const CourierAccount = require('../models/CourierAccount');
      const account = deps.bluedartCreds ? null : await skip(CourierAccount.findOne({ tenantId, code: BLUE_DART, status: 'active' }));
      await bluedart.cancel(bluedartCreds(account, deps), shipment.awb, { request: deps.bluedartRequest });
    } else if (shipment.courier === SHREE_MARUTI) {
      const CourierAccount = require('../models/CourierAccount');
      const account = deps.marutiCreds ? null : await skip(CourierAccount.findOne({ tenantId, code: SHREE_MARUTI, status: 'active' }));
      await maruti.cancel(marutiCreds(account, deps), { awb: shipment.awb, shipmentId: shipment.channelPackageId }, { request: deps.marutiRequest });
    } else {
      const creds = deps.delhiveryCreds || await delhiveryCreds(tenantId);
      await delhivery.cancelAwb(creds, shipment.awb, { request: deps.delhiveryRequest });
    }
    shipment.courierCancelledAt = new Date();
    await shipment.save();
  }
  if (shipment.shopifyFulfillmentId) {
    const shopCreds = deps.shopifyCreds || await require('./shopifyAuth.service').shopifyCreds(tenantId);
    await shopify.cancelFulfillment(shopCreds, {
      fulfillmentId: shipment.shopifyFulfillmentId,
      request: deps.shopifyRequest,
    });
  }
  shipment.status = 'cancelled';
  shipment.cancelledAt = new Date();
  if (releaseReserve) {
    await releaseHeld(tenantId, order);
    shipment.reserveReleased = true;
  }
  await shipment.save();
  order.awb = '';
  order.labelGeneratedAt = null;
  order.handoverAt = null;
  order.manifestNo = '';
  order.pickedUpAt = null;
  order.status = 'New';
  await order.save();
  return shipment;
}

async function releaseHeld(tenantId, order) {
  const refs = [order.orderNo, ...(order.subOrders || []).map((sub) => sub.id), ...(order.subOrders || []).map((sub) => `${order.orderNo}:${sub.id}`)];
  const holds = await skip(InventoryReservation.find({ tenantId, status: 'held', orderRef: { $in: refs } }));
  for (const hold of holds) {
    await releaseReservation(tenantId, null, { idempotencyKey: hold.idempotencyKey, reason: 'Order cancelled with the label' });
  }
}

async function bookMarketplace(tenantId, orderNo, deps = {}) {
  return withBookingLock(tenantId, orderNo, () => bookMarketplaceNow(tenantId, orderNo, deps));
}

async function bookMarketplaceNow(tenantId, orderNo, deps = {}) {
  const order = await skip(Order.findOne({ tenantId, orderNo }));
  if (!order) throw new HttpError(404, 'Order not found');
  const channel = String(order.channel || '').toLowerCase();
  if (channel === 'shopify') {
    const err = new HttpError(400, 'Shopify ships on Delhivery. The marketplace ship API was not called.');
    err.terminal = true;
    throw err;
  }
  if (channel === 'amazon') return amazonEasyShipLabel(tenantId, orderNo, deps);
  const existing = await skip(Shipment.findOne({ tenantId, orderNo, status: 'booked' }));
  if (existing) return existing;
  let shipped;
  if (channel === 'myntra') {
    const creds = deps.myntraCreds || credsOf(await getConnection(tenantId, 'myntra'));
    const line = (order.channelLines || [])[0] || {};
    shipped = await myntra.shipOrder(creds, {
      sellerOrderId: line.sellerOrderId || order.externalOrderId,
      packetId: line.packetId || '',
      client: deps.myntraClient,
    });
  } else {
    throw new HttpError(400, `${order.channel} has no ship API.`);
  }
  const shipment = await saveShipment({
    tenantId,
    orderNo: order.orderNo,
    channel,
    courier: shipped.courier,
    awb: shipped.trackingNumber,
    status: 'booked',
    warehouseCode: 'WH-001',
    bookedAt: new Date(),
  });
  order.awb = shipped.trackingNumber;
  order.courier = shipped.courier;
  order.status = 'Dispatched';
  order.labelGeneratedAt = new Date();
  await order.save();
  return shipment;
}

async function releaseVendorSlice(tenantId, order, sub) {
  const refs = [sub.id, `${order.orderNo}:${sub.id}`];
  if ((order.subOrders || []).length <= 1) refs.push(order.orderNo);
  const filter = { tenantId, status: 'held', orderRef: { $in: refs } };
  if (sub.masterSkuId) filter.masterSkuId = sub.masterSkuId;
  const holds = await skip(InventoryReservation.find(filter));
  for (const hold of holds) {
    await releaseReservation(tenantId, null, { idempotencyKey: hold.idempotencyKey, reason: 'Vendor rejected the line' });
  }
  return holds.length;
}

async function queueBulkLabels(tenantId, userId, orderNos) {
  const ids = [...new Set((orderNos || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, 'Choose at least one Shopify order.');
  return enqueue({
    tenantId,
    channel: 'shopify',
    jobType: 'shipment_push',
    triggeredBy: 'manual',
    triggeredByUserId: userId,
    payload: { orderNos: ids },
  });
}

function kolkataDayStart(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return new Date(`${day}T00:00:00+05:30`);
}

async function markPickedUp(rows) {
  if (!rows.length) return;
  await Shipment.updateMany(
    { _id: { $in: rows.map((row) => row._id) } },
    { $set: { pickupRequestedAt: new Date() } },
  ).setOptions({ skipTenantFilter: true });
}

async function closeDayManifest(tenantId, deps = {}) {
  const start = kolkataDayStart();
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const rows = await skip(Shipment.find({
    tenantId,
    courier: 'delhivery',
    status: 'booked',
    warehouseCode: 'WH-001',
    pickupRequestedAt: null,
    bookedAt: { $gte: start, $lt: end },
  }));
  if (!rows.length) {
    throw new HttpError(400, 'No Delhivery AWBs are waiting for today\'s WH-001 pickup.');
  }
  const creds = deps.delhiveryCreds || await delhiveryCreds(tenantId);
  await delhivery.requestPickup(creds, { count: rows.length, request: deps.delhiveryRequest });
  await markPickedUp(rows);
  return {
    count: rows.length,
    warehouseCode: 'WH-001',
    rows: rows.map((row) => ({
      orderNo: row.orderNo,
      awb: row.awb,
      courier: row.courier,
      warehouseCode: row.warehouseCode || 'WH-001',
    })),
  };
}

async function waitingManifest(tenantId, now = new Date()) {
  const start = kolkataDayStart(now);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return skip(Shipment.countDocuments({
    tenantId,
    courier: 'delhivery',
    status: 'booked',
    warehouseCode: 'WH-001',
    pickupRequestedAt: null,
    bookedAt: { $gte: start, $lt: end },
  }));
}

async function runDueManifests(deps = {}) {
  const CourierAccount = require('../models/CourierAccount');
  const rows = await CourierAccount.find({ source: 'own', code: 'delhivery', status: 'active' })
    .select('tenantId')
    .setOptions({ skipTenantFilter: true });
  const seen = new Set();
  let requested = 0;
  for (const row of rows) {
    const id = String(row.tenantId);
    if (seen.has(id)) continue;
    seen.add(id);
    try {
      const creds = deps.delhiveryCreds || await delhiveryCreds(row.tenantId);
      if (!String(creds?.apiToken || '').trim()) continue;
      const waiting = await waitingManifest(row.tenantId);
      if (!waiting) continue;
      await closeDayManifest(row.tenantId, { ...deps, delhiveryCreds: creds });
      requested += 1;
    } catch (err) {
      if (err.statusCode === 400) continue;
      console.error('[PICKUP]', err.message);
    }
  }
  return { requested };
}

async function shippingReadiness(tenantId) {
  const missing = [];
  let courierReady = false;
  try {
    const creds = await delhiveryCreds(tenantId);
    courierReady = Boolean(String(creds?.apiToken || '').trim());
  } catch {
    courierReady = false;
  }
  if (!courierReady) missing.push('Delhivery API token on this company');
  const row = await skip(Warehouse.findOne({ tenantId, code: 'WH-001', status: 'active' }));
  if (!row?.address?.line1) missing.push('WH-001 street address');
  if (!row?.address?.pincode) missing.push('WH-001 pincode');
  if (!row?.contactPhone) missing.push('WH-001 phone');
  return {
    courierName: courierReady ? 'Delhivery' : '',
    courierReady,
    warehouseReady: Boolean(row?.address?.line1 && row?.address?.pincode && row?.contactPhone),
    missing,
    couriers: await bookingCouriers(tenantId),
  };
}

async function runShipmentJob(job, deps = {}) {
  const orderNos = job.payload?.orderNos || [];
  const booked = [];
  for (const orderNo of orderNos) {
    booked.push(await bookShopify(job.tenantId, orderNo, { ...deps, skipPickup: true }));
  }
  const waiting = booked.filter((row) => !row.pickupRequestedAt);
  if (waiting.length) {
    const creds = deps.delhiveryCreds || await delhiveryCreds(job.tenantId);
    await delhivery.requestPickup(creds, { count: waiting.length, request: deps.delhiveryRequest });
    await markPickedUp(waiting);
  }
  return { booked: booked.length, pickup: waiting.length };
}

module.exports = {
  bookShopify,
  bookOtherCourier,
  cancelShopifyLabel,
  bookMarketplace,
  releaseVendorSlice,
  releaseOrderReserve: releaseHeld,
  queueBulkLabels,
  closeDayManifest,
  runDueManifests,
  runShipmentJob,
  shippingReadiness,
  courierRates,
  rateEstimate,
  assertStatusChange,
  courierLabelPdf,
};
