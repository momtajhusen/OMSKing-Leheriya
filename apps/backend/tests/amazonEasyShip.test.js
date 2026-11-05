process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const net = require('net');
const tls = require('tls');
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Tenant = require('../src/models/Tenant');
const Order = require('../src/models/Order');
const Shipment = require('../src/models/Shipment');
const amazon = require('../src/adapters/amazon');
const { labelPdfFrom } = require('../src/lib/zipRead');
const {
  amazonEasyShipLabel, amazonBulkLabels, cancelAmazonLabel, amazonLabelPdf,
} = require('../src/services/amazonLabel.service');
const { bookMarketplace } = require('../src/services/ship.service');

let replSet;

test.before(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replSet.getUri());
});

test.after(async () => {
  await mongoose.disconnect();
  if (replSet) await replSet.stop();
});

const creds = { sellerId: 'SELLER', refreshToken: 'r', lwaClientId: 'c', lwaClientSecret: 's', apiMode: 'live', marketplaceId: 'A21TJRUUN4KGV' };
const PACK = { weightKg: 0.5, lengthCm: 30, breadthCm: 20, heightCm: 5 };
const PDF = (tag) => Buffer.from(`%PDF-1.4 ${tag}`);

/** A real zip (deflate) like the one behind Amazon's printableDocumentsUrl. */
function zipOf(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = zlib.deflateRawSync(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

/** Fake Easy Ship: slots, bulk schedule, package lookup and reschedule. Nothing leaves the process. */
function easyShipMock({ reject = {}, existing = {}, bulkHttp = null, noSlots = false, docs = 'zip' } = {}) {
  const calls = [];
  const downloads = [];
  let seq = 0;
  const request = async (method, url, opts = {}) => {
    calls.push({ method, url: String(url), body: opts.body });
    const u = new URL(url);
    if (u.pathname === '/auth/o2/token') return { status: 200, text: JSON.stringify({ access_token: 'tok' }) };
    if (u.pathname === '/easyShip/2022-03-23/timeSlot') {
      const id = opts.body.amazonOrderId;
      if (noSlots) return { status: 200, text: JSON.stringify({ amazonOrderId: id, timeSlots: [] }) };
      return {
        status: 200,
        text: JSON.stringify({
          amazonOrderId: id,
          timeSlots: [{ slotId: `SLOT-${id}`, startTime: '2026-11-06T04:30:00Z', endTime: '2026-11-06T08:30:00Z', handoverMethod: 'PICKUP' }],
        }),
      };
    }
    if (u.pathname === '/easyShip/2022-03-23/packages/bulk') {
      const [row] = opts.body.orderScheduleDetailsList;
      if (bulkHttp) return bulkHttp;
      if (reject[row.amazonOrderId]) {
        return { status: 200, text: JSON.stringify({ scheduledPackages: [], rejectedOrders: [{ amazonOrderId: row.amazonOrderId, error: { message: reject[row.amazonOrderId] } }] }) };
      }
      seq += 1;
      return {
        status: 200,
        text: JSON.stringify({
          scheduledPackages: [{
            scheduledPackageId: { amazonOrderId: row.amazonOrderId, packageId: `PKG-${seq}` },
            trackingDetails: { trackingId: `AMZ-AWB-${seq}` },
            packageStatus: 'ReadyForPickup',
            packageTimeSlot: { slotId: row.packageDetails.packageTimeSlot.slotId, startTime: '2026-11-06T04:30:00Z', endTime: '2026-11-06T08:30:00Z', handoverMethod: 'PICKUP' },
          }],
          rejectedOrders: [],
          ...(docs ? { printableDocumentsUrl: `https://easyship-docs.s3.eu-west-1.amazonaws.com/${row.amazonOrderId}.zip?sig=1` } : {}),
        }),
      };
    }
    if (u.pathname === '/easyShip/2022-03-23/package' && method === 'GET') {
      const id = u.searchParams.get('amazonOrderId');
      if (!existing[id]) return { status: 404, text: JSON.stringify({ errors: [{ message: 'Not found' }] }) };
      return { status: 200, text: JSON.stringify(existing[id]) };
    }
    if (u.pathname === '/easyShip/2022-03-23/package' && method === 'PATCH') {
      const [row] = opts.body.updatePackageDetailsList;
      return {
        status: 200,
        text: JSON.stringify({
          packages: [{
            scheduledPackageId: row.scheduledPackageId,
            trackingDetails: { trackingId: 'AMZ-AWB-RESCHEDULED' },
            packageStatus: 'ReadyForPickup',
            packageTimeSlot: { slotId: row.packageTimeSlot.slotId, startTime: '2026-11-07T04:30:00Z', endTime: '2026-11-07T08:30:00Z', handoverMethod: 'PICKUP' },
          }],
        }),
      };
    }
    throw new Error(`unexpected Amazon call ${method} ${url}`);
  };
  const download = async (url) => {
    downloads.push(String(url));
    const id = new URL(url).pathname.replace(/^\/|\.zip$/g, '');
    if (docs === 'no-pdf') return zipOf({ [`${id}_readme.txt`]: Buffer.from('no label here') });
    return zipOf({ [`${id}_invoice.pdf`]: PDF(`invoice ${id}`), [`${id}_label.pdf`]: PDF(`label ${id}`) });
  };
  return { calls, downloads, request, download, deps: { amazonCreds: creds, amazonRequest: request, amazonDownload: download } };
}

let n = 0;
async function seller() {
  n += 1;
  return Tenant.create({ name: `Easy Ship Seller ${n}`, slug: `easy-ship-${n}-${Date.now()}`, kind: 'merchant' });
}

function amazonOrder(tenantId, orderNo, extra = {}) {
  return Order.create({
    tenantId,
    orderNo,
    channel: 'Amazon',
    externalOrderId: `407-${orderNo}`,
    source: 'channel_api',
    status: 'Ready to Ship',
    items: [{ sku: 'KURTA-1', qty: 1, pack: PACK }],
    ...extra,
  });
}

function blockSockets() {
  const calls = [];
  const originals = { netConnect: net.connect, netCreate: net.createConnection, tlsConnect: tls.connect };
  const stop = (...args) => { calls.push(args); throw new Error('live socket blocked in test'); };
  net.connect = stop;
  net.createConnection = stop;
  tls.connect = stop;
  return {
    calls,
    restore() {
      net.connect = originals.netConnect;
      net.createConnection = originals.netCreate;
      tls.connect = originals.tlsConnect;
    },
  };
}

test('the label PDF is taken out of Amazon\'s zip; a plain PDF passes through', () => {
  const zip = zipOf({ 'a_invoice.pdf': PDF('invoice'), 'a_label.pdf': PDF('label') });
  assert.equal(labelPdfFrom(zip).toString(), '%PDF-1.4 label', 'the label file wins over the invoice');
  assert.equal(labelPdfFrom(PDF('direct')).toString(), '%PDF-1.4 direct');
  assert.equal(labelPdfFrom(Buffer.from('not a document')), null);
});

test('one Amazon order gets an Easy Ship pickup slot, AWB, courier, stored label PDF and the Label generated state', async () => {
  const tenant = await seller();
  await amazonOrder(tenant._id, 'AMZ-ES-1');
  const mock = easyShipMock();
  const sockets = blockSockets();
  try {
    const shipment = await amazonEasyShipLabel(tenant._id, 'AMZ-ES-1', mock.deps);
    assert.equal(shipment.awb, 'AMZ-AWB-1');
    assert.equal(shipment.courier, 'amazon');
    assert.equal(shipment.channelPackageId, 'PKG-1');
    assert.equal(shipment.labelPdf.toString(), '%PDF-1.4 label 407-AMZ-ES-1');
    assert.equal(sockets.calls.length, 0, 'no live socket');
  } finally {
    sockets.restore();
  }
  const slotCall = mock.calls.find((c) => c.url.endsWith('/easyShip/2022-03-23/timeSlot'));
  assert.deepEqual(slotCall.body.packageDimensions, { length: 30, width: 20, height: 5, unit: 'cm' });
  assert.deepEqual(slotCall.body.packageWeight, { value: 500, unit: 'g' });
  assert.equal(slotCall.body.marketplaceId, 'A21TJRUUN4KGV');
  const bulk = mock.calls.find((c) => c.url.endsWith('/packages/bulk'));
  assert.equal(bulk.body.labelFormat, 'PDF');
  assert.equal(bulk.body.orderScheduleDetailsList[0].packageDetails.packageTimeSlot.slotId, 'SLOT-407-AMZ-ES-1');
  assert.deepEqual(mock.downloads, ['https://easyship-docs.s3.eu-west-1.amazonaws.com/407-AMZ-ES-1.zip?sig=1']);

  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'AMZ-ES-1' });
  assert.equal(order.awb, 'AMZ-AWB-1');
  assert.equal(order.courier, 'Amazon Easy Ship');
  assert.ok(order.labelGeneratedAt, 'Label generated');
  assert.equal(order.status, 'Ready to Ship', 'not Dispatched until Amazon picks it up');
  assert.equal(order.easyShip.packageId, 'PKG-1');
  assert.equal(order.easyShip.handover, 'PICKUP');
  assert.equal(new Date(order.easyShip.slotStart).toISOString(), '2026-11-06T04:30:00.000Z');

  const again = await amazonEasyShipLabel(tenant._id, 'AMZ-ES-1', mock.deps);
  assert.equal(again.awb, 'AMZ-AWB-1', 'a second click returns the same label, no new package');
  assert.equal(mock.calls.filter((c) => c.url.endsWith('/packages/bulk')).length, 1);

  const pdf = await amazonLabelPdf(tenant._id, 'AMZ-ES-1');
  assert.equal(pdf.toString(), '%PDF-1.4 label 407-AMZ-ES-1', 'reprint serves the stored PDF without calling Amazon');
});

test('the order page path (ship on marketplace) uses the same Easy Ship label flow for Amazon', async () => {
  const tenant = await seller();
  await amazonOrder(tenant._id, 'AMZ-ES-MKT');
  const mock = easyShipMock();
  const shipment = await bookMarketplace(tenant._id, 'AMZ-ES-MKT', mock.deps);
  assert.equal(shipment.awb, 'AMZ-AWB-1');
  assert.ok(shipment.labelPdf);
});

test('an order without package weight and size is refused before Amazon is called', async () => {
  const tenant = await seller();
  await amazonOrder(tenant._id, 'AMZ-ES-NOPACK', { items: [{ sku: 'UNKNOWN', qty: 1 }] });
  const mock = easyShipMock();
  await assert.rejects(() => amazonEasyShipLabel(tenant._id, 'AMZ-ES-NOPACK', mock.deps), /weight and size/);
  assert.equal(mock.calls.length, 0);
});

test('bulk makes one label per order and reports each refused order with Amazon\'s reason', async () => {
  const tenant = await seller();
  await amazonOrder(tenant._id, 'AMZ-B1');
  await amazonOrder(tenant._id, 'AMZ-B2');
  await amazonOrder(tenant._id, 'AMZ-B3');
  await Order.create({ tenantId: tenant._id, orderNo: 'SHP-B4', channel: 'Shopify' });
  const mock = easyShipMock({ reject: { '407-AMZ-B2': 'Order is not eligible for Easy Ship' } });
  const result = await amazonBulkLabels(tenant._id, ['AMZ-B1', 'AMZ-B2', 'AMZ-B3', 'SHP-B4', 'MISSING'], mock.deps);
  assert.deepEqual(result.done.map((row) => [row.orderNo, row.awb]), [['AMZ-B1', 'AMZ-AWB-1'], ['AMZ-B3', 'AMZ-AWB-2']]);
  assert.deepEqual(result.failed.map((row) => row.orderNo), ['AMZ-B2', 'SHP-B4', 'MISSING']);
  assert.match(result.failed[0].reason, /not eligible for Easy Ship/);
  assert.match(result.failed[1].reason, /Amazon/);
  assert.equal(mock.calls.filter((c) => c.url.endsWith('/auth/o2/token')).length, 1, 'one Amazon token for the whole batch');
  await assert.rejects(() => amazonBulkLabels(tenant._id, [], mock.deps), /Choose at least one Amazon order/);
});

test('cancel clears the label in OMSKing; making it again reschedules the same Amazon package and keeps its label', async () => {
  const tenant = await seller();
  await amazonOrder(tenant._id, 'AMZ-RE-1');
  const first = easyShipMock();
  await amazonEasyShipLabel(tenant._id, 'AMZ-RE-1', first.deps);

  const cancelled = await cancelAmazonLabel(tenant._id, 'AMZ-RE-1');
  assert.equal(cancelled.status, 'cancelled');
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'AMZ-RE-1' });
  assert.equal(order.awb, '');
  assert.equal(order.labelGeneratedAt, null);
  assert.equal(order.easyShip.packageId, 'PKG-1', 'the Amazon package id stays for the next label');
  await assert.rejects(() => amazonLabelPdf(tenant._id, 'AMZ-RE-1'), /no Amazon label/);
  await assert.rejects(() => cancelAmazonLabel(tenant._id, 'AMZ-RE-1'), /no Amazon label to cancel/);

  const again = easyShipMock({
    reject: { '407-AMZ-RE-1': 'A package is already scheduled for this order' },
    existing: { '407-AMZ-RE-1': { scheduledPackageId: { amazonOrderId: '407-AMZ-RE-1', packageId: 'PKG-1' }, packageStatus: 'ReadyForPickup', trackingDetails: { trackingId: 'AMZ-AWB-1' } } },
  });
  const redone = await amazonEasyShipLabel(tenant._id, 'AMZ-RE-1', again.deps);
  assert.equal(redone.awb, 'AMZ-AWB-RESCHEDULED');
  assert.equal(redone.labelPdf.toString(), '%PDF-1.4 label 407-AMZ-RE-1', 'the earlier label PDF is reused for the same package');
  const patch = again.calls.find((c) => c.method === 'PATCH');
  assert.deepEqual(patch.body.updatePackageDetailsList[0].scheduledPackageId, { amazonOrderId: '407-AMZ-RE-1', packageId: 'PKG-1' });
  const fresh = await Order.findOne({ tenantId: tenant._id, orderNo: 'AMZ-RE-1' });
  assert.equal(fresh.awb, 'AMZ-AWB-RESCHEDULED');
  assert.ok(fresh.labelGeneratedAt);
  assert.equal(new Date(fresh.easyShip.slotStart).toISOString(), '2026-11-07T04:30:00.000Z');
});

test('a package Amazon already picked up cannot get a new label', async () => {
  const tenant = await seller();
  await amazonOrder(tenant._id, 'AMZ-PICKED');
  const mock = easyShipMock({
    reject: { '407-AMZ-PICKED': 'A package is already scheduled for this order' },
    existing: { '407-AMZ-PICKED': { scheduledPackageId: { amazonOrderId: '407-AMZ-PICKED', packageId: 'PKG-9' }, packageStatus: 'PickedUp' } },
  });
  await assert.rejects(() => amazonEasyShipLabel(tenant._id, 'AMZ-PICKED', mock.deps), /already picked up/);
});

test('another company\'s order is never labelled, printed or cancelled', async () => {
  const owner = await seller();
  const other = await seller();
  await amazonOrder(owner._id, 'AMZ-OWN');
  const mock = easyShipMock();
  await amazonEasyShipLabel(owner._id, 'AMZ-OWN', mock.deps);
  await assert.rejects(() => amazonEasyShipLabel(other._id, 'AMZ-OWN', mock.deps), /Order not found/);
  await assert.rejects(() => amazonLabelPdf(other._id, 'AMZ-OWN'), /Order not found/);
  await assert.rejects(() => cancelAmazonLabel(other._id, 'AMZ-OWN'), /Order not found/);
  assert.equal(await Shipment.countDocuments({ tenantId: other._id }), 0);
});

test('the label, bulk, reprint and cancel routes need the shipping permissions and take the company from the login', () => {
  const fs = require('fs');
  const routes = fs.readFileSync(require.resolve('../src/routes/v1/orders.routes.js'), 'utf8');
  assert.match(routes, /router\.post\('\/labels\/amazon', \.\.\.ship, asyncHandler\(orders\.bookAmazonLabels\)\)/);
  assert.match(routes, /router\.get\('\/:orderId\/amazon-label', \.\.\.ship, asyncHandler\(orders\.amazonLabel\)\)/);
  assert.match(routes, /router\.post\('\/:orderId\/label\/cancel', \.\.\.cancelShip/);
  const controller = fs.readFileSync(require.resolve('../src/controllers/orders.controller.js'), 'utf8');
  for (const fn of ['bookAmazonLabels', 'amazonLabel']) {
    const body = controller.slice(controller.indexOf(`async function ${fn}(`), controller.indexOf('\n}\n', controller.indexOf(`async function ${fn}(`)));
    assert.match(body, /const tenantId = merchantTenant\(req\);/, `${fn} scopes by the verified login`);
  }
});

test('without apiMode live no Amazon socket opens and the label download host must be Amazon S3', async () => {
  const sockets = blockSockets();
  try {
    const { apiMode, ...noMode } = creds;
    await assert.rejects(() => amazon.easyShip(noMode), /apiMode|Live API/);
    const mock = easyShipMock();
    const session = await amazon.easyShip(creds, { request: mock.request, download: mock.download });
    await assert.rejects(() => session.label('https://evil.example.com/x.zip'), /Amazon S3/);
    await assert.rejects(() => session.label('http://easyship-docs.s3.amazonaws.com/x.zip'), /Amazon S3/);
    assert.equal(sockets.calls.length, 0);
  } finally {
    sockets.restore();
  }
});

test('Amazon refusing the schedule call (HTTP 400, like the sandbox did) shows its reason and saves nothing', async () => {
  const tenant = await seller();
  await amazonOrder(tenant._id, 'AMZ-400');
  const mock = easyShipMock({ bulkHttp: { status: 400, text: JSON.stringify({ errors: [{ code: 'InvalidInput', message: 'Could not match input arguments' }] }) } });
  await assert.rejects(
    () => amazonEasyShipLabel(tenant._id, 'AMZ-400', mock.deps),
    (err) => err.statusCode === 400 && /Easy Ship schedule returned 400\. Could not match input arguments/.test(err.message),
  );
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'AMZ-400' });
  assert.equal(order.awb, '');
  assert.equal(order.labelGeneratedAt, undefined);
  assert.equal(await Shipment.countDocuments({ tenantId: tenant._id, orderNo: 'AMZ-400' }), 0);
  assert.equal(mock.downloads.length, 0);
});

test('no free Easy Ship pickup slot stops before Amazon is asked to schedule', async () => {
  const tenant = await seller();
  await amazonOrder(tenant._id, 'AMZ-NOSLOT');
  const mock = easyShipMock({ noSlots: true });
  await assert.rejects(() => amazonEasyShipLabel(tenant._id, 'AMZ-NOSLOT', mock.deps), /no Easy Ship pickup slot/);
  assert.equal(mock.calls.filter((c) => c.url.endsWith('/packages/bulk')).length, 0);
  assert.equal(await Shipment.countDocuments({ tenantId: tenant._id, orderNo: 'AMZ-NOSLOT' }), 0);
});

test('when Amazon sends no label PDF the AWB is still kept and the reprint says to use Seller Central', async () => {
  const tenant = await seller();
  await amazonOrder(tenant._id, 'AMZ-NODOC');
  await amazonOrder(tenant._id, 'AMZ-NOPDF');
  const noLink = easyShipMock({ docs: null });
  const kept = await amazonEasyShipLabel(tenant._id, 'AMZ-NODOC', noLink.deps);
  assert.equal(kept.awb, 'AMZ-AWB-1');
  assert.equal(kept.labelPdf, null);
  assert.equal(noLink.downloads.length, 0);
  await assert.rejects(() => amazonLabelPdf(tenant._id, 'AMZ-NODOC'), /did not send a label PDF.*Seller Central/);

  const noPdf = easyShipMock({ docs: 'no-pdf' });
  const empty = await amazonEasyShipLabel(tenant._id, 'AMZ-NOPDF', noPdf.deps);
  assert.equal(empty.labelPdf, null, 'a zip without a PDF stores no label');
  const order = await Order.findOne({ tenantId: tenant._id, orderNo: 'AMZ-NOPDF' });
  assert.equal(order.awb, 'AMZ-AWB-1');
  assert.ok(order.labelGeneratedAt);
});

test('in sandbox, Amazon\'s "Could not match input arguments" reads as: sandbox cannot make a label for a real order', async () => {
  const tenant = await seller();
  await amazonOrder(tenant._id, 'AMZ-SBX');
  const mock = easyShipMock({ bulkHttp: { status: 400, text: JSON.stringify({ errors: [{ code: 'InvalidInput', message: 'Could not match input arguments' }] }) } });
  await assert.rejects(
    () => amazonEasyShipLabel(tenant._id, 'AMZ-SBX', { ...mock.deps, amazonCreds: { ...creds, apiMode: 'sandbox' } }),
    (err) => err.statusCode === 400 && err.message === 'Amazon sandbox cannot make a label for a real order. It only answers Amazon test examples, so nothing was booked. Switch Amazon to Live in Settings › Channels to make real Easy Ship labels.',
  );
  assert.equal(await Shipment.countDocuments({ tenantId: tenant._id, orderNo: 'AMZ-SBX' }), 0);
  const { amazonBulkLabels } = require('../src/services/amazonLabel.service');
  const bulk = await amazonBulkLabels(tenant._id, ['AMZ-SBX'], { ...mock.deps, amazonCreds: { ...creds, apiMode: 'sandbox' } });
  assert.match(bulk.failed[0].reason, /^Amazon sandbox cannot make a label for a real order/);
});
