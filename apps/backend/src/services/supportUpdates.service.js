const SupportMessage = require('../models/SupportMessage');
const SupportUpdate = require('../models/SupportUpdate');
const Tenant = require('../models/Tenant');
const { HttpError } = require('../utils/httpError');
const chat = require('./supportChat.service');

const TITLE_MAX = 160;
const NOTE_MAX = 500;
const LIST_MAX = 300;
const SUMMARY_MAX = { issue: 200, fix: 200, area: 120, check: 300 };
const REASON_MAX = 400;
const FIXED = ['done', 'confirmed'];

/** Which side may apply which mark, and from which statuses. Developers finish work; clients confirm it. */
const ACTIONS = {
  start: { sides: ['platform'], from: ['pending'], to: 'in_progress' },
  complete: { sides: ['platform'], from: ['pending', 'in_progress'], to: 'done' },
  confirm: { sides: ['tenant'], from: ['pending', 'in_progress', 'done'], to: 'confirmed' },
  reopen: { sides: ['platform', 'tenant'], from: ['done', 'confirmed'], to: 'pending' },
};

function readTitle(raw, fallback) {
  const title = String(raw ?? '').replace(/\s+/g, ' ').trim() || String(fallback || '').replace(/\s+/g, ' ').trim();
  if (!title) throw new HttpError(400, 'Give the update a short title');
  if (title.length > TITLE_MAX) throw new HttpError(400, `Title must be ${TITLE_MAX} characters or fewer`);
  return title;
}

function readNote(raw) {
  const note = String(raw ?? '').trim();
  if (note.length > NOTE_MAX) throw new HttpError(400, `Note must be ${NOTE_MAX} characters or fewer`);
  return note;
}

function readSummary(body) {
  return Object.fromEntries(Object.entries(SUMMARY_MAX).map(([key, max]) => {
    const value = String(body[key] ?? '').replace(/\s+/g, ' ').trim();
    if (value.length > max) throw new HttpError(400, `${key} must be ${max} characters or fewer`);
    return [key, value];
  }));
}

function readReason(body) {
  const stage = String(body.stage ?? '');
  if (!SupportUpdate.STAGES.includes(stage)) throw new HttpError(400, 'Unknown stage');
  const reason = String(body.reason ?? '').replace(/\s+/g, ' ').trim();
  if (reason.length > REASON_MAX) throw new HttpError(400, `Reason must be ${REASON_MAX} characters or fewer`);
  return { stage, reason };
}

function defaultTitle(message) {
  const text = chat.previewText(message);
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
}

function toDto(row, messages = [], tenantName) {
  return {
    id: String(row._id),
    tenantId: String(row.tenantId),
    ...(tenantName !== undefined ? { tenantName } : {}),
    title: row.title,
    status: row.status,
    sourceMessageId: String(row.sourceMessageId),
    createdByName: row.createdByName || '',
    createdSide: row.createdSide,
    doneByName: row.doneByName || '',
    doneAt: row.doneAt || null,
    confirmedByName: row.confirmedByName || '',
    confirmedAt: row.confirmedAt || null,
    history: (row.history || []).map((h) => ({
      action: h.action,
      status: h.status,
      byName: h.byName || '',
      side: h.side,
      note: h.note || '',
      at: h.at,
    })),
    messageCount: messages.length,
    messages,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function withMessages(rows, viewerId) {
  if (!rows.length) return new Map();
  const ids = rows.map((r) => r._id);
  const tenantIds = [...new Set(rows.map((r) => String(r.tenantId)))];
  const messages = await SupportMessage.find({
    tenantId: { $in: tenantIds },
    updateId: { $in: ids },
    'event.action': { $exists: false },
  }).sort({ _id: 1 }).lean();
  const byTenant = new Map();
  messages.forEach((m) => {
    const key = String(m.tenantId);
    if (!byTenant.has(key)) byTenant.set(key, []);
    byTenant.get(key).push(m);
  });
  const byUpdate = new Map();
  for (const [tenantId, list] of byTenant) {
    const dtos = await chat.dtosFor(tenantId, viewerId, list);
    list.forEach((m, i) => {
      const key = String(m.updateId);
      if (!byUpdate.has(key)) byUpdate.set(key, []);
      byUpdate.get(key).push(dtos[i]);
    });
  }
  return byUpdate;
}

function statusCounts(rows) {
  const counts = { pending: 0, in_progress: 0, done: 0, confirmed: 0 };
  rows.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  return counts;
}

function statusFilter(status) {
  if (!status) return {};
  if (!SupportUpdate.STATUSES.includes(status)) throw new HttpError(400, 'Unknown status');
  return { status };
}

async function listUpdates(tenantId, viewerId, query = {}) {
  const all = await SupportUpdate.find({ tenantId }).sort({ updatedAt: -1 }).limit(LIST_MAX).lean();
  const rows = query.status ? all.filter((r) => r.status === statusFilter(query.status).status) : all;
  const messages = await withMessages(rows, viewerId);
  return {
    rows: rows.map((r) => toDto(r, messages.get(String(r._id)) || [])),
    counts: statusCounts(all),
  };
}

/** Platform only: every merchant's updates in one list. */
async function listAllUpdates(viewerId, query = {}) {
  const all = await SupportUpdate.find({}).sort({ updatedAt: -1 }).limit(LIST_MAX).lean();
  const rows = query.status ? all.filter((r) => r.status === statusFilter(query.status).status) : all;
  const tenants = await Tenant.find({ _id: { $in: [...new Set(all.map((r) => String(r.tenantId)))] } }).select('name').lean();
  const names = new Map(tenants.map((t) => [String(t._id), t.name]));
  const messages = await withMessages(rows, viewerId);
  return {
    rows: rows.map((r) => toDto(r, messages.get(String(r._id)) || [], names.get(String(r.tenantId)) || '')),
    counts: statusCounts(all),
  };
}

async function postEvent(update, user, side, action, note) {
  await SupportMessage.create({
    tenantId: update.tenantId,
    side,
    senderId: user.id,
    senderName: await chat.senderName(user.id, side),
    senderRole: user.role || '',
    text: '',
    updateId: update._id,
    event: { action, status: update.status, title: update.title, note },
  });
}

async function createUpdate({ tenantId, user, side, messageId, title }) {
  if (!chat.isObjectId(messageId)) throw new HttpError(404, 'Message not found');
  const message = await SupportMessage.findOne({ tenantId, _id: messageId }).lean();
  if (!message || message.event?.action) throw new HttpError(404, 'Message not found');
  if (message.updateId) throw new HttpError(409, 'This message is already tracked as an update');

  const finalTitle = readTitle(title, defaultTitle(message));
  const byName = await chat.senderName(user.id, side);
  let row;
  try {
    row = await SupportUpdate.create({
      tenantId,
      title: finalTitle,
      sourceMessageId: message._id,
      createdBy: user.id,
      createdByName: byName,
      createdSide: side,
      history: [{ action: 'created', status: 'pending', by: user.id, byName, side }],
    });
  } catch (err) {
    if (err?.code === 11000) throw new HttpError(409, 'This message is already tracked as an update');
    throw err;
  }
  await SupportMessage.updateOne({ tenantId, _id: message._id }, { $set: { updateId: row._id } });
  const messages = await withMessages([row.toObject()], user.id);
  return toDto(row.toObject(), messages.get(String(row._id)) || []);
}

async function applyAction({ tenantId, user, side, updateId, action, note, title, summary = {} }) {
  if (!chat.isObjectId(updateId)) throw new HttpError(404, 'Update not found');
  const row = await SupportUpdate.findOne({ tenantId, _id: updateId });
  if (!row) throw new HttpError(404, 'Update not found');
  const byName = await chat.senderName(user.id, side);

  if (action === 'rename') {
    row.title = readTitle(title);
    row.history.push({ action: 'rename', status: row.status, by: user.id, byName, side, note: row.title });
    await row.save();
  } else if (action === 'summary') {
    if (side !== 'platform') throw new HttpError(403, 'Only the OMSKing team can add the fix summary');
    if (!FIXED.includes(row.status)) throw new HttpError(400, 'Only a completed update gets a fix summary');
    Object.assign(row, readSummary(summary));
    row.history.push({ action: 'summary', status: row.status, by: user.id, byName, side });
    await row.save();
  } else if (action === 'reason') {
    if (side !== 'platform') throw new HttpError(403, 'Only the OMSKing team can write why it is pending');
    if (FIXED.includes(row.status)) throw new HttpError(400, 'A completed update has no pending reason');
    Object.assign(row, readReason(summary));
    row.history.push({ action: 'reason', status: row.status, by: user.id, byName, side });
    await row.save();
  } else {
    const rule = ACTIONS[action];
    if (!rule) throw new HttpError(400, 'Unknown action');
    if (!rule.sides.includes(side)) {
      throw new HttpError(403, side === 'tenant' ? 'Only the OMSKing team can mark this' : 'Only the client can confirm this');
    }
    if (!rule.from.includes(row.status)) throw new HttpError(400, `Cannot ${action} an update that is ${row.status.replace('_', ' ')}`);
    const cleanNote = readNote(note);
    row.status = rule.to;
    if (action === 'complete') {
      row.doneByName = byName;
      row.doneAt = new Date();
    }
    if (FIXED.includes(row.status)) {
      row.stage = '';
      row.reason = '';
    }
    if (action === 'confirm') {
      row.confirmedByName = byName;
      row.confirmedAt = new Date();
    }
    if (action === 'reopen') {
      row.confirmedByName = '';
      row.confirmedAt = null;
    }
    row.history.push({ action, status: row.status, by: user.id, byName, side, note: cleanNote });
    await row.save();
    await postEvent(row, user, side, action, cleanNote);
  }
  const messages = await withMessages([row.toObject()], user.id);
  return toDto(row.toObject(), messages.get(String(row._id)) || []);
}

/** Issue / fix of the company's completed updates, for the hover on each module in the side list. */
async function listSummaries(tenantId) {
  const rows = await SupportUpdate.find({ tenantId, status: { $in: FIXED }, $or: [{ issue: { $ne: '' } }, { fix: { $ne: '' } }] })
    .sort({ doneAt: -1 }).limit(LIST_MAX).select('sourceMessageId area issue fix').lean();
  return rows.map((r) => ({ messageId: String(r.sourceMessageId), area: r.area || '', issue: r.issue || '', fix: r.fix || '' }));
}

module.exports = {
  listUpdates,
  listSummaries,
  listAllUpdates,
  createUpdate,
  applyAction,
  ACTIONS,
  TITLE_MAX,
};
