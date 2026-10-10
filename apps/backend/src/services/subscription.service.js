const Tenant = require('../models/Tenant');
const Order = require('../models/Order');
const SubscriptionPayment = require('../models/SubscriptionPayment');
const QRCode = require('qrcode');
const { HttpError } = require('../utils/httpError');
const { decryptObject } = require('../lib/secretBox');
const { ensurePricing, present, quoteOrders, paymentPublic, payLine, upiPayUrl } = require('./pricing.service');
const { verifyCheckoutSignature, verifyWebhookSignature, createRazorpayOrder, fetchRazorpayPayment } = require('./razorpay.service');

function periodKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthName(date = new Date()) {
  return date.toLocaleString('en-IN', { month: 'long' });
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function daysLeft(value) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86400000));
}

function rupee(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN')}`;
}

function planLabel(plan) {
  const name = String(plan || 'starter');
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function paySentence(payment) {
  const line = payLine(payment);
  if (!line) return 'OMSKing has not added payment details yet. Contact the platform admin.';
  return `Pay ${line}.`;
}

function subscriptionMessage({ status, plan, planExpiresAt, orders, bill, payment, paid, submitted, periodDate = new Date() }) {
  const name = planLabel(plan);
  const month = monthName(periodDate);
  const due = `${month} bill is ${rupee(bill)} for ${orders} order${orders === 1 ? '' : 's'}. ${paySentence(payment)}`;
  if (status === 'suspended') {
    return 'This company is suspended. Contact OMSKing to restore access.';
  }
  if (paid) {
    return `${month} is paid (${rupee(paid.amount)}, recorded ${formatDate(paid.paidAt)}). ${orders} order${orders === 1 ? '' : 's'} this month.`;
  }
  if (submitted) {
    return `${month} UPI reference ${submitted.note || 'received'} is with OMSKing. This month shows Paid after they confirm it.`;
  }
  if (status === 'expired') {
    const ended = formatDate(planExpiresAt);
    return `This trial ended${ended ? ` on ${ended}` : ''}. ${due} Sign-in opens after the platform marks the payment received.`;
  }
  if (status === 'trial') {
    const left = daysLeft(planExpiresAt);
    const until = formatDate(planExpiresAt);
    const when = until ? `ends on ${until}` : 'is running';
    const count = left == null ? '' : ` (${left} day${left === 1 ? '' : 's'} left)`;
    return `${name} trial ${when}${count}. ${due}`;
  }
  return due;
}

async function monthOrders(tenantId) {
  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  const docs = await Order.find({ tenantId, createdAt: { $gte: start } })
    .select('channel status')
    .setOptions({ allowCrossTenant: true })
    .lean();
  const byChannel = new Map();
  let orders = 0;
  let cancelled = 0;
  for (const doc of docs) {
    const channel = String(doc.channel || 'Other');
    const isCancelled = String(doc.status || '').toLowerCase() === 'cancelled';
    const entry = byChannel.get(channel) || { channel, orders: 0, cancelled: 0 };
    if (isCancelled) {
      entry.cancelled += 1;
      cancelled += 1;
    } else {
      entry.orders += 1;
      orders += 1;
    }
    byChannel.set(channel, entry);
  }
  const lines = [...byChannel.values()].sort((a, b) => b.orders - a.orders || a.channel.localeCompare(b.channel));
  return { orders, cancelled, lines };
}

async function viewFor(tenant, pricing, paidRow) {
  const source = await monthOrders(tenant._id);
  const quote = quoteOrders(source.orders, pricing);
  const expired = tenant.status === 'trial' && tenant.planExpiresAt && new Date(tenant.planExpiresAt) < new Date();
  const standing = tenant.status === 'suspended' ? 'suspended' : expired ? 'expired' : tenant.status;
  const payment = paymentPublic(pricing);
  const settled = paidRow && paidRow.status !== 'submitted' ? paidRow : null;
  const pending = paidRow && paidRow.status === 'submitted' ? paidRow : null;
  const paid = settled ? { amount: settled.amount, paidAt: settled.paidAt, note: settled.note || '' } : null;
  const submitted = pending ? { note: pending.note || '' } : null;
  const message = subscriptionMessage({
    status: standing,
    plan: tenant.plan,
    planExpiresAt: tenant.planExpiresAt,
    orders: quote.orders,
    bill: quote.bill,
    payment,
    paid,
    submitted,
  });
  return {
    tenantId: String(tenant._id),
    name: tenant.name,
    plan: tenant.plan,
    status: standing,
    planExpiresAt: tenant.planExpiresAt || null,
    daysLeft: daysLeft(tenant.planExpiresAt),
    period: periodKey(),
    orders: quote.orders,
    rate: quote.rate,
    usage: quote.usage,
    adjustment: quote.adjustment,
    bill: quote.bill,
    minimumMonthly: quote.minimumMonthly,
    cancelled: source.cancelled,
    billNo: `SUB-${periodKey()}-${String(tenant._id).slice(-6).toUpperCase()}`,
    lines: source.lines.map((line) => ({
      channel: line.channel,
      orders: line.orders,
      cancelled: line.cancelled,
      amount: Math.round(line.orders * quote.rate * 100) / 100,
    })),
    monthStatus: paid ? 'paid' : submitted ? 'submitted' : standing === 'trial' || standing === 'expired' ? 'trial' : 'due',
    paidAt: paid?.paidAt || null,
    reference: submitted?.note || '',
    payment,
    message,
    tone: standing === 'suspended' || standing === 'expired' || submitted || (!paid && standing === 'active') ? 'warn' : 'ok',
  };
}

function periodLabel(period) {
  const [year, month] = String(period || '').split('-').map(Number);
  if (!year || !month) return String(period || '');
  return new Date(year, month - 1, 1).toLocaleString('en-IN', { month: 'long', year: 'numeric' });
}

function slabPosition(orders, slabs) {
  const index = slabs.findIndex((row) => row.upTo == null || orders <= row.upTo);
  const current = slabs[Math.max(index, 0)] || null;
  const next = index >= 0 ? slabs[index + 1] || null : null;
  return {
    currentSlab: current?.label || '',
    nextSlab: next ? { label: next.label, rate: next.rate, startsAfter: current?.upTo || 0 } : null,
  };
}

async function mySubscription(tenant) {
  if (!tenant || tenant.kind !== 'merchant') throw new HttpError(400, 'Open a company to see its subscription');
  const pricing = await ensurePricing();
  const paid = await SubscriptionPayment.findOne({ tenantId: tenant._id, period: periodKey() }).setOptions({ skipTenantFilter: true });
  const view = await viewFor(tenant, pricing, paid);
  const card = present(pricing);
  const position = slabPosition(view.orders, card.slabs);
  const history = await SubscriptionPayment.find({ tenantId: tenant._id })
    .sort({ period: -1 })
    .limit(24)
    .setOptions({ skipTenantFilter: true });
  return {
    ...view,
    periodLabel: periodLabel(view.period),
    startedAt: tenant.createdAt || null,
    slabs: card.slabs,
    ...position,
    history: history.map((row) => ({
      period: row.period,
      periodLabel: periodLabel(row.period),
      orders: row.orders,
      amount: row.amount,
      note: row.note || '',
      status: row.status,
      paidAt: row.paidAt,
    })),
  };
}

async function listSubscriptions() {
  const pricing = await ensurePricing();
  const period = periodKey();
  const tenants = await Tenant.find({ kind: 'merchant' }).sort({ name: 1 });
  const payments = await SubscriptionPayment.find({ period }).setOptions({ skipTenantFilter: true });
  const byTenant = new Map(payments.map((row) => [String(row.tenantId), row]));
  const rows = [];
  for (const tenant of tenants) {
    rows.push(await viewFor(tenant, pricing, byTenant.get(String(tenant._id))));
  }
  return { period, payment: paymentPublic(pricing), rows };
}

async function recordSubscriptionPayment(tenantId, body = {}) {
  const tenant = await Tenant.findById(tenantId);
  if (!tenant || tenant.kind !== 'merchant') throw new HttpError(404, 'Tenant not found');
  const pricing = await ensurePricing();
  const orders = (await monthOrders(tenant._id)).orders;
  const quote = quoteOrders(orders, pricing);
  const amount = body.amount == null || body.amount === '' ? quote.bill : Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new HttpError(400, 'Enter the amount received');
  const period = periodKey();
  let row = await SubscriptionPayment.findOne({ tenantId: tenant._id, period }).setOptions({ skipTenantFilter: true });
  if (!row) {
    row = new SubscriptionPayment({ tenantId: tenant._id, period });
  }
  row.orders = orders;
  row.amount = amount;
  row.status = 'paid';
  if (body.note != null && String(body.note).trim()) row.note = String(body.note).trim().slice(0, 280);
  row.paidAt = new Date();
  if (body.razorpayPaymentId) {
    const paymentId = String(body.razorpayPaymentId);
    const taken = await SubscriptionPayment.findOne({ razorpayPaymentId: paymentId }).setOptions({ skipTenantFilter: true });
    if (taken && String(taken.tenantId) !== String(tenant._id)) throw new HttpError(400, 'This payment is already used');
    row.razorpayPaymentId = paymentId;
  }
  await row.save();
  if (tenant.status === 'trial') {
    tenant.status = 'active';
    const end = new Date();
    end.setMonth(end.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    tenant.planExpiresAt = end;
    await tenant.save();
  }
  return viewFor(tenant, pricing, row);
}

async function expiredTrialMessage(tenant) {
  const pricing = await ensurePricing();
  const orders = (await monthOrders(tenant._id)).orders;
  const quote = quoteOrders(orders, pricing);
  return subscriptionMessage({
    status: 'expired',
    plan: tenant.plan,
    planExpiresAt: tenant.planExpiresAt,
    orders: quote.orders,
    bill: quote.bill,
    payment: paymentPublic(pricing),
    paid: null,
  });
}

function assertOpenCompany(tenant) {
  if (!tenant || tenant.kind !== 'merchant') throw new HttpError(400, 'Open a company to pay its subscription');
  if (tenant.status === 'suspended') throw new HttpError(403, 'This company is suspended');
}

async function billNow(tenant) {
  const pricing = await ensurePricing();
  const orders = (await monthOrders(tenant._id)).orders;
  const quote = quoteOrders(orders, pricing);
  const period = periodKey();
  const row = await SubscriptionPayment.findOne({ tenantId: tenant._id, period }).setOptions({ skipTenantFilter: true });
  return { pricing, quote, period, row };
}

async function upiCheckout(tenant) {
  assertOpenCompany(tenant);
  const { pricing, quote, period, row } = await billNow(tenant);
  const payment = pricing.payment || {};
  const razorpayReady = Boolean(payment.razorpayKeyId && payment.razorpayKeySecretEnc);
  const monthStatus = row?.status === 'paid' ? 'paid' : row?.status === 'submitted' ? 'submitted' : 'due';
  if (!payment.upiId && !razorpayReady) {
    return { ready: false, amount: quote.bill, period, periodLabel: periodLabel(period), monthStatus };
  }
  const note = `OMSKing ${periodLabel(period)}`.slice(0, 80);
  const upiUrl = payment.upiId
    ? upiPayUrl({ upiId: payment.upiId, payeeName: payment.accountName || 'OMSKing', amount: quote.bill, note })
    : '';
  const qr = upiUrl ? await QRCode.toDataURL(upiUrl, { margin: 1, width: 280, errorCorrectionLevel: 'M' }) : '';
  return {
    ready: true,
    amount: quote.bill,
    period,
    periodLabel: periodLabel(period),
    monthStatus,
    reference: row?.status === 'submitted' ? row.note || '' : '',
    upiId: payment.upiId || '',
    payeeName: payment.accountName || 'OMSKing',
    payNote: payment.note || '',
    upiUrl,
    qr,
    razorpayReady,
    company: tenant.name,
    description: `OMSKing subscription ${periodLabel(period)}`,
  };
}

async function startRazorpayCheckout(tenant, deps = {}) {
  assertOpenCompany(tenant);
  const { pricing, quote, period, row } = await billNow(tenant);
  if (row?.status === 'paid') throw new HttpError(400, 'This month is already paid');
  if (quote.bill < 1) throw new HttpError(400, 'Nothing to pay this month');
  const payment = pricing.payment || {};
  const secret = decryptObject(payment.razorpayKeySecretEnc || '').secret;
  if (!payment.razorpayKeyId || !secret) {
    throw new HttpError(400, 'Automatic UPI is not turned on. Pay the UPI id, then enter the reference.');
  }
  const order = await createRazorpayOrder({
    keyId: payment.razorpayKeyId,
    keySecret: secret,
    amountPaise: Math.round(quote.bill * 100),
    receipt: `sub${String(tenant._id).slice(-8)}${period.replace('-', '')}`.slice(0, 40),
    notes: { tenantId: String(tenant._id), period, purpose: 'subscription' },
    fetchImpl: deps.fetchImpl,
  });
  return {
    keyId: payment.razorpayKeyId,
    orderId: order.id,
    amount: order.amount,
    currency: 'INR',
    company: tenant.name,
    description: `OMSKing subscription ${periodLabel(period)}`,
  };
}

async function confirmRazorpayCheckout(tenant, body = {}, deps = {}) {
  assertOpenCompany(tenant);
  const orderId = String(body.razorpay_order_id || '');
  const paymentId = String(body.razorpay_payment_id || '');
  const signature = String(body.razorpay_signature || '');
  if (!orderId || !paymentId || !signature) throw new HttpError(400, 'Payment confirmation is incomplete');
  const pricing = await ensurePricing();
  const payment = pricing.payment || {};
  const secret = decryptObject(payment.razorpayKeySecretEnc || '').secret;
  if (!secret || !verifyCheckoutSignature(orderId, paymentId, signature, secret)) {
    throw new HttpError(400, 'Payment could not be verified');
  }
  const remote = await fetchRazorpayPayment({
    keyId: payment.razorpayKeyId,
    keySecret: secret,
    paymentId,
    fetchImpl: deps.fetchImpl,
  });
  const notes = remote.notes || {};
  if (remote.order_id !== orderId || !['captured', 'authorized'].includes(remote.status)) {
    throw new HttpError(400, 'The UPI payment is not complete');
  }
  if (String(notes.tenantId) !== String(tenant._id) || notes.purpose !== 'subscription' || notes.period !== periodKey()) {
    throw new HttpError(400, 'This payment is not for this subscription');
  }
  return recordSubscriptionPayment(tenant._id, {
    amount: Number(remote.amount) / 100,
    note: paymentId,
    razorpayPaymentId: paymentId,
  });
}

async function submitUpiReference(tenant, reference) {
  assertOpenCompany(tenant);
  const ref = String(reference || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{6,22}$/.test(ref)) throw new HttpError(400, 'Enter the UPI reference from your payment app');
  const { pricing, quote, period, row } = await billNow(tenant);
  if (!pricing.payment?.upiId) throw new HttpError(400, 'UPI is not configured yet');
  if (row?.status === 'paid') throw new HttpError(400, 'This month is already paid');
  const doc = row || new SubscriptionPayment({ tenantId: tenant._id, period });
  doc.orders = quote.orders;
  doc.amount = quote.bill;
  doc.status = 'submitted';
  doc.note = ref;
  await doc.save();
  return viewFor(tenant, pricing, doc);
}

async function applyRazorpayWebhook(req) {
  const pricing = await ensurePricing();
  const secret = decryptObject(pricing.payment?.razorpayWebhookSecretEnc || '').secret;
  if (!secret) throw new HttpError(503, 'Razorpay webhook secret is not saved');
  if (!req.rawBody || !verifyWebhookSignature(req.rawBody, req.headers['x-razorpay-signature'], secret)) {
    throw new HttpError(400, 'Invalid Razorpay signature');
  }
  const event = JSON.parse(req.rawBody.toString('utf8'));
  if (event.event !== 'payment.captured') return { ignored: true };
  const entity = event.payload?.payment?.entity || {};
  const notes = entity.notes || {};
  if (entity.status !== 'captured' || notes.purpose !== 'subscription' || !notes.tenantId || notes.period !== periodKey()) {
    return { ignored: true };
  }
  const duplicate = await SubscriptionPayment.findOne({ razorpayPaymentId: entity.id }).setOptions({ skipTenantFilter: true });
  if (duplicate) return { ignored: true, already: true };
  const tenant = await Tenant.findById(notes.tenantId);
  if (!tenant || tenant.kind !== 'merchant' || tenant.status === 'suspended') return { ignored: true };
  const view = await recordSubscriptionPayment(tenant._id, {
    amount: Number(entity.amount) / 100,
    note: entity.id,
    razorpayPaymentId: entity.id,
  });
  return { ignored: false, tenantId: view.tenantId, period: view.period };
}

module.exports = {
  subscriptionMessage,
  mySubscription,
  listSubscriptions,
  recordSubscriptionPayment,
  expiredTrialMessage,
  upiCheckout,
  startRazorpayCheckout,
  confirmRazorpayCheckout,
  submitUpiReference,
  applyRazorpayWebhook,
};
