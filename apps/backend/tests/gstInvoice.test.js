const test = require('node:test');
const { describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildInvoicePdf, emailInvoicePdf } = require('../src/lib/invoicePdf');

test('one order PDF starts with %PDF, intra-state IGST is 0, and email is skipped without Gmail', async () => {
  const order = {
    channel: 'Shopify',
    orderNo: 'SHP-9',
    externalOrderId: '567890',
    customer: 'Asha',
    city: 'Jaipur, Rajasthan',
    items: [{ name: 'Kurta', sku: 'K1', qty: 1, price: 118, gst: 18 }],
  };
  const pdf = buildInvoicePdf(order, {
    warehouseState: 'Rajasthan',
    company: { companyName: 'Leheriya', gstin: '08AAAAA0000A1Z5' },
  });
  assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF');
  assert.equal(pdf.invoiceNo, '567890');
  assert.equal(pdf.creditNoteNo, 'CN-567890');
  assert.equal(pdf.igst, 0);
  assert.ok(pdf.cgst > 0 && pdf.sgst > 0);
  const text = pdf.bytes.toString('latin1');
  assert.match(text, /567890/);
  assert.match(text, /Total CGST:/);
  assert.doesNotMatch(text, /IGST/);

  const out = buildInvoicePdf(
    { ...order, city: 'Mumbai, Maharashtra' },
    { warehouseState: 'Rajasthan' },
  );
  assert.equal(out.cgst, 0);
  assert.equal(out.sgst, 0);
  assert.ok(out.igst > 0);

  let sent = 0;
  const skipped = await emailInvoicePdf({
    tenantId: 'tenant',
    to: 'buyer@example.com',
    pdf: pdf.bytes,
    filename: '567890.pdf',
    subject: 'Tax invoice 567890',
    mailboxOf: async () => null,
    sendMail: async () => { sent += 1; },
  });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.emailed, false);
  assert.equal(sent, 0);

  const failed = await emailInvoicePdf({
    tenantId: 'tenant',
    to: 'buyer@example.com',
    pdf: pdf.bytes,
    filename: '567890.pdf',
    subject: 'Tax invoice 567890',
    mailboxOf: async () => ({ user: 'shop@gmail.com' }),
    sendMail: async () => { throw new Error('smtp down'); },
  });
  assert.equal(failed.emailed, false);
  assert.equal(failed.skipped, false);
  assert.equal(pdf.bytes.subarray(0, 4).toString(), '%PDF');

  const note = buildInvoicePdf(order, { warehouseState: 'Rajasthan', kind: 'credit' });
  assert.equal(note.number, 'CN-567890');
  assert.match(note.bytes.toString('latin1'), /CN-567890/);
});

test('invoice PDF follows the client Tax Invoice format (header, three blocks, item table, totals in words)', () => {
  const order = {
    channel: 'Shopify',
    orderNo: 'SHP-51585',
    channelOrderNo: '#51585',
    orderDate: new Date('2025-12-29T10:00:00Z'),
    paymentMode: 'Prepaid',
    customer: 'Indian Farmers Fertilizer Cooperative Limited',
    phone: '+911142592791',
    address: 'C-1, DISTRICT CENTRE, SAKET',
    city: 'NEW DELHI, Delhi 110017',
    items: [
      { name: 'Bhagalpuri Madhubani Dupatta', sku: 'D1', qty: 15, price: 999, gst: 5, hsn: '5407' },
      { name: 'Handmade Cotton Kalamkari Dupatta', sku: 'D2', qty: 15, price: 799, gst: 5, hsn: '5407' },
    ],
  };
  const company = {
    companyName: 'PRDOSCO GLOBAL PRIVATE LIMITED',
    gstin: '07AAQCP4784P1ZB',
    email: 'support@leheriya.com',
    phone: '+91 9873003388',
    website: 'www.leheriya.com',
    address: 'BASEMENT, PLOT NO 24, SECTOR 12-A ROAD, SECTOR 12, DWARKA',
    city: 'New Delhi 110078',
  };
  const pdf = buildInvoicePdf(order, { warehouseState: 'Delhi', company });
  const text = pdf.bytes.toString('latin1');
  for (const part of [
    'GSTIN: 07AAQCP4784P1ZB', 'Tax Invoice', 'Original',
    'support@leheriya.com', 'www.leheriya.com', '+91 9873003388',
    'Invoice No: 51585', 'Order Id: 51585', 'Invoice Date: Dec 29, 25', 'Payment: Prepaid',
    'Place of Supply', 'State Code: 07',
    'BILLED TO', 'SHIP TO', 'SUPPLIER',
    'Taxable Val', 'HSN', 'GST', 'CGST', 'SGST',
    'Rs. 999.00', 'Rs. 14985.00', '5%', '5407',
    'Amount in words', 'TWENTY SIX THOUSAND NINE HUNDRED AND SEVENTY RUPEES ONLY',
    'Total Amount before Tax:', 'Total Tax Amount:', 'Total Amount After Tax:', 'Rs. 26970.00',
    'This is computer generated invoice and hence no signature is required',
  ]) assert.ok(text.includes(part), `invoice PDF is missing "${part}"`);
  assert.equal(pdf.gross, 26970);
  assert.ok(!text.includes('BANK DETAILS'));
  assert.ok(!text.includes('IGST'), 'intra-state invoice shows CGST + SGST, not IGST');

  const inter = buildInvoicePdf({ ...order, city: 'Mumbai, Maharashtra' }, { warehouseState: 'Delhi', company })
    .bytes.toString('latin1');
  assert.ok(inter.includes('IGST'));
  assert.ok(inter.includes('State Code: 27'));
});

test('same state splits GST half CGST half SGST, another state puts the full GST on IGST', () => {
  const { lineTax } = require('../src/services/finance.service');
  const item = (price) => ({ name: 'Leheriya Printed Dress Material', sku: 'LEH-01-300', qty: 1, price, gst: 5 });

  const delhi = lineTax(item(1591), { warehouseState: 'Delhi', shipState: 'Delhi' });
  assert.deepEqual(
    [delhi.taxable, delhi.cgst, delhi.sgst, delhi.igst, delhi.intraState],
    [1515.24, 37.88, 37.88, 0, true],
  );
  const maharashtra = lineTax(item(1359), { warehouseState: 'Delhi', shipState: 'Maharashtra' });
  assert.deepEqual(
    [maharashtra.taxable, maharashtra.cgst, maharashtra.sgst, maharashtra.igst, maharashtra.intraState],
    [1294.29, 0, 0, 64.71, false],
  );

  for (const shipState of ['New Delhi', 'DL', 'NCT of Delhi', 'delhi ']) {
    const tax = lineTax(item(1591), { warehouseState: 'Delhi', shipState });
    assert.equal(tax.intraState, true, `${shipState} is the same state as Delhi`);
    assert.equal(tax.igst, 0);
  }
  assert.equal(lineTax(item(1359), { warehouseState: 'Delhi', shipState: 'MH' }).igst, 64.71);

  const company = { companyName: 'Leheriya', gstin: '07AAQCP4784P1ZB' };
  const pdf = (order) => buildInvoicePdf({ orderNo: 'X1', items: [item(order.price)], ...order }, { warehouseState: 'Delhi', company })
    .bytes.toString('latin1');
  const intra = pdf({ price: 1591, customer: 'Praveen Dhiman', city: 'Dwarka, New Delhi 110078' });
  assert.ok(intra.includes('(Total CGST:)') && intra.includes('(Total SGST:)'));
  assert.equal(intra.split('(Rs. 37.88)').length - 1, 6, 'CGST and SGST Rs. 37.88 each, on the line, the total row and the summary');
  assert.ok(!intra.includes('IGST'));
  assert.ok(intra.includes('State Code: 07'));
  const inter = pdf({ price: 1359, customer: 'Madhuri Chandanshive', city: 'Baramati, Maharashtra 413102' });
  assert.ok(inter.includes('(Total IGST:)') && inter.includes('(Rs. 64.71)'));
  assert.ok(!inter.includes('CGST') && !inter.includes('SGST'));
});

test('CGST equals SGST to the paisa and the line still adds up to the gross', () => {
  const { lineTax, toPaise } = require('../src/services/finance.service');
  const tax = lineTax({ price: 999, qty: 1, gst: 5 }, { warehouseState: 'Delhi', shipState: 'Delhi' });
  assert.equal(tax.cgst, tax.sgst);
  assert.deepEqual([tax.taxable, tax.cgst, tax.sgst], [951.42, 23.79, 23.79]);
  assert.equal(toPaise(tax.taxable) + toPaise(tax.cgst) + toPaise(tax.sgst), toPaise(tax.gross));
  const inter = lineTax({ price: 999, qty: 1, gst: 5 }, { warehouseState: 'Delhi', shipState: 'Goa' });
  assert.deepEqual([inter.taxable, inter.igst], [951.43, 47.57]);
});

test('GST state table has codes 25, 28 and 97 without changing which code a state name resolves to', () => {
  const { gstinState, gstStateCode } = require('../src/services/finance.service');
  assert.ok(gstinState('25AAAAA0000A1Z5'));
  assert.ok(gstinState('28AAAAA0000A1Z5'));
  assert.equal(gstinState('97AAAAA0000A1Z5'), 'Other Territory');
  assert.equal(gstStateCode('Daman and Diu'), '26');
  assert.equal(gstStateCode('Andhra Pradesh'), '37');
});

test('line GST rate: a set line rate wins, else Master SKU, else product; nothing found is missing, not 0%', () => {
  const { resolveLineRate } = require('../src/services/finance.service');
  assert.equal(resolveLineRate({ gst: 12 }, { gstRatePercent: 5 }, {}), 12);
  assert.equal(resolveLineRate({ gst: 0 }, { gstRatePercent: 5 }, {}), 5);
  assert.equal(resolveLineRate({ gst: null }, { gstRatePercent: 0 }, { gstRatePercent: 5 }), 0);
  assert.equal(resolveLineRate({}, { gstRatePercent: null }, { gstRatePercent: 0 }), 0);
  assert.equal(resolveLineRate({ gst: 0 }, null, null), null);
  assert.equal(resolveLineRate({}, { gstRatePercent: null }, {}), null);
});

test('shipping charge gets its own GST line at the highest item rate and is in the totals', () => {
  const { invoiceTotals } = require('../src/services/finance.service');
  const order = {
    orderNo: 'S1',
    shippingCharge: 118,
    items: [
      { name: 'Dupatta', sku: 'D1', qty: 1, price: 1050, gst: 5, hsn: '5407' },
      { name: 'Bag', sku: 'B1', qty: 1, price: 1180, gst: 18, hsn: '4202' },
    ],
  };
  const out = invoiceTotals(order, { warehouseState: 'Delhi', shipState: 'Delhi' });
  const ship = out.lines.find(({ item }) => item.name === 'Shipping');
  assert.ok(ship, 'Shipping line is added');
  assert.equal(ship.tax.rate, 18);
  assert.deepEqual([ship.tax.taxable, ship.tax.cgst, ship.tax.sgst], [100, 9, 9]);
  assert.equal(out.totals.gross, 2348);
  assert.equal(invoiceTotals({ ...order, shippingCharge: 0 }, { warehouseState: 'Delhi', shipState: 'Delhi' }).lines.length, 2);

  const pdf = buildInvoicePdf(order, { warehouseState: 'Delhi', company: { companyName: 'Leheriya' } });
  const text = pdf.bytes.toString('latin1');
  assert.ok(text.includes('(Shipping)'));
  assert.ok(text.includes('(Rs. 2348.00)'));
  assert.equal(pdf.gross, 2348);
});

test('PDF place of supply prints the state name and code, the total row has no summed unit rate, and a credit note has its own date', () => {
  const order = {
    channel: 'Shopify',
    orderNo: 'SHP-1',
    channelOrderNo: '#1001',
    city: 'NEW DELHI 110017',
    shipState: 'DL',
    invoiceGeneratedAt: new Date('2026-01-05T20:00:00Z'),
    creditNoteGeneratedAt: new Date('2026-02-10T20:00:00Z'),
    items: [
      { name: 'A', sku: 'A1', qty: 2, price: 999, gst: 5, hsn: '5407' },
      { name: 'B', sku: 'B1', qty: 1, price: 799, gst: 5, hsn: '5407' },
    ],
  };
  const text = buildInvoicePdf(order, { warehouseState: 'Delhi' }).bytes.toString('latin1');
  assert.ok(text.includes('(Delhi \\(07\\))'), 'place of supply is the state, not the city');
  assert.ok(!text.includes('(NEW DELHI)'));
  assert.ok(!text.includes('Rs. 1798.00'), 'unit prices are not summed without qty');
  assert.ok(text.includes('Invoice Date: Jan 6, 26'));

  const note = buildInvoicePdf(order, { warehouseState: 'Delhi', kind: 'credit' }).bytes.toString('latin1');
  assert.ok(note.includes('Credit Note Date: Feb 11, 26'));
  assert.ok(note.includes('Invoice Date: Jan 6, 26'));
});

test('HTML invoice preview total is the same computed gross as the PDF, not order.total', () => {
  const { invoiceHtml } = require('../src/lib/orderSubOrders');
  const order = {
    orderNo: 'M1',
    total: 5000,
    shippingCharge: 50,
    shipState: 'Delhi',
    items: [{ name: 'Kurta', sku: 'K1', qty: 2, price: 1000, gst: 5, hsn: '6211' }],
  };
  const html = invoiceHtml(order, { warehouseState: 'Delhi' });
  const pdf = buildInvoicePdf(order, { warehouseState: 'Delhi' });
  assert.equal(pdf.gross, 2050);
  assert.match(html, /Total ₹2,050/);
  assert.match(html, /Shipping/);
  assert.doesNotMatch(html, /5,000/);
});

test('default tax categories follow GST 2.0: apparel 5% up to Rs 2500 per piece, 18% above', () => {
  const { DEFAULT_TAX } = require('../src/services/taxSettings.service');
  const rates = DEFAULT_TAX.categories.map((row) => [row.name, row.gstRate]);
  assert.ok(rates.some(([name, rate]) => /2500/.test(name) && /up to|below/i.test(name) && rate === 5), JSON.stringify(rates));
  assert.ok(rates.some(([name, rate]) => /2500/.test(name) && /above/i.test(name) && rate === 18), JSON.stringify(rates));
  assert.ok(!rates.some(([name]) => /1000/.test(name)));
});

test('a Shopify order has an invoice number only after the invoice is generated', () => {
  const { toOrderDto } = require('../src/lib/orderDto');
  const base = { orderNo: 'SHP-7', channel: 'Shopify', channelOrderNo: '#7007', items: [], subOrders: [] };
  assert.equal(toOrderDto(base).invoiceNo, '');
  assert.equal(toOrderDto({ ...base, invoiceGeneratedAt: new Date() }).invoiceNo, '7007');
  assert.equal(toOrderDto({ ...base, channel: 'Myntra', invoiceNo: 'MYN-1' }).invoiceNo, 'MYN-1');
  const dto = toOrderDto({ ...base, shippingCharge: 99, creditNoteGeneratedAt: new Date('2026-01-01') });
  assert.equal(dto.shippingCharge, 99);
  assert.ok(dto.creditNoteGeneratedAt);
});

describe('invoice API', () => {
  process.env.NODE_ENV = 'test';
  const http = require('http');
  const mongoose = require('mongoose');
  const { MongoMemoryReplSet } = require('mongodb-memory-server');
  let replSet;
  let server;
  let base;

  async function api(method, path, { token, json } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: json !== undefined ? JSON.stringify(json) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async function shop(name, { whState = 'Delhi', gstin = '' } = {}) {
    const { provisionMerchant } = require('../src/services/tenantOnboard.service');
    const { ensureDefaultWarehouses } = require('../src/services/warehouse.service');
    const Warehouse = require('../src/models/Warehouse');
    const Tenant = require('../src/models/Tenant');
    const made = await provisionMerchant({
      name,
      ownerEmail: `${name.replace(/\W/g, '').toLowerCase()}-${Date.now()}@example.com`,
      ownerName: 'Owner',
      password: 'Password1',
      status: 'active',
    });
    const tenantId = made.tenant._id;
    await ensureDefaultWarehouses(tenantId);
    await Warehouse.updateOne({ tenantId, code: 'WH-001' }, { $set: { 'address.state': whState } }).setOptions({ skipTenantFilter: true });
    if (gstin) await Tenant.updateOne({ _id: tenantId }, { $set: { 'legalEntity.gstin': gstin } });
    const login = await api('POST', '/api/v1/auth/login', { json: { email: made.owner.email, password: 'Password1' } });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return { tenantId, token: login.body.data.accessToken };
  }

  function makeOrder(tenantId, extra = {}) {
    const Order = require('../src/models/Order');
    return Order.create({
      tenantId,
      channel: 'Shopify',
      status: 'Dispatched',
      source: 'channel_api',
      customer: 'Buyer',
      shipState: 'Delhi',
      total: 1050,
      items: [{ name: 'Dupatta', sku: 'D1', qty: 1, price: 1050, gst: 5, hsn: '5407' }],
      ...extra,
    });
  }

  async function saved(tenantId, orderNo) {
    const Order = require('../src/models/Order');
    return Order.findOne({ tenantId, orderNo }).setOptions({ skipTenantFilter: true }).lean();
  }

  before(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    server = http.createServer(require('../src/app'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
    if (replSet) await replSet.stop();
  });

  test('a line with no GST rate on the line, Master SKU or product refuses the invoice and lists the SKU', async () => {
    const MasterSku = require('../src/models/MasterSku');
    const { tenantId, token } = await shop('Rate shop');
    await MasterSku.create({ tenantId, code: 'NORATE', name: 'No rate' });
    await makeOrder(tenantId, {
      orderNo: 'SHP-RATE-1',
      externalOrderId: '9101',
      items: [
        { name: 'Ok', sku: 'OK1', qty: 1, price: 1050, gst: 5, hsn: '5407' },
        { name: 'No rate', sku: 'NORATE', qty: 1, price: 500, gst: 0 },
        { name: 'Unmapped', sku: 'GHOST', qty: 1, price: 300 },
      ],
    });
    const res = await api('POST', '/api/v1/orders/SHP-RATE-1/invoice', { token, json: { email: false } });
    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.match(res.body.message, /NORATE/);
    assert.match(res.body.message, /GHOST/);
    assert.doesNotMatch(res.body.message, /OK1/);
    assert.equal((await saved(tenantId, 'SHP-RATE-1')).invoiceGeneratedAt, undefined);
  });

  test('an unknown buyer or seller state refuses the invoice instead of guessing IGST', async () => {
    const one = await shop('State shop');
    await makeOrder(one.tenantId, { orderNo: 'SHP-NOSTATE', externalOrderId: '9201', shipState: '', city: 'Somewhere' });
    const buyer = await api('POST', '/api/v1/orders/SHP-NOSTATE/invoice', { token: one.token, json: { email: false } });
    assert.equal(buyer.status, 400, JSON.stringify(buyer.body));
    assert.match(buyer.body.message, /place of supply|state/i);

    const two = await shop('Seller state shop', { whState: '' });
    await makeOrder(two.tenantId, { orderNo: 'SHP-NOSELLER', externalOrderId: '9202' });
    const seller = await api('POST', '/api/v1/orders/SHP-NOSELLER/invoice', { token: two.token, json: { email: false } });
    assert.equal(seller.status, 400, JSON.stringify(seller.body));
    assert.match(seller.body.message, /state/i);
  });

  test('the seller state comes from the order warehouse when it has one, else WH-001', async () => {
    const Warehouse = require('../src/models/Warehouse');
    const { tenantId, token } = await shop('Warehouse shop');
    await Warehouse.updateOne({ tenantId, code: 'WH-002' }, { $set: { 'address.state': 'Maharashtra' } }).setOptions({ skipTenantFilter: true });
    await makeOrder(tenantId, { orderNo: 'SHP-WH2', externalOrderId: '9301', shipState: 'Maharashtra', warehouseCode: 'WH-002' });
    await makeOrder(tenantId, { orderNo: 'SHP-WH1', externalOrderId: '9302', shipState: 'Maharashtra' });
    const fromWh2 = await api('POST', '/api/v1/orders/SHP-WH2/invoice', { token, json: { email: false } });
    assert.equal(fromWh2.status, 200, JSON.stringify(fromWh2.body));
    const pdf2 = Buffer.from(fromWh2.body.data.invoicePdf, 'base64').toString('latin1');
    assert.ok(pdf2.includes('(Total CGST:)') && !pdf2.includes('IGST'), 'WH-002 is in Maharashtra, same as the buyer');
    const fromWh1 = await api('POST', '/api/v1/orders/SHP-WH1/invoice', { token, json: { email: false } });
    const pdf1 = Buffer.from(fromWh1.body.data.invoicePdf, 'base64').toString('latin1');
    assert.ok(pdf1.includes('(Total IGST:)'), 'no warehouse code: WH-001 Delhi to Maharashtra is IGST');
  });

  test('the invoice date is set once, a credit note has its own date and needs an issued invoice', async () => {
    const { tenantId, token } = await shop('Date shop');
    await makeOrder(tenantId, { orderNo: 'SHP-DATE-1', externalOrderId: '9401', orderDate: new Date('2025-06-01T06:00:00Z') });
    const early = await api('POST', '/api/v1/orders/SHP-DATE-1/invoice', { token, json: { email: false, kind: 'credit' } });
    assert.equal(early.status, 400, JSON.stringify(early.body));
    assert.match(early.body.message, /invoice/i);

    const first = await api('POST', '/api/v1/orders/SHP-DATE-1/invoice', { token, json: { email: false } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const issued = (await saved(tenantId, 'SHP-DATE-1')).invoiceGeneratedAt;
    assert.ok(issued);
    const firstPdf = Buffer.from(first.body.data.invoicePdf, 'base64').toString('latin1');
    assert.ok(!firstPdf.includes('Invoice Date: Jun 1, 25'), 'the first PDF shows the issue date, not the order date');

    await new Promise((resolve) => setTimeout(resolve, 20));
    await api('POST', '/api/v1/orders/SHP-DATE-1/invoice', { token, json: { email: false } });
    assert.equal((await saved(tenantId, 'SHP-DATE-1')).invoiceGeneratedAt.getTime(), issued.getTime());

    const note = await api('POST', '/api/v1/orders/SHP-DATE-1/invoice', { token, json: { email: false, kind: 'credit' } });
    assert.equal(note.status, 200, JSON.stringify(note.body));
    const after = await saved(tenantId, 'SHP-DATE-1');
    assert.equal(after.invoiceGeneratedAt.getTime(), issued.getTime());
    assert.ok(after.creditNoteGeneratedAt);
    assert.ok(Buffer.from(note.body.data.invoicePdf, 'base64').toString('latin1').includes('Credit Note Date:'));
  });

  test('an issued invoice is frozen: a later price, rate or state change does not alter the re-download or the credit note', async () => {
    const Order = require('../src/models/Order');
    const { tenantId, token } = await shop('Freeze shop');
    await makeOrder(tenantId, { orderNo: 'SHP-FRZ-1', externalOrderId: '9501' });
    const first = await api('POST', '/api/v1/orders/SHP-FRZ-1/invoice', { token, json: { email: false } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const firstPdf = Buffer.from(first.body.data.invoicePdf, 'base64').toString('latin1');
    assert.match(firstPdf, /1,050\.00|1050\.00/);

    await Order.updateOne({ tenantId, orderNo: 'SHP-FRZ-1' }, {
      $set: { total: 2000, shipState: 'Maharashtra', items: [{ name: 'Dupatta', sku: 'D1', qty: 1, price: 2000, gst: 18, hsn: '5407' }] },
    }).setOptions({ skipTenantFilter: true });

    const again = await api('POST', '/api/v1/orders/SHP-FRZ-1/invoice', { token, json: { email: false } });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    const againPdf = Buffer.from(again.body.data.invoicePdf, 'base64').toString('latin1');
    assert.equal(again.body.data.invoiceNo, first.body.data.invoiceNo);
    assert.match(againPdf, /1,050\.00|1050\.00/);
    assert.doesNotMatch(againPdf, /2,000\.00|2000\.00/);
    assert.doesNotMatch(againPdf, /Maharashtra/);
    assert.match(again.body.data.invoiceHtml, /1,050/);

    const note = await api('POST', '/api/v1/orders/SHP-FRZ-1/invoice', { token, json: { email: false, kind: 'credit' } });
    assert.equal(note.status, 200, JSON.stringify(note.body));
    const notePdf = Buffer.from(note.body.data.invoicePdf, 'base64').toString('latin1');
    assert.match(notePdf, /1,050\.00|1050\.00/);
    assert.doesNotMatch(notePdf, /2,000\.00|2000\.00/);

    const gstinChange = await api('POST', '/api/v1/orders/SHP-FRZ-1/invoice', { token, json: { email: false, customerGstin: '07AAQCP4784P1ZB' } });
    assert.equal(gstinChange.status, 200, JSON.stringify(gstinChange.body));
    const gstinPdf = Buffer.from(gstinChange.body.data.invoicePdf, 'base64').toString('latin1');
    assert.match(gstinPdf, /07AAQCP4784P1ZB/, 'a buyer GSTIN can still be added to the issued invoice');
    assert.match(gstinPdf, /1,050\.00|1050\.00/, 'adding the GSTIN does not unfreeze the amounts');
  });

  test('Myntra and Amazon orders issue their own tax invoice, so OMS refuses to invoice them', async () => {
    const { tenantId, token } = await shop('Market shop');
    await makeOrder(tenantId, { orderNo: 'MYN-1', channel: 'Myntra', externalOrderId: 'M1' });
    await makeOrder(tenantId, { orderNo: 'AMZ-1', channel: 'Amazon', externalOrderId: 'A1' });
    for (const orderNo of ['MYN-1', 'AMZ-1']) {
      const res = await api('POST', `/api/v1/orders/${orderNo}/invoice`, { token, json: { email: false } });
      assert.equal(res.status, 400, `${orderNo}: ${JSON.stringify(res.body)}`);
      assert.match(res.body.message, /Myntra|Amazon/);
    }
  });
});
