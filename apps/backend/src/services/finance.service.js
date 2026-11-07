const { isPaid } = require('../utils/payment');

function toPaise(value) {
  return Math.round((Number(value) || 0) * 100);
}

function fromPaise(paise) {
  const n = Math.trunc(Number(paise) || 0);
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  return sign * (Math.trunc(abs / 100) + (abs % 100) / 100);
}

function money(value) {
  return fromPaise(toPaise(value));
}

function addMoney(...values) {
  return fromPaise(values.reduce((sum, value) => sum + toPaise(value), 0));
}

function normState(value) {
  return String(value || '').toLowerCase().replace(/[^a-z]/g, '');
}

const GST_STATES = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', 10: 'Bihar', 11: 'Sikkim',
  12: 'Arunachal Pradesh', 13: 'Nagaland', 14: 'Manipur', 15: 'Mizoram', 16: 'Tripura', 17: 'Meghalaya',
  18: 'Assam', 19: 'West Bengal', 20: 'Jharkhand', 21: 'Odisha', 22: 'Chhattisgarh', 23: 'Madhya Pradesh',
  24: 'Gujarat', 25: 'Daman and Diu', 26: 'Dadra and Nagar Haveli and Daman and Diu', 27: 'Maharashtra',
  28: 'Andhra Pradesh (Old)', 29: 'Karnataka', 30: 'Goa',
  31: 'Lakshadweep', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry', 35: 'Andaman and Nicobar Islands',
  36: 'Telangana', 37: 'Andhra Pradesh', 38: 'Ladakh', 97: 'Other Territory',
};

// Pre-merger codes: kept for reading old GSTINs, never picked for a state name.
const LEGACY_STATE_CODES = new Set(['25', '28']);

function gstinState(gstin) {
  return GST_STATES[String(gstin || '').trim().slice(0, 2)] || '';
}

function sameState(a, b) {
  const clean = (value) => normState(value).replace(/and/g, '');
  return Boolean(clean(a)) && clean(a) === clean(b);
}

const STATE_ALIASES = {
  '01': ['JK'], '02': ['HP'], '03': ['PB'], '04': ['CH'], '05': ['UK', 'UT', 'Uttaranchal'], '06': ['HR'],
  '07': ['DL', 'New Delhi', 'NCT of Delhi', 'National Capital Territory of Delhi'], '08': ['RJ'], '09': ['UP'],
  10: ['BR'], 11: ['SK'], 12: ['AR'], 13: ['NL'], 14: ['MN'], 15: ['MZ'], 16: ['TR'], 17: ['ML'], 18: ['AS'],
  19: ['WB'], 20: ['JH'], 21: ['OR', 'OD', 'Orissa'], 22: ['CG', 'CT'], 23: ['MP'], 24: ['GJ'],
  26: ['DH', 'DN', 'DD', 'Daman and Diu', 'Dadra and Nagar Haveli'], 27: ['MH'], 29: ['KA'], 30: ['GA'],
  31: ['LD'], 32: ['KL'], 33: ['TN'], 34: ['PY', 'Pondicherry'], 35: ['AN'], 36: ['TS', 'TG'], 37: ['AP'], 38: ['LA'],
};

function gstStateCode(state) {
  const code = Object.keys(GST_STATES).find((key) => !LEGACY_STATE_CODES.has(key)
    && [GST_STATES[key], ...(STATE_ALIASES[key] || [])].some((name) => sameState(name, state)));
  return code ? String(code).padStart(2, '0') : '';
}

function stateName(code) {
  return GST_STATES[String(code || '')] || GST_STATES[Number(code)] || '';
}

function stateKey(state) {
  return gstStateCode(state) || normState(state);
}

function invoiceNumber(order) {
  if (String(order.channel || '') === 'Shopify') {
    return String(order.channelOrderNo || '').replace(/^#/, '').trim() || order.externalOrderId || order.orderNo || '';
  }
  return order.invoiceNo || (order.orderNo ? `INV-${order.orderNo}` : '');
}

function creditNoteNumber(order) {
  const invoice = invoiceNumber(order);
  return invoice ? `CN-${invoice}` : '';
}

function shipToState(order) {
  if (order.shipState) return String(order.shipState).trim();
  const parts = String(order.city || '').split(',').map((part) => part.replace(/\b\d{6}\b/, '').trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function lineTax(item, { warehouseState = '', shipState = '' } = {}) {
  const rate = Number(item.gst) || 0;
  const qty = Math.max(0, Number(item.qty) || 0) || 1;
  const grossPaise = toPaise(item.price) * qty;
  const taxablePaise = rate ? Math.round((grossPaise * 100) / (100 + rate)) : grossPaise;
  const taxPaise = grossPaise - taxablePaise;
  const from = stateKey(warehouseState);
  const to = stateKey(shipState);
  const intra = Boolean(from) && from === to;
  const halfPaise = intra ? Math.round(taxPaise / 2) : 0;
  const igstPaise = intra ? 0 : taxPaise;
  return {
    rate,
    gross: fromPaise(grossPaise),
    taxable: fromPaise(grossPaise - halfPaise * 2 - igstPaise),
    cgst: fromPaise(halfPaise),
    sgst: fromPaise(halfPaise),
    igst: fromPaise(igstPaise),
    intraState: intra,
  };
}

function hasGstRate(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

/** Line rate > 0 wins; a 0 or empty line rate is the schema default, so the Master SKU, then the product, decide. null = missing. */
function resolveLineRate(item, master, product) {
  if (Number(item?.gst) > 0) return Number(item.gst);
  const found = [master?.gstRatePercent, product?.gstRatePercent].find(hasGstRate);
  return found === undefined ? null : Number(found);
}

/** Order items plus a 'Shipping' line (GST-inclusive shippingCharge) taxed at the highest item rate. */
function invoiceItems(order) {
  const items = order.items || [];
  const shipping = toPaise(order.shippingCharge || 0);
  if (shipping <= 0) return items;
  const top = items.reduce((best, item) => ((Number(item.gst) || 0) > (Number(best?.gst) || 0) ? item : best), items[0]);
  return [...items, {
    name: 'Shipping', sku: 'SHIPPING', qty: 1, price: fromPaise(shipping), gst: Number(top?.gst) || 0, hsn: top?.hsn || '',
  }];
}

function invoiceTotals(order, { warehouseState = '', shipState } = {}) {
  const ship = shipState === undefined ? shipToState(order) : shipState;
  const lines = invoiceItems(order).map((item) => ({ item, tax: lineTax(item, { warehouseState, shipState: ship }) }));
  const paise = lines.reduce((acc, { tax }) => ({
    taxable: acc.taxable + toPaise(tax.taxable),
    cgst: acc.cgst + toPaise(tax.cgst),
    sgst: acc.sgst + toPaise(tax.sgst),
    igst: acc.igst + toPaise(tax.igst),
    gross: acc.gross + toPaise(tax.gross),
  }), { taxable: 0, cgst: 0, sgst: 0, igst: 0, gross: 0 });
  const totals = Object.fromEntries(Object.entries(paise).map(([key, value]) => [key, fromPaise(value)]));
  return { lines, totals, intraState: Boolean(lines[0]?.tax.intraState), shipState: ship };
}

const CHANNEL_INVOICED = new Set(['Myntra', 'Amazon']);

/** Myntra and Amazon issue the tax invoice for orders that came from their API. */
function channelIssuesInvoice(order) {
  return CHANNEL_INVOICED.has(String(order?.channel || '')) && ['channel_api', 'channel_push'].includes(order?.source);
}

const FULFILLED = new Set(['Dispatched', 'Delivered']);

function paymentStanding(order) {
  if (isPaid(order)) return { standing: 'paid', label: 'Paid', paid: true };
  const shopifyCod = order.channel === 'Shopify' && /cod|cash on delivery/i.test(String(order.paymentMode || ''));
  if (shopifyCod || /partial/i.test(String(order.paymentMode || '')) || order.paymentStatus === 'partially_paid') {
    return { standing: 'partially_paid', label: 'Partially paid', paid: false };
  }
  return { standing: 'unpaid', label: 'Unpaid', paid: false };
}

function ageDays(order, now) {
  const stamp = new Date(order.orderDate || order.createdAt || 0);
  if (Number.isNaN(stamp.getTime())) return 0;
  return Math.floor((now.getTime() - stamp.getTime()) / 86400000);
}

function reconciliationQueue(orders, { now = new Date() } = {}) {
  return (orders || []).flatMap((order) => {
    if (order.status === 'Cancelled' || !FULFILLED.has(order.status)) return [];
    const standing = paymentStanding(order);
    if (order.channel === 'Shopify' && standing.paid) return [];
    const ageing = ageDays(order, now);
    return [{
      orderNo: order.orderNo || order.id,
      channel: order.channel,
      status: order.status,
      paid: standing.paid,
      paymentLabel: standing.label,
      ageing,
      flagged: !standing.paid && ageing > 30,
    }];
  });
}

function expectedNet({ gross = 0, commission = 0, shipping = 0, fees = 0, tcs = 0, tds = 0, refunds = 0 } = {}) {
  return money(gross - commission - shipping - fees - tcs - tds - refunds);
}

function splitCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (const char of String(line)) {
    if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((cell) => cell.toLowerCase().replace(/[\s_-]+/g, ''));
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    header.forEach((key, index) => { row[key] = cells[index] || ''; });
    return row;
  });
}

function first(row, keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== '') return String(row[key]).trim();
  }
  return '';
}

/** "₹1,234.50" → 1234.5; accounting brackets "(500)" → -500. */
function parseAmount(text) {
  const clean = String(text ?? '').replace(/[,₹\s]/g, '').replace(/^rs\.?/i, '');
  const bracket = clean.match(/^\((.*)\)$/);
  return money(bracket ? -Number(bracket[1]) : Number(clean));
}

function num(row, keys) {
  return parseAmount(first(row, keys));
}

const SETTLEMENT_ID_KEYS = ['order', 'orderid', 'orderno', 'amazonorderid', 'externalorderid', 'sellerorderid', 'packetid'];
const GROSS_KEYS = ['gross', 'ordervalue', 'sale'];
const NET_KEYS = ['net', 'expectednet', 'settlement'];
const DEDUCTION_KEYS = {
  commission: ['commission'],
  shipping: ['shipping', 'shippingfee'],
  fees: ['fees', 'fee', 'closingfee'],
  tcs: ['tcs'],
  tds: ['tds'],
  refunds: ['refunds', 'refund'],
};
const PAID_TOLERANCE_PAISE = 50;

function settlementIds(order) {
  return [order.orderNo, order.externalOrderId, order.id, order.channelOrderNo,
    ...(order.channelLines || []).flatMap((line) => [line.sellerOrderId, line.packetId])]
    .map((id) => String(id || '').trim())
    .filter(Boolean);
}

function settlementLine(row) {
  const line = {
    gross: first(row, GROSS_KEYS) === '' ? null : num(row, GROSS_KEYS),
    net: first(row, NET_KEYS) === '' ? null : num(row, NET_KEYS),
  };
  Object.entries(DEDUCTION_KEYS).forEach(([name, keys]) => { line[name] = num(row, keys); });
  line.deductionPaise = Object.keys(DEDUCTION_KEYS).reduce((sum, name) => sum + toPaise(line[name]), 0);
  return line;
}

/** All lines of one order (sale, fees, refunds, sub-orders) are summed, then checked against the order total. */
function settleOrder({ order, key, lines }, source) {
  const deductionPaise = lines.reduce((sum, line) => sum + line.deductionPaise, 0);
  const netPaise = lines.every((line) => line.net !== null) ? lines.reduce((sum, line) => sum + toPaise(line.net), 0) : null;
  let grossPaise = null;
  if (lines.some((line) => line.gross !== null)) grossPaise = lines.reduce((sum, line) => sum + toPaise(line.gross ?? 0), 0);
  else if (netPaise !== null) grossPaise = netPaise + deductionPaise;
  const base = {
    source,
    orderNo: order.orderNo,
    key,
    lines: lines.length,
    gross: grossPaise === null ? null : fromPaise(grossPaise),
    orderTotal: money(order.total),
    expected: grossPaise === null ? null : fromPaise(grossPaise - deductionPaise),
    net: netPaise === null ? null : fromPaise(netPaise),
  };
  const exception = (text) => ({ ...base, status: 'exception', label: 'Exception', exception: text });
  if (grossPaise !== null && grossPaise <= 0) return { ...base, status: 'refund', label: 'Refund line', exception: '' };
  if (netPaise === null) return exception('No net amount in the settlement file for this order');
  if (Math.abs(grossPaise - toPaise(order.total)) > PAID_TOLERANCE_PAISE) {
    return exception(`Amount mismatch: settlement gross ₹${base.gross} but the order total is ₹${base.orderTotal}`);
  }
  if (Math.abs(netPaise - (grossPaise - deductionPaise)) > PAID_TOLERANCE_PAISE) {
    return exception('Net does not match gross minus commission, shipping, fees, TCS/TDS and refunds');
  }
  return { ...base, status: 'matched', label: 'Payment Received', exception: '' };
}

function matchSettlement(orders, csv, { source = 'amazon', channel = '' } = {}) {
  const want = String(channel || '').toLowerCase();
  const byId = new Map();
  (orders || [])
    .filter((order) => !want || String(order.channel || '').toLowerCase() === want)
    .forEach((order) => settlementIds(order).forEach((id) => { if (!byId.has(id)) byId.set(id, order); }));
  const out = [];
  const groups = new Map();
  parseCsv(csv).forEach((row) => {
    const ids = SETTLEMENT_ID_KEYS.map((name) => first(row, [name])).filter(Boolean);
    const key = ids[0] || '';
    const order = ids.map((id) => byId.get(id)).find(Boolean);
    const line = settlementLine(row);
    if (!order) {
      out.push({
        source, key, status: 'exception', label: 'Exception', exception: 'No Master Order for this settlement line', expected: null, net: line.net,
      });
      return;
    }
    if (!groups.has(order.orderNo)) {
      const group = { order, key, lines: [] };
      groups.set(order.orderNo, group);
      out.push(group);
    }
    groups.get(order.orderNo).lines.push(line);
  });
  return out.map((item) => (item.lines ? settleOrder(item, source) : item));
}

function matchReturnFile(orders, csv) {
  const used = new Set();
  return parseCsv(csv).map((row) => {
    const key = first(row, ['order', 'orderno', 'orderid', 'return', 'returnid', 'externalorderid', 'amazonorderid']);
    const order = (orders || []).find((item) => !used.has(item.orderNo) && (item.orderNo === key || item.externalOrderId === key || item.id === key));
    if (!order) {
      return { key, status: 'exception', label: 'Exception', exception: 'No Master Order for this return line' };
    }
    used.add(order.orderNo);
    return { orderNo: order.orderNo, key, status: 'matched', label: 'Return Received', exception: '' };
  });
}

/** codByAwb: AWB → amount the courier had to collect for that order (0 for prepaid). */
function courierCodIssue(row, base, codByAwb) {
  if (!codByAwb.has(base.awb)) return '';
  const expected = money(codByAwb.get(base.awb));
  const collected = first(row, ['codamount', 'codcollected', 'collectableamount', 'codvalue']);
  if (collected !== '') {
    const billed = parseAmount(collected);
    return Math.abs(toPaise(billed) - toPaise(expected)) > PAID_TOLERANCE_PAISE
      ? `Billed COD amount ₹${billed} does not match the order COD amount ₹${expected}`
      : '';
  }
  return expected === 0 && base.cod > 0 ? 'COD charge billed on a prepaid order' : '';
}

function matchCourierBill(csv, { codByAwb = new Map() } = {}) {
  return parseCsv(csv).map((row) => {
    const awb = first(row, ['awb', 'waybill']);
    const charged = Number(first(row, ['chargedweight', 'chargeableweight'])) || 0;
    const declared = Number(first(row, ['declaredweight', 'deadweight'])) || 0;
    const amount = num(row, ['amount', 'total']);
    const base = {
      awb,
      chargedWeight: charged,
      declaredWeight: declared,
      cod: num(row, ['cod']),
      rto: num(row, ['rto']),
      ndr: num(row, ['ndr']),
      surcharge: num(row, ['surcharge']),
      amount,
    };
    if (!awb) return { ...base, status: 'exception', exception: 'AWB is missing' };
    const issues = [];
    if (!declared) issues.push('Declared weight is missing');
    else if (charged > declared) issues.push('Charged weight is higher than the declared weight');
    const codIssue = courierCodIssue(row, base, codByAwb);
    if (codIssue) issues.push(codIssue);
    if (issues.length) return { ...base, status: 'exception', exception: issues.join('; ') };
    return { ...base, status: 'matched', exception: '' };
  });
}

module.exports = {
  money,
  toPaise,
  fromPaise,
  addMoney,
  invoiceNumber,
  creditNoteNumber,
  gstinState,
  gstStateCode,
  stateName,
  sameState,
  shipToState,
  lineTax,
  hasGstRate,
  resolveLineRate,
  invoiceItems,
  invoiceTotals,
  channelIssuesInvoice,
  GST_STATES,
  STATE_ALIASES,
  paymentStanding,
  expectedNet,
  parseAmount,
  parseCsv,
  reconciliationQueue,
  matchSettlement,
  matchReturnFile,
  matchCourierBill,
};
