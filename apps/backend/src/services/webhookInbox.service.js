const crypto = require('crypto');
const ChannelConnection = require('../models/ChannelConnection');
const WebhookEvent = require('../models/WebhookEvent');
const { credsOf } = require('./channelConnection.service');
const { adapterFor } = require('../adapters');
const { header } = require('../adapters/signature');
const { enqueue } = require('./jobQueue.service');
const { HttpError } = require('../utils/httpError');

const { channelIds } = require('../channels/registry');

const CHANNELS = new Set(channelIds());

function parseBody(rawBody) {
  if (!rawBody || !rawBody.length) return {};
  try {
    const parsed = JSON.parse(Buffer.from(rawBody).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    throw new HttpError(400, 'Webhook body must be JSON');
  }
}

function publicHeaders(headers, adapter, body) {
  return {
    topic: adapter.topicOf(headers, body),
    shop: header(headers, 'x-oms-shop') || header(headers, 'x-shopify-shop-domain'),
    eventId: adapter.eventId(headers, body),
  };
}

/**
 * Tenant comes from the connection whose shop + signature match.
 * Query string and body tenantId are ignored.
 */
async function acceptWebhook({ channel, rawBody, headers }) {
  const name = String(channel || '').toLowerCase();
  const adapter = adapterFor(name);
  if (!adapter || !CHANNELS.has(name)) throw new HttpError(404, 'Unknown channel');

  const body = parseBody(rawBody);
  const externalEventId = String(adapter.eventId(headers, body) || '').trim();
  if (!externalEventId) throw new HttpError(400, 'Webhook event id is required');

  const hint = adapter.shopHint(headers);
  const rows = await ChannelConnection.find({ channel: name }).setOptions({ skipTenantFilter: true });
  const matches = [];
  rows.forEach((row) => {
    const creds = credsOf(row);
    const shop = adapter.shopOf(creds);
    if (hint && shop && shop !== hint) return;
    if (adapter.verify({ rawBody, headers, creds })) matches.push(row);
  });
  if (matches.length !== 1) throw new HttpError(401, 'Webhook signature rejected');

  const tenantId = matches[0].tenantId;
  const stored = { ...body };
  delete stored.tenantId;

  let event;
  try {
    event = await WebhookEvent.create({
      tenantId,
      channel: name,
      externalEventId,
      topic: adapter.topicOf(headers, body),
      payload: stored,
      headers: publicHeaders(headers, adapter, body),
      receivedAt: new Date(),
      status: 'received',
      correlationId: crypto.randomUUID(),
      applied: false,
      applyCount: 0,
      duplicateCount: 0,
    });
  } catch (err) {
    if (err.code !== 11000) throw err;
    const existing = await WebhookEvent.findOneAndUpdate(
      { tenantId, channel: name, externalEventId },
      { $inc: { duplicateCount: 1 }, $set: { lastDuplicateAt: new Date() } },
      { new: true },
    ).setOptions({ skipTenantFilter: true });
    return {
      duplicate: true,
      status: 'duplicate',
      id: existing ? String(existing._id) : null,
      externalEventId,
    };
  }

  const job = await enqueue({
    tenantId,
    channel: name,
    jobType: 'webhook_dispatch',
    triggeredBy: 'webhook',
    webhookEventId: event._id,
  });

  return {
    duplicate: false,
    status: 'received',
    id: String(event._id),
    jobId: String(job._id),
    externalEventId,
  };
}

function toEventDto(row) {
  return {
    id: String(row._id),
    channel: row.channel,
    externalEventId: row.externalEventId,
    topic: row.topic || '',
    status: row.status,
    duplicateCount: row.duplicateCount || 0,
    correlationId: row.correlationId || '',
    receivedAt: row.receivedAt,
    processedAt: row.processedAt,
    lastError: row.lastError || '',
    applied: Boolean(row.applied),
  };
}

async function listEvents(tenantId) {
  const rows = await WebhookEvent.find({ tenantId })
    .sort({ receivedAt: -1 })
    .limit(100)
    .setOptions({ skipTenantFilter: true });
  return rows.map(toEventDto);
}

async function retryEvent(tenantId, userId, id) {
  const row = await WebhookEvent.findOne({ _id: id, tenantId }).setOptions({ skipTenantFilter: true });
  if (!row) throw new HttpError(404, 'Webhook not found');
  if (row.status !== 'failed') throw new HttpError(409, 'Only a failed webhook can be retried');
  row.status = 'received';
  row.lastError = '';
  await row.save();
  const job = await enqueue({
    tenantId,
    channel: row.channel,
    jobType: 'webhook_dispatch',
    triggeredBy: 'manual',
    triggeredByUserId: userId,
    webhookEventId: row._id,
  });
  return { id: String(row._id), jobId: String(job._id), status: 'received' };
}

module.exports = {
  acceptWebhook,
  listEvents,
  retryEvent,
  toEventDto,
};
