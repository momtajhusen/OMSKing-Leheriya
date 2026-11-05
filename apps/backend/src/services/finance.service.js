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
  24: 'Gujarat', 26: 'Dadra and Nagar Haveli and Daman and Diu', 27: 'Maharashtra', 29: 'Karnataka', 30: 'Goa',
  31: 'Lakshadweep', 32: 'Kerala', 33: 'Tamil Nadu', 34: 'Puducherry', 35: 'Andaman and Nicobar Islands',
  36: 'Telangana', 37: 'Andhra Pradesh', 38: 'Ladakh',
};

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
  const code = Object.keys(GST_STATES).find((key) => [GST_STATES[key], ...(STATE_ALIASES[key] || [])]
    .some((name) => sameState(name, state)));
  return code ? String(code).padStart(2, '0') : '';
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
  const cgstPaise = intra ? Math.floor(taxPaise / 2) : 0;
  const sgstPaise = intra ? taxPaise - cgstPaise : 0;
  const igstPaise = intra ? 0 : taxPaise;
  return {
    rate,
    gross: fromPaise(grossPaise),
    taxable: fromPaise(taxablePaise),
    cgst: fromPaise(cgstPaise),
    sgst: fromPaise(sgstPaise),
    igst: fromPaise(igstPaise),
    intraState: intra,
  };
}

const FULFILLED = new Set(['Dispatched', 'Delivered']);

function paymentStanding(order) {
  if (String(order.paymentStatus || '') === 'paid') return { standing: 'paid', label: 'Paid', paid: true };
  const cod = /cod|cash on delivery|partial/i.test(String(order.paymentMode || ''));
  if (order.channel === 'Shopify' && cod) {
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

function num(row, keys) {
  return money(first(row, keys).replace(/[,₹]/g, ''));
}

function matchSettlement(orders, csv, { source = 'amazon' } = {}) {
  const rows = parseCsv(csv);
  const used = new Set();
  return rows.map((row) => {
    const key = first(row, ['order', 'orderid', 'orderno', 'amazonorderid', 'externalorderid', 'orderid']);
    const order = (orders || []).find((item) => !used.has(item.orderNo) && (item.orderNo === key || item.externalOrderId === key || item.id === key));
    const gross = num(row, ['gross', 'ordervalue', 'sale']) || money(order?.total);
    const parts = {
      gross,
      commission: num(row, ['commission']),
      shipping: num(row, ['shipping', 'shippingfee']),
      fees: num(row, ['fees', 'fee', 'closingfee']),
      tcs: num(row, ['tcs']),
      tds: num(row, ['tds']),
      refunds: num(row, ['refunds', 'refund']),
    };
    const expected = expectedNet(parts);
    const stated = first(row, ['net', 'expectednet', 'settlement']);
    const net = stated === '' ? expected : money(stated.replace(/[,₹]/g, ''));
    if (!order) {
      return { source, key, status: 'exception', label: 'Exception', exception: 'No Master Order for this settlement line', expected, net };
    }
    used.add(order.orderNo);
    if (Math.abs(net - expected) > 0.5) {
      return { source, orderNo: order.orderNo, key, status: 'exception', label: 'Exception', exception: 'Net does not match gross minus commission, shipping, fees, TCS/TDS and refunds', expected, net };
    }
    return { source, orderNo: order.orderNo, key, status: 'matched', label: 'Payment Received', exception: '', expected, net };
  });
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

function matchCourierBill(csv) {
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
    if (!declared) return { ...base, status: 'exception', exception: 'Declared weight is missing' };
    if (charged > declared) return { ...base, status: 'exception', exception: 'Charged weight is higher than the declared weight' };
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
  sameState,
  shipToState,
  lineTax,
  paymentStanding,
  expectedNet,
  parseCsv,
  reconciliationQueue,
  matchSettlement,
  matchReturnFile,
  matchCourierBill,
};
