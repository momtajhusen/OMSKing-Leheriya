const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('../config');
const SupportMessage = require('../models/SupportMessage');
const SupportUpdate = require('../models/SupportUpdate');
const Tenant = require('../models/Tenant');
const User = require('../models/User');
const { HttpError } = require('../utils/httpError');
const { sniffMedia, documentOf, discardUpload, supportMediaRoot, MAX_BYTES } = require('../middleware/uploadSupportMedia');

const TEXT_MAX = 4000;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 100;
const LINK_WINDOW_SEC = 6 * 60 * 60;
const KIND_LABEL = { image: 'Photo', video: 'Video', audio: 'Voice message', file: 'Document' };
const DELETED_TEXT = 'This message was deleted';

const signingKey = crypto.createHash('sha256').update(`support-media:${config.jwt.accessSecret}`).digest();

function sign(id, exp) {
  return crypto.createHmac('sha256', signingKey).update(`${id}:${exp}`).digest('hex');
}

/** Expiry snaps to a window so the same file keeps the same URL across polls and the browser cache holds. */
function mediaUrl(id, now = Date.now()) {
  const window = Math.floor(now / 1000 / LINK_WINDOW_SEC);
  const exp = (window + 2) * LINK_WINDOW_SEC;
  return `/api/v1/support/media/${id}?exp=${exp}&sig=${sign(String(id), exp)}`;
}

function verifyMediaLink(id, exp, sig) {
  const expNum = Number(exp);
  if (!mongoose.Types.ObjectId.isValid(id) || !Number.isFinite(expNum) || !/^[a-f0-9]{64}$/.test(String(sig || ''))) return false;
  if (expNum * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(String(id), expNum), 'hex');
  return crypto.timingSafeEqual(expected, Buffer.from(String(sig), 'hex'));
}

function isObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value) && String(new mongoose.Types.ObjectId(String(value))) === String(value);
}

const EVENT_VERB = { start: 'Started', complete: 'Marked done', confirm: 'Confirmed', reopen: 'Reopened' };

function previewText(row) {
  if (row.deletedAt) return DELETED_TEXT;
  if (row.event?.action) return `${EVENT_VERB[row.event.action] || 'Updated'}: ${row.event.title || ''}`;
  if (row.text) return row.text.length > 200 ? `${row.text.slice(0, 200)}…` : row.text;
  return KIND_LABEL[row.attachment?.kind] || '';
}

function toDto(row, viewerId, quotes = new Map(), updates = new Map()) {
  const quoted = row.replyTo ? quotes.get(String(row.replyTo)) : null;
  const att = row.attachment?.kind ? row.attachment : null;
  const update = row.updateId ? updates.get(String(row.updateId)) : null;
  return {
    id: String(row._id),
    side: row.side,
    senderName: row.senderName || '',
    senderRole: row.senderRole || '',
    mine: String(row.senderId) === String(viewerId),
    text: row.text || '',
    attachment: att ? {
      kind: att.kind,
      url: mediaUrl(row._id),
      mime: att.mime,
      bytes: att.bytes || 0,
      name: att.name || '',
      durationSec: att.durationSec || 0,
    } : null,
    replyTo: quoted ? {
      id: String(quoted._id),
      side: quoted.side,
      senderName: quoted.senderName || '',
      text: previewText(quoted),
      kind: quoted.deletedAt ? null : quoted.attachment?.kind || null,
    } : null,
    update: update ? {
      id: String(update._id),
      title: update.title,
      status: update.status,
      markedBy: markedBy(update),
      issue: update.issue || '',
      fix: update.fix || '',
      area: update.area || '',
      check: update.check || '',
      stage: update.stage || '',
      reason: update.reason || '',
    } : null,
    event: row.event?.action ? {
      action: row.event.action,
      status: row.event.status,
      title: row.event.title || '',
      note: row.event.note || '',
    } : null,
    deleted: Boolean(row.deletedAt),
    readAt: row.readAt || null,
    createdAt: row.createdAt,
  };
}

/** The side that last set the status; renames do not count as a mark. */
function markedBy(update) {
  const marks = (update.history || []).filter((h) => !['rename', 'summary', 'reason'].includes(h.action));
  return marks.length ? marks[marks.length - 1].side : null;
}

async function updatesFor(tenantId, rows) {
  const ids = [...new Set(rows.filter((r) => r.updateId).map((r) => String(r.updateId)))];
  if (!ids.length) return new Map();
  const found = await SupportUpdate.find({ tenantId, _id: { $in: ids } }).select('title status issue fix area check stage reason history.action history.side').lean();
  return new Map(found.map((u) => [String(u._id), u]));
}

async function dtosFor(tenantId, viewerId, rows) {
  const [quotes, updates] = await Promise.all([quotesFor(tenantId, rows), updatesFor(tenantId, rows)]);
  return rows.map((row) => toDto(row, viewerId, quotes, updates));
}

async function quotesFor(tenantId, rows) {
  const ids = [...new Set(rows.filter((r) => r.replyTo).map((r) => String(r.replyTo)))];
  if (!ids.length) return new Map();
  const found = await SupportMessage.find({ tenantId, _id: { $in: ids } })
    .select('side senderName text attachment.kind deletedAt')
    .lean();
  return new Map(found.map((q) => [String(q._id), q]));
}

/** Open updates held by someone else go under their own chat filter instead of Pending / In progress. */
const STAGE_FILTER = { waiting_client: 'waiting', needs_input: 'input', blocked: 'blocked' };

/** Filter counts over the whole chat, matching the admin chat filters: every client message is Pending until work starts. */
async function messageCounts(tenantId) {
  const [rows, updates] = await Promise.all([
    SupportMessage.find({ tenantId, deletedAt: null, 'event.action': null }).select('side updateId').lean(),
    SupportUpdate.find({ tenantId }).select('status stage history.action history.side').lean(),
  ]);
  const byId = new Map(updates.map((u) => [String(u._id), u]));
  const counts = {
    all: rows.length, pending: 0, progress: 0, waiting: 0, input: 0, blocked: 0, fixed: 0, developer: 0, client: 0,
  };
  for (const row of rows) {
    const update = row.updateId && byId.get(String(row.updateId));
    const held = update && !['done', 'confirmed'].includes(update.status) && STAGE_FILTER[update.stage];
    if (held) counts[held] += 1;
    else if (update ? update.status === 'pending' : row.side === 'tenant') counts.pending += 1;
    if (!update) continue;
    if (update.status === 'in_progress' && !held) counts.progress += 1;
    if (['done', 'confirmed'].includes(update.status)) counts.fixed += 1;
    const by = markedBy(update);
    if (by === 'platform') counts.developer += 1;
    if (by === 'tenant') counts.client += 1;
  }
  return counts;
}

async function listMessages(tenantId, viewerId, query = {}) {
  const limit = Math.min(PAGE_MAX, Math.max(1, parseInt(query.limit, 10) || PAGE_DEFAULT));
  const filter = { tenantId };
  if (query.before) {
    if (!isObjectId(query.before)) throw new HttpError(400, 'Invalid cursor');
    filter._id = { $lt: new mongoose.Types.ObjectId(String(query.before)) };
  }
  const rows = await SupportMessage.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const [dtos, counts] = await Promise.all([dtosFor(tenantId, viewerId, page), query.before ? null : messageCounts(tenantId)]);
  return { rows: dtos, hasMore, ...(counts ? { counts } : {}) };
}

async function senderName(userId, side) {
  const user = await User.findById(userId).select('fullName').setOptions({ skipTenantFilter: true }).lean();
  if (user?.fullName) return user.fullName;
  return side === 'platform' ? 'OMSKing Support' : '';
}

function readDuration(raw, kind) {
  if (kind !== 'audio' && kind !== 'video') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(3600, Math.round(value * 10) / 10);
}

async function storeAttachment(file, tenantId, durationRaw) {
  const sniffed = sniffMedia(file.path, file.mimetype) || documentOf(file.mimetype);
  if (file.size > MAX_BYTES[sniffed.kind]) {
    throw new HttpError(400, `${KIND_LABEL[sniffed.kind]} must be ${MAX_BYTES[sniffed.kind] / 1024 / 1024}MB or smaller`);
  }
  const filename = `${path.basename(file.filename, path.extname(file.filename))}${sniffed.ext}`;
  fs.renameSync(file.path, path.join(supportMediaRoot, String(tenantId), filename));
  return {
    kind: sniffed.kind,
    file: filename,
    mime: sniffed.mime,
    bytes: file.size || 0,
    name: String(file.originalname || '').slice(0, 120),
    durationSec: readDuration(durationRaw, sniffed.kind),
  };
}

/** `tenantId` is the thread owner resolved by the route (JWT for merchants, checked URL id for the platform). */
async function postMessage({ tenantId, user, side, body = {}, file }) {
  try {
    const text = String(body.text ?? '').trim();
    if (text.length > TEXT_MAX) throw new HttpError(400, `Message must be ${TEXT_MAX} characters or fewer`);
    if (!text && !file) throw new HttpError(400, 'Type a message or attach a file');

    let replyTo = null;
    let updateId = null;
    if (body.replyTo) {
      if (!isObjectId(body.replyTo)) throw new HttpError(400, 'The message you replied to is not in this chat');
      const quoted = await SupportMessage.findOne({ tenantId, _id: body.replyTo }).select('_id updateId').lean();
      if (!quoted) throw new HttpError(400, 'The message you replied to is not in this chat');
      replyTo = quoted._id;
      updateId = quoted.updateId || null;
    }
    if (body.updateId) {
      const update = isObjectId(body.updateId)
        ? await SupportUpdate.findOne({ tenantId, _id: body.updateId }).select('_id').lean()
        : null;
      if (!update) throw new HttpError(400, 'That update is not in this chat');
      updateId = update._id;
    }

    const attachment = file ? await storeAttachment(file, tenantId, body.durationSec) : undefined;
    const row = await SupportMessage.create({
      tenantId,
      side,
      senderId: user.id,
      senderName: await senderName(user.id, side),
      senderRole: user.role || '',
      text,
      attachment,
      replyTo,
      updateId,
    });
    const [dto] = await dtosFor(tenantId, user.id, [row.toObject()]);
    return dto;
  } catch (err) {
    discardUpload(file);
    throw err;
  }
}

/**
 * Delete for everyone, sender only. The row stays as a "deleted" placeholder so both sides see it went;
 * the text, file and quote are wiped, and an update this message started is withdrawn.
 */
async function deleteMessage({ tenantId, user, messageId }) {
  const row = isObjectId(messageId)
    ? await SupportMessage.findOne({ tenantId, _id: messageId, senderId: user.id, deletedAt: null, 'event.action': null }).lean()
    : null;
  if (!row) throw new HttpError(404, 'Message not found');
  await SupportMessage.updateOne(
    { tenantId, _id: row._id },
    { $set: { text: '', replyTo: null, updateId: null, deletedAt: new Date() }, $unset: { attachment: 1 } },
  );
  if (row.attachment?.file) {
    fs.rmSync(path.join(supportMediaRoot, String(tenantId), path.basename(row.attachment.file)), { force: true });
  }
  await SupportUpdate.deleteOne({ tenantId, sourceMessageId: row._id });
  const fresh = await SupportMessage.findOne({ tenantId, _id: row._id }).lean();
  const [dto] = await dtosFor(tenantId, user.id, [fresh]);
  return dto;
}

async function markRead(tenantId, fromSide) {
  const res = await SupportMessage.updateMany(
    { tenantId, side: fromSide, readAt: null },
    { $set: { readAt: new Date() } },
  );
  return res.modifiedCount || 0;
}

async function unreadCount(tenantId, fromSide) {
  return SupportMessage.countDocuments({ tenantId, side: fromSide, readAt: null });
}

/** Platform inbox: every merchant, latest conversation first; merchants that never wrote follow by name. */
async function listThreads() {
  const grouped = await SupportMessage.aggregate([
    { $sort: { _id: -1 } },
    {
      $group: {
        _id: '$tenantId',
        last: { $first: '$$ROOT' },
        unread: { $sum: { $cond: [{ $and: [{ $eq: ['$side', 'tenant'] }, { $eq: ['$readAt', null] }] }, 1, 0] } },
      },
    },
    { $sort: { 'last._id': -1 } },
  ]);
  const openRows = await SupportUpdate.aggregate([
    { $match: { status: { $ne: 'confirmed' } } },
    { $group: { _id: '$tenantId', open: { $sum: 1 } } },
  ]);
  const openBy = new Map(openRows.map((r) => [String(r._id), r.open]));
  const tenants = await Tenant.find({ kind: 'merchant' }).select('name status plan').lean();
  const byId = new Map(tenants.map((t) => [String(t._id), t]));
  const seen = new Set();
  const threads = [];
  grouped.forEach((g) => {
    const tenant = byId.get(String(g._id));
    if (!tenant) return;
    seen.add(String(g._id));
    threads.push({
      tenantId: String(g._id),
      tenantName: tenant.name,
      tenantStatus: tenant.status,
      unread: g.unread,
      openUpdates: openBy.get(String(g._id)) || 0,
      lastMessage: {
        id: String(g.last._id),
        side: g.last.side,
        senderName: g.last.senderName || '',
        text: previewText(g.last),
        kind: g.last.attachment?.kind || null,
        readAt: g.last.readAt || null,
        createdAt: g.last.createdAt,
      },
    });
  });
  tenants
    .filter((t) => !seen.has(String(t._id)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((t) => threads.push({
      tenantId: String(t._id),
      tenantName: t.name,
      tenantStatus: t.status,
      unread: 0,
      openUpdates: openBy.get(String(t._id)) || 0,
      lastMessage: null,
    }));
  return threads;
}

async function merchantTenant(id) {
  if (!isObjectId(id)) return null;
  return Tenant.findOne({ _id: id, kind: 'merchant' }).select('_id name').lean();
}

async function mediaFile(id) {
  const row = await SupportMessage.findById(id).select('tenantId attachment').lean();
  if (!row?.attachment?.file) return null;
  const full = path.join(supportMediaRoot, String(row.tenantId), path.basename(row.attachment.file));
  if (!fs.existsSync(full)) return null;
  return { path: full, mime: row.attachment.mime, kind: row.attachment.kind, name: row.attachment.name || '' };
}

module.exports = {
  listMessages,
  postMessage,
  deleteMessage,
  markRead,
  unreadCount,
  listThreads,
  merchantTenant,
  mediaFile,
  mediaUrl,
  verifyMediaLink,
  dtosFor,
  senderName,
  previewText,
  isObjectId,
  TEXT_MAX,
};
