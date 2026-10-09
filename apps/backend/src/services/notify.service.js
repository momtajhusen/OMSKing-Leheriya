const Tenant = require('../models/Tenant');
const Vendor = require('../models/Vendor');
const NotificationDelivery = require('../models/NotificationDelivery');
const { encryptObject, decryptObject } = require('../lib/secretBox');

const EVENTS = [
  { id: 'NOT-001', email: false, telegram: false, whatsapp: false, other: false },
  { id: 'NOT-002', email: false, telegram: false, whatsapp: false, other: false },
  { id: 'NOT-003', email: false, telegram: false, whatsapp: false, other: false },
  { id: 'NOT-004', email: false, telegram: false, whatsapp: false, other: false },
  { id: 'NOT-005', email: false, telegram: false, whatsapp: false, other: false },
  { id: 'NOT-006', email: false, telegram: false, whatsapp: false, other: false },
  { id: 'NOT-007', email: false, telegram: false, whatsapp: false, other: false },
  { id: 'NOT-008', email: false, telegram: false, whatsapp: false, other: false },
  { id: 'NOT-010', email: false, telegram: false, whatsapp: false, other: false },
  { id: 'NOT-009', email: true, telegram: true, whatsapp: true, other: false, locked: true },
];

function skip(query) {
  return query.setOptions({ skipTenantFilter: true });
}

function defaultEvents() {
  return Object.fromEntries(EVENTS.map((row) => [row.id, { ...row }]));
}

function chatIdOf(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  const link = value.match(/t\.me\/([A-Za-z0-9_]+)/i);
  if (link) return `@${link[1]}`;
  return value;
}

function shipByOf(order, sub) {
  const lines = order.channelLines || [];
  const match = lines.find((line) => line.sku && line.sku === sub.sku && line.shipByTime)
    || lines.find((line) => line.shipByTime);
  if (!match?.shipByTime) return 'not set';
  const date = new Date(match.shipByTime);
  if (Number.isNaN(date.getTime())) return 'not set';
  return date.toISOString().slice(0, 10);
}

function assignText(order, sub) {
  return [
    'Vendor order',
    `Order: ${order.orderNo}`,
    `SKU: ${sub.sku || '—'}`,
    `Qty: ${sub.qty || 1}`,
    `Ship-by: ${shipByOf(order, sub)}`,
  ].join('\n');
}

function dedupeAssign(order, sub) {
  const vendor = String(sub.assignedVendor || '').trim().toLowerCase();
  return `vendor.assigned:${order.orderNo}:${sub.id}:${vendor}`;
}

async function loadTenant(tenantId) {
  return skip(Tenant.findById(tenantId));
}

function flagsOf(tenant) {
  const saved = tenant?.settings?.notifications?.events || {};
  const events = defaultEvents();
  for (const row of EVENTS) {
    if (row.locked) continue;
    const next = saved[row.id];
    if (!next) continue;
    events[row.id] = {
      ...events[row.id],
      telegram: Boolean(next.telegram),
      email: Boolean(next.email),
      whatsapp: Boolean(next.whatsapp),
      other: Boolean(next.other),
    };
  }
  return events;
}

function publicSettings(tenant) {
  const events = flagsOf(tenant);
  return {
    botConfigured: Boolean(tenant?.settings?.notifications?.botTokenEnc),
    ownerChatId: chatIdOf(tenant?.settings?.notifications?.ownerChatId),
    gmailUser: String(tenant?.settings?.mail?.gmailUser || ''),
    mailConfigured: Boolean(tenant?.settings?.mail?.gmailUser && tenant?.settings?.mail?.gmailAppPasswordEnc),
    whatsappTo: whatsappCreds(tenant).to,
    whatsappPhoneNumberId: String(tenant?.settings?.notifications?.whatsapp?.phoneNumberId || ''),
    whatsappConfigured: whatsappReady(tenant),
    events: EVENTS.map((row) => ({
      id: row.id,
      telegram: events[row.id].telegram,
      email: events[row.id].email,
      whatsapp: events[row.id].whatsapp,
      other: events[row.id].other,
      locked: Boolean(row.locked),
    })),
  };
}

function botTokenOf(tenant) {
  const enc = tenant?.settings?.notifications?.botTokenEnc;
  if (!enc) return '';
  return String(decryptObject(enc).token || '').trim();
}

function emailRecipient(tenant) {
  return String(tenant?.settings?.mail?.gmailUser || tenant?.legalEntity?.email || '').trim();
}

function whatsappCreds(tenant) {
  const wa = tenant?.settings?.notifications?.whatsapp || {};
  const token = wa.tokenEnc ? String(decryptObject(wa.tokenEnc).token || '').trim() : '';
  return {
    phoneNumberId: String(wa.phoneNumberId || '').trim(),
    token,
    to: String(wa.to || '').replace(/\D/g, ''),
  };
}

function whatsappReady(tenant) {
  const creds = whatsappCreds(tenant);
  return Boolean(creds.phoneNumberId && creds.token && creds.to);
}

function saveMailbox(tenant, body) {
  if (body.gmailUser == null && !String(body.gmailAppPassword || '').trim()) return;
  tenant.settings.mail = tenant.settings.mail || { gmailUser: '', gmailAppPasswordEnc: '' };
  if (body.gmailUser != null) {
    const gmailUser = String(body.gmailUser).trim().toLowerCase();
    if (gmailUser && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmailUser)) {
      const err = new Error('Enter the company Gmail address');
      err.statusCode = 400;
      throw err;
    }
    tenant.settings.mail.gmailUser = gmailUser;
    if (!gmailUser) tenant.settings.mail.gmailAppPasswordEnc = '';
  }
  const appPassword = String(body.gmailAppPassword || '').trim();
  if (appPassword) {
    if (!tenant.settings.mail.gmailUser) {
      const err = new Error('Gmail address is required with the app password');
      err.statusCode = 400;
      throw err;
    }
    tenant.settings.mail.gmailAppPasswordEnc = encryptObject({ pass: appPassword });
  }
}

function saveWhatsapp(tenant, body) {
  const touched = ['whatsappPhoneNumberId', 'whatsappToken', 'whatsappTo'].some((key) => body[key] != null && String(body[key]).trim());
  if (!touched) return;
  tenant.settings.notifications.whatsapp = tenant.settings.notifications.whatsapp || { phoneNumberId: '', tokenEnc: '', to: '' };
  const wa = tenant.settings.notifications.whatsapp;
  if (body.whatsappPhoneNumberId != null) wa.phoneNumberId = String(body.whatsappPhoneNumberId).trim();
  if (body.whatsappTo != null) wa.to = String(body.whatsappTo).replace(/\D/g, '');
  const token = String(body.whatsappToken || '').trim();
  if (token) wa.tokenEnc = encryptObject({ token });
  if (!wa.phoneNumberId && !wa.to) wa.tokenEnc = '';
}

async function saveNotificationSettings(tenantId, body = {}) {
  const tenant = await loadTenant(tenantId);
  if (!tenant) {
    const err = new Error('Workspace not found');
    err.statusCode = 404;
    throw err;
  }
  tenant.settings = tenant.settings || {};
  tenant.settings.notifications = tenant.settings.notifications || { botTokenEnc: '', events: {} };
  const token = String(body.botToken || '').trim();
  if (token) tenant.settings.notifications.botTokenEnc = encryptObject({ token });
  if (body.ownerChatId != null) tenant.settings.notifications.ownerChatId = chatIdOf(body.ownerChatId);
  saveMailbox(tenant, body);
  saveWhatsapp(tenant, body);
  const events = flagsOf(tenant);
  for (const [id, flags] of Object.entries(body.events || {})) {
    if (!events[id] || events[id].locked) continue;
    events[id] = {
      ...events[id],
      telegram: Boolean(flags?.telegram),
      email: Boolean(flags?.email),
      whatsapp: Boolean(flags?.whatsapp),
      other: Boolean(flags?.other),
    };
  }
  tenant.settings.notifications.events = events;
  tenant.markModified('settings');
  await tenant.save();
  return publicSettings(tenant);
}

async function defaultTelegram({ token, chatId, text }) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
  } catch {
    throw new Error('Telegram send failed');
  }
  const json = await res.json().catch(() => ({}));
  if (!json.ok || !json.result?.message_id) {
    throw new Error(json.description || 'Telegram send failed');
  }
  return String(json.result.message_id);
}

async function defaultMail(payload) {
  const { sendMail } = require('../lib/mailer');
  return sendMail(payload);
}

async function defaultWhatsapp({ phoneNumberId, token, to, text }) {
  let res;
  try {
    res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });
  } catch {
    throw new Error('WhatsApp send failed');
  }
  const json = await res.json().catch(() => ({}));
  const id = json.messages?.[0]?.id;
  if (!res.ok || !id) throw new Error('WhatsApp send failed');
  return String(id);
}

async function claimSend(tenantId, { eventKey, dedupeKey, channel, transport, text }) {
  let row = await skip(NotificationDelivery.findOne({ tenantId, dedupeKey, channel }));
  if (row?.sendId) return { duplicate: true, sendId: row.sendId };
  if (!row) {
    try {
      row = await NotificationDelivery.create({
        tenantId,
        eventKey,
        dedupeKey,
        channel,
        text: text ? String(text).slice(0, 500) : '',
        status: 'pending',
        sendId: '',
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      row = await skip(NotificationDelivery.findOne({ tenantId, dedupeKey, channel }));
      if (row?.sendId) return { duplicate: true, sendId: row.sendId };
    }
  }
  try {
    const sendId = await transport();
    row.sendId = String(sendId || '');
    row.status = 'sent';
    await row.save();
    return { duplicate: false, sendId: row.sendId };
  } catch (err) {
    row.status = 'failed';
    row.sendId = '';
    await row.save();
    throw err;
  }
}

async function notifyVendorAssigned(tenantId, order, sub, deps = {}) {
  const vendorName = String(sub?.assignedVendor || '').trim();
  if (!vendorName) return { telegram: 'skipped', reason: 'no_vendor' };
  const tenant = await loadTenant(tenantId);
  const vendor = await skip(Vendor.findOne({ tenantId, nameNorm: vendorName.toLowerCase() }));
  const events = flagsOf(tenant);
  const token = botTokenOf(tenant);
  const chatId = chatIdOf(vendor?.telegramGroup);
  const text = assignText(order, sub);
  const dedupeKey = dedupeAssign(order, sub);
  let telegram = 'skipped';
  let reason = '';
  if (!events['NOT-002']?.telegram) reason = 'off';
  else if (!token) reason = 'no_bot_token';
  else if (!chatId) reason = 'no_chat_id';
  else {
    try {
      const sent = await claimSend(tenantId, {
        eventKey: 'NOT-002',
        dedupeKey,
        channel: 'telegram',
        transport: () => (deps.telegram || defaultTelegram)({ token, chatId, text }),
      });
      telegram = sent.duplicate ? 'already_sent' : 'sent';
    } catch {
      telegram = 'failed';
    }
  }
  const mailer = deps.mailer || defaultMail;
  if (events['NOT-002']?.email && vendor?.email) {
    await sendEmailOnce(tenantId, {
      eventKey: 'vendor.assigned',
      dedupeKey: `${dedupeKey}:vendor-email`,
      to: vendor.email,
      subject: `Vendor order ${order.orderNo}`,
      text,
      mailer,
    });
  }
  if (events['NOT-009']?.email && emailRecipient(tenant)) {
    await sendEmailOnce(tenantId, {
      eventKey: 'vendor.assigned.owner',
      dedupeKey: `${dedupeKey}:owner-email`,
      to: emailRecipient(tenant),
      subject: `Vendor assigned ${order.orderNo}`,
      text,
      mailer,
    });
  }
  const phone = String(vendor?.phone || '').replace(/\D/g, '');
  if (events['NOT-002']?.whatsapp) {
    await notifyEventWhatsapp(tenantId, 'NOT-002', {
      dedupeKey: `${dedupeKey}:vendor-wa`,
      text,
      to: phone,
    }, deps);
  }
  await notifyEventInApp(tenantId, 'NOT-002', { dedupeKey, text });
  const whatsapp = await notifyEventWhatsapp(tenantId, 'NOT-009', {
    dedupeKey: `${dedupeKey}:owner-wa`,
    text,
  }, deps);
  const ownerTelegram = await notifyEventTelegram(tenantId, 'NOT-009', {
    dedupeKey: `${dedupeKey}:owner-tg`,
    text,
  }, deps);
  await notifyEventInApp(tenantId, 'NOT-009', { dedupeKey: `${dedupeKey}:owner`, text });
  return { telegram, reason, whatsapp: whatsapp.whatsapp, ownerTelegram: ownerTelegram.telegram };
}

async function sendEmailOnce(tenantId, { eventKey, dedupeKey, to, subject, text, mailer }) {
  if (!to) return { email: 'skipped' };
  try {
    const sent = await claimSend(tenantId, {
      eventKey,
      dedupeKey,
      channel: 'email',
      transport: async () => {
        const info = await mailer({
          to,
          subject,
          text,
          tenantId,
          html: `<pre>${String(text).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</pre>`,
        });
        return info?.messageId || `email-${dedupeKey}`;
      },
    });
    return { email: sent.duplicate ? 'already_sent' : 'sent', sendId: sent.sendId };
  } catch (err) {
    if (err.statusCode === 503) return { email: 'skipped', reason: 'mail_not_configured' };
    return { email: 'failed' };
  }
}

async function notifyEventWhatsapp(tenantId, eventId, { dedupeKey, text, to, direct = false } = {}, deps = {}) {
  const tenant = await loadTenant(tenantId);
  const events = flagsOf(tenant);
  if (!events[eventId]?.whatsapp) return { whatsapp: 'skipped', reason: 'off' };
  const creds = whatsappCreds(tenant);
  const dest = String(direct ? (to || '') : (to || creds.to)).replace(/\D/g, '');
  if (!creds.phoneNumberId || !creds.token || !dest) return { whatsapp: 'skipped', reason: 'not_configured' };
  try {
    const sent = await claimSend(tenantId, {
      eventKey: eventId,
      dedupeKey: `${dedupeKey}:whatsapp`,
      channel: 'whatsapp',
      transport: () => (deps.whatsapp || defaultWhatsapp)({
        phoneNumberId: creds.phoneNumberId,
        token: creds.token,
        to: dest,
        text,
      }),
    });
    return { whatsapp: sent.duplicate ? 'already_sent' : 'sent' };
  } catch {
    return { whatsapp: 'failed' };
  }
}

async function notifyEventTelegram(tenantId, eventId, { dedupeKey, text, chatId } = {}, deps = {}) {
  const tenant = await loadTenant(tenantId);
  const events = flagsOf(tenant);
  if (!events[eventId]?.telegram) return { telegram: 'skipped', reason: 'off' };
  const token = botTokenOf(tenant);
  const dest = chatIdOf(chatId || tenant?.settings?.notifications?.ownerChatId);
  if (!token) return { telegram: 'skipped', reason: 'no_bot_token' };
  if (!dest) return { telegram: 'skipped', reason: 'no_chat_id' };
  try {
    const sent = await claimSend(tenantId, {
      eventKey: eventId,
      dedupeKey: `${dedupeKey}:telegram`,
      channel: 'telegram',
      transport: () => (deps.telegram || defaultTelegram)({ token, chatId: dest, text }),
    });
    return { telegram: sent.duplicate ? 'already_sent' : 'sent' };
  } catch {
    return { telegram: 'failed' };
  }
}

async function notifyEventInApp(tenantId, eventId, { dedupeKey, text } = {}) {
  const tenant = await loadTenant(tenantId);
  const events = flagsOf(tenant);
  if (!events[eventId]?.other) return { inApp: 'skipped', reason: 'off' };
  try {
    const sent = await claimSend(tenantId, {
      eventKey: eventId,
      dedupeKey: `${dedupeKey}:inapp`,
      channel: 'in_app',
      text,
      transport: async () => `inapp-${dedupeKey}`,
    });
    return { inApp: sent.duplicate ? 'already_sent' : 'sent' };
  } catch {
    return { inApp: 'failed' };
  }
}

async function notifyEventEmail(tenantId, eventId, { dedupeKey, subject, text, whatsappTo } = {}, deps = {}) {
  const tenant = await loadTenant(tenantId);
  const events = flagsOf(tenant);
  let emailResult;
  if (!events[eventId]?.email) emailResult = { email: 'skipped', reason: 'off' };
  else {
    const to = emailRecipient(tenant);
    emailResult = to
      ? await sendEmailOnce(tenantId, {
        eventKey: eventId,
        dedupeKey,
        to,
        subject,
        text,
        mailer: deps.mailer || defaultMail,
      })
      : { email: 'skipped', reason: 'no_recipient' };
  }
  const whatsapp = await notifyEventWhatsapp(tenantId, eventId, {
    dedupeKey,
    text,
    to: whatsappTo,
    direct: whatsappTo != null,
  }, deps);
  const telegram = await notifyEventTelegram(tenantId, eventId, { dedupeKey, text }, deps);
  const inApp = await notifyEventInApp(tenantId, eventId, { dedupeKey, text });
  return { ...emailResult, whatsapp: whatsapp.whatsapp, telegram: telegram.telegram, inApp: inApp.inApp };
}

async function recentAlerts(tenantId) {
  const rows = await skip(NotificationDelivery.find({ tenantId }).sort({ createdAt: -1 }).limit(12));
  return rows.map((row) => ({
    id: String(row._id),
    eventKey: row.eventKey,
    channel: row.channel,
    status: row.status,
    text: String(row.text || '').slice(0, 180),
    at: row.createdAt,
  }));
}

let overdueCheckedAt = 0;

function nameNorm(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function scanOverdueDispatches(deps = {}) {
  if (!deps.force && Date.now() - overdueCheckedAt < 60 * 60 * 1000) return 0;
  overdueCheckedAt = Date.now();
  const Order = require('../models/Order');
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const orders = await Order.find({
    'subOrders.assignedDate': { $lte: cutoff, $ne: '' },
    'subOrders.assignedVendor': { $nin: ['', null] },
  }).select('tenantId orderNo subOrders').limit(200).setOptions({ skipTenantFilter: true });
  let sent = 0;
  for (const order of orders) {
    for (const sub of order.subOrders || []) {
      if (!sub.assignedVendor || !sub.assignedDate || sub.assignedDate > cutoff) continue;
      if (sub.dispatchDate) continue;
      if (['Dispatched', 'Delivered', 'Rejected', 'Cancelled'].includes(sub.vendorStatus)) continue;
      if (['Dispatched', 'Delivered', 'Cancelled'].includes(sub.status)) continue;
      const vendor = await skip(Vendor.findOne({
        tenantId: order.tenantId,
        nameNorm: nameNorm(sub.assignedVendor),
        removed: false,
      }));
      const phone = String(vendor?.phone || '').replace(/\D/g, '');
      const note = await notifyEventEmail(order.tenantId, 'NOT-010', {
        dedupeKey: `overdue:${order.orderNo}:${sub.id}:${sub.assignedDate}`,
        subject: `Dispatch overdue ${order.orderNo}`,
        text: `Please dispatch this item urgently\nOrder: ${order.orderNo}\nSKU: ${sub.sku || '—'}\nQty: ${sub.qty || 1}`,
        whatsappTo: phone,
      }, deps);
      if (note.email === 'sent' || note.whatsapp === 'sent' || note.telegram === 'sent' || note.inApp === 'sent') sent += 1;
    }
  }
  return sent;
}

async function clearVendorAssignNotice(tenantId, order, sub) {
  const prefix = `vendor.assigned:${order.orderNo}:${sub.id}:`;
  await skip(NotificationDelivery.deleteMany({
    tenantId,
    dedupeKey: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  }));
}

module.exports = {
  EVENTS,
  chatIdOf,
  shipByOf,
  assignText,
  publicSettings,
  saveNotificationSettings,
  notifyVendorAssigned,
  notifyEventEmail,
  recentAlerts,
  scanOverdueDispatches,
  clearVendorAssignNotice,
  loadTenant,
};
