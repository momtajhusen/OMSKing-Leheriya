const { HttpError } = require('../utils/httpError');
const { successResponse } = require('../utils/response');
const chat = require('../services/supportChat.service');
const updates = require('../services/supportUpdates.service');

/** A platform admin impersonating a merchant still writes as the platform. */
function viewerSide(req) {
  return req.user.impersonating ? 'platform' : 'tenant';
}

function otherSide(side) {
  return side === 'platform' ? 'tenant' : 'platform';
}

/** Merchant staff only. Vendors are outside the company and the platform uses its inbox routes. */
function merchantReporter(req, res, next) {
  if (req.user.role === 'platform_admin' && !req.user.impersonating) {
    return next(new HttpError(403, 'Open a subscriber from the report inbox'));
  }
  if (req.user.role === 'vendor') return next(new HttpError(403, 'Reports are not available for vendor logins'));
  if (!req.tenantId) return next(new HttpError(403, 'No tenant on this session'));
  req.supportTenantId = req.tenantId;
  return next();
}

async function platformThread(req, res, next) {
  try {
    const tenant = await chat.merchantTenant(req.params.tenantId);
    if (!tenant) throw new HttpError(404, 'Subscriber not found');
    req.supportTenantId = String(tenant._id);
    return next();
  } catch (err) {
    return next(err);
  }
}

async function listOwn(req, res) {
  const { rows, hasMore, counts } = await chat.listMessages(req.supportTenantId, req.user.id, req.query);
  return res.status(200).json({ success: true, message: 'Report messages', data: rows, meta: { hasMore, counts } });
}

function wantsTracking(body) {
  return ['true', '1', 'on'].includes(String(body?.trackAsUpdate ?? '').toLowerCase());
}

async function postAndTrack(req, side) {
  const row = await chat.postMessage({
    tenantId: req.supportTenantId,
    user: req.user,
    side,
    body: req.body,
    file: req.file,
  });
  if (!wantsTracking(req.body) || row.update) return row;
  const update = await updates.createUpdate({ tenantId: req.supportTenantId, user: req.user, side, messageId: row.id });
  return { ...row, update: { id: update.id, title: update.title, status: update.status, markedBy: side } };
}

async function sendOwn(req, res) {
  const row = await postAndTrack(req, viewerSide(req));
  return successResponse(res, row, 'Message sent', 201);
}

async function deleteMessage(req, res) {
  const row = await chat.deleteMessage({ tenantId: req.supportTenantId, user: req.user, messageId: req.params.id });
  return successResponse(res, row, 'Message deleted');
}

async function readOwn(req, res) {
  const updated = await chat.markRead(req.supportTenantId, otherSide(viewerSide(req)));
  return successResponse(res, { updated }, 'Marked as read');
}

async function unreadOwn(req, res) {
  const unread = await chat.unreadCount(req.supportTenantId, otherSide(viewerSide(req)));
  return successResponse(res, { unread }, 'Unread reports');
}

async function listThreads(req, res) {
  const rows = await chat.listThreads();
  const unread = rows.reduce((sum, row) => sum + row.unread, 0);
  return res.status(200).json({ success: true, message: 'Report inbox', data: rows, meta: { unread } });
}

async function listThread(req, res) {
  const { rows, hasMore, counts } = await chat.listMessages(req.supportTenantId, req.user.id, req.query);
  return res.status(200).json({ success: true, message: 'Report messages', data: rows, meta: { hasMore, counts } });
}

async function sendThread(req, res) {
  const row = await postAndTrack(req, 'platform');
  return successResponse(res, row, 'Reply sent', 201);
}

function sendUpdates(res, { rows, counts }) {
  return res.status(200).json({ success: true, message: 'Report updates', data: rows, meta: { counts } });
}

async function listOwnUpdates(req, res) {
  return sendUpdates(res, await updates.listUpdates(req.supportTenantId, req.user.id, req.query));
}

async function listThreadUpdates(req, res) {
  return sendUpdates(res, await updates.listUpdates(req.supportTenantId, req.user.id, req.query));
}

async function listOwnSummaries(req, res) {
  return successResponse(res, await updates.listSummaries(req.supportTenantId), 'Fix summaries');
}

async function listAllUpdates(req, res) {
  return sendUpdates(res, await updates.listAllUpdates(req.user.id, req.query));
}

async function trackUpdate(req, res, side) {
  const row = await updates.createUpdate({
    tenantId: req.supportTenantId,
    user: req.user,
    side,
    messageId: req.body?.messageId,
    title: req.body?.title,
  });
  return successResponse(res, row, 'Tracked as update', 201);
}

async function markUpdate(req, res, side) {
  const row = await updates.applyAction({
    tenantId: req.supportTenantId,
    user: req.user,
    side,
    updateId: req.params.id,
    action: req.body?.action,
    note: req.body?.note,
    title: req.body?.title,
    summary: req.body || {},
  });
  return successResponse(res, row, 'Update saved');
}

const createOwnUpdate = (req, res) => trackUpdate(req, res, viewerSide(req));
const createThreadUpdate = (req, res) => trackUpdate(req, res, 'platform');
const markOwnUpdate = (req, res) => markUpdate(req, res, viewerSide(req));
const markThreadUpdate = (req, res) => markUpdate(req, res, 'platform');

async function readThread(req, res) {
  const updated = await chat.markRead(req.supportTenantId, 'tenant');
  return successResponse(res, { updated }, 'Marked as read');
}

/** Documents never render in the browser; the ASCII name cannot carry quotes or line breaks into the header. */
function downloadDisposition(name) {
  const clean = String(name || 'file').replace(/[\r\n]/g, '') || 'file';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

async function media(req, res) {
  if (!chat.verifyMediaLink(req.params.id, req.query.exp, req.query.sig)) {
    throw new HttpError(403, 'This link has expired. Reopen the chat.');
  }
  const file = await chat.mediaFile(req.params.id);
  if (!file) throw new HttpError(404, 'File not found');
  const maxAge = Math.max(0, Number(req.query.exp) - Math.floor(Date.now() / 1000));
  const document = file.kind === 'file';
  res.set({
    'Content-Type': document ? 'application/octet-stream' : file.mime,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': document ? downloadDisposition(file.name) : 'inline',
    'Cache-Control': `private, max-age=${maxAge}`,
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ...(document ? { 'Content-Security-Policy': "default-src 'none'; sandbox" } : {}),
  });
  return res.sendFile(file.path);
}

module.exports = {
  merchantReporter,
  platformThread,
  listOwn,
  sendOwn,
  deleteMessage,
  readOwn,
  unreadOwn,
  listThreads,
  listThread,
  sendThread,
  readThread,
  listOwnUpdates,
  listOwnSummaries,
  createOwnUpdate,
  markOwnUpdate,
  listThreadUpdates,
  createThreadUpdate,
  markThreadUpdate,
  listAllUpdates,
  media,
};
