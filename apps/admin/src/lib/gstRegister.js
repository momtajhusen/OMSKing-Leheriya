import { channelIssuesInvoice } from './channelInvoice.js';
import { isCancelled, istDate, istMonth } from './orderMetrics.js';

// Same table and rules as apps/backend/src/services/finance.service.js; gstRegister.test.js compares both.
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
const LEGACY_STATE_CODES = new Set(['25', '28']);
const STATE_ALIASES = {
  '01': ['JK'], '02': ['HP'], '03': ['PB'], '04': ['CH'], '05': ['UK', 'UT', 'Uttaranchal'], '06': ['HR'],
  '07': ['DL', 'New Delhi', 'NCT of Delhi', 'National Capital Territory of Delhi'], '08': ['RJ'], '09': ['UP'],
  10: ['BR'], 11: ['SK'], 12: ['AR'], 13: ['NL'], 14: ['MN'], 15: ['MZ'], 16: ['TR'], 17: ['ML'], 18: ['AS'],
  19: ['WB'], 20: ['JH'], 21: ['OR', 'OD', 'Orissa'], 22: ['CG', 'CT'], 23: ['MP'], 24: ['GJ'],
  26: ['DH', 'DN', 'DD', 'Daman and Diu', 'Dadra and Nagar Haveli'], 27: ['MH'], 29: ['KA'], 30: ['GA'],
  31: ['LD'], 32: ['KL'], 33: ['TN'], 34: ['PY', 'Pondicherry'], 35: ['AN'], 36: ['TS', 'TG'], 37: ['AP'], 38: ['LA'],
};

const normState = (value) => String(value || '').toLowerCase().replace(/[^a-z]/g, '');
const sameState = (a, b) => {
  const clean = (value) => normState(value).replace(/and/g, '');
  return Boolean(clean(a)) && clean(a) === clean(b);
};

export function gstStateCode(state) {
  const code = Object.keys(GST_STATES).find((key) => !LEGACY_STATE_CODES.has(key)
    && [GST_STATES[key], ...(STATE_ALIASES[key] || [])].some((name) => sameState(name, state)));
  return code ? String(code).padStart(2, '0') : '';
}

export function stateKey(state) {
  return gstStateCode(state) || normState(state);
}

export function gstinState(gstin) {
  return GST_STATES[String(gstin || '').trim().slice(0, 2)] || '';
}

export function shipToState(order) {
  if (order?.shipState) return String(order.shipState).trim();
  const parts = String(order?.city || '').split(',').map((part) => part.replace(/\b\d{6}\b/, '').trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/** Seller state like the invoice PDF: the order's warehouse, else WH-001, else the GSTIN state. */
export function sellerStateOf(order, warehouses = [], gstin = '') {
  const byCode = (code) => warehouses.find((row) => row.code === code)?.address?.state || '';
  return (order?.warehouseCode && byCode(order.warehouseCode)) || byCode('WH-001') || gstinState(gstin);
}

const toPaise = (value) => Math.round((Number(value) || 0) * 100);

/** Paise maths identical to the backend lineTax, so the register matches the PDF to the paisa. */
export function lineTax(item, { warehouseState = '', shipState = '' } = {}) {
  const rate = Number(item?.gst) || 0;
  const qty = Math.max(0, Number(item?.qty) || 0) || 1;
  const grossPaise = toPaise(item?.price) * qty;
  const taxablePaise = rate ? Math.round((grossPaise * 100) / (100 + rate)) : grossPaise;
  const taxPaise = grossPaise - taxablePaise;
  const from = stateKey(warehouseState);
  const intra = Boolean(from) && from === stateKey(shipState);
  const halfPaise = intra ? Math.round(taxPaise / 2) : 0;
  const igstPaise = intra ? 0 : taxPaise;
  return {
    rate,
    rateMissing: !(rate > 0),
    gross: grossPaise / 100,
    taxable: (grossPaise - halfPaise * 2 - igstPaise) / 100,
    cgst: halfPaise / 100,
    sgst: halfPaise / 100,
    igst: igstPaise / 100,
    intraState: intra,
  };
}

export function orderTax(order, warehouseState) {
  const shipState = shipToState(order);
  const sum = { taxable: 0, cgst: 0, sgst: 0, igst: 0, gross: 0 };
  let rateMissing = false;
  let intraState = false;
  (order?.items || []).forEach((item) => {
    const tax = lineTax(item, { warehouseState, shipState });
    Object.keys(sum).forEach((key) => { sum[key] += toPaise(tax[key]); });
    rateMissing = rateMissing || tax.rateMissing;
    intraState = tax.intraState;
  });
  const out = Object.fromEntries(Object.entries(sum).map(([key, paise]) => [key, paise / 100]));
  return { ...out, gst: (sum.cgst + sum.sgst + sum.igst) / 100, intraState, rateMissing, warehouseState, shipState };
}

export function invoiceNoOf(order) {
  return order?.invoiceNo || (order?.channelLines || []).find((line) => line.invoiceNumber)?.invoiceNumber || '';
}

/** Invoice date for OMS invoices, else the order date. */
export function registerDate(order) {
  return order?.invoiceGeneratedAt || order?.createdAt || '';
}

/** A credit note is due only when an OMS invoice was issued and the sale was then reversed; marketplaces issue their own. */
export function creditNoteDue(order) {
  if (!order?.invoiceGeneratedAt || channelIssuesInvoice(order)) return false;
  return isCancelled(order) || Boolean(order.reversePickup?.returnId) || order.channelStatus === 'RTO';
}

export function inPeriod(order, { from = '', to = '' } = {}) {
  const month = istMonth(registerDate(order));
  if (!month) return !from && !to;
  const [lo, hi] = from && to && from > to ? [to, from] : [from, to];
  return (!lo || month >= lo) && (!hi || month <= hi);
}

export function registerGroups(orders, { warehouses = [], gstin = '', from = '', to = '' } = {}) {
  const rows = (orders || [])
    .filter((order) => inPeriod(order, { from, to }))
    .map((order) => {
      const invoiceNo = invoiceNoOf(order);
      return {
        order,
        invoiceNo,
        date: istDate(registerDate(order)),
        tax: orderTax(order, sellerStateOf(order, warehouses, gstin)),
        creditNote: creditNoteDue(order) ? `CN-${invoiceNo || order.externalOrderId || order.id}` : '',
      };
    })
    .sort((a, b) => new Date(registerDate(b.order)).getTime() - new Date(registerDate(a.order)).getTime());
  return {
    invoiced: rows.filter((row) => row.invoiceNo && !isCancelled(row.order)),
    pending: rows.filter((row) => !row.invoiceNo && !channelIssuesInvoice(row.order) && ['Dispatched', 'Delivered'].includes(row.order.status)),
    notes: rows.filter((row) => row.creditNote),
  };
}

export function registerTotals(list) {
  return list.reduce((acc, row) => {
    if (row.tax.rateMissing) {
      acc.rateMissing += 1;
      return acc;
    }
    acc.taxable = (toPaise(acc.taxable) + toPaise(row.tax.taxable)) / 100;
    acc.gst = (toPaise(acc.gst) + toPaise(row.tax.gst)) / 100;
    return acc;
  }, { taxable: 0, gst: 0, rateMissing: 0 });
}
