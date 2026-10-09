const { successResponse } = require('../utils/response');
const { HttpError } = require('../utils/httpError');
const { sessionTenantId } = require('../lib/tenantAccess');
const { acceptWebhook, listEvents, retryEvent } = require('../services/webhookInbox.service');
const { enqueueManual, listJobs, queueEngine, requeueJob } = require('../services/jobQueue.service');

function merchantTenant(req) {
  const tenantId = sessionTenantId(req);
  if (!tenantId || req.skipTenantFilter) throw new HttpError(400, 'Open a merchant tenant first');
  return tenantId;
}

async function ingest(req, res) {
  const rawBody = req.rawBody && req.rawBody.length
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body || {}));
  const result = await acceptWebhook({
    channel: req.params.channel,
    rawBody,
    headers: req.headers,
  });
  const message = result.duplicate ? 'Duplicate webhook ignored' : 'Webhook accepted';
  return successResponse(res, result, message);
}

async function listWebhookEvents(req, res) {
  const rows = await listEvents(merchantTenant(req));
  return successResponse(res, rows, 'Webhook events');
}

async function retryWebhook(req, res) {
  const result = await retryEvent(merchantTenant(req), req.user?.id, req.params.id);
  return successResponse(res, result, 'Webhook requeued');
}

async function listIntegrationJobs(req, res) {
  const rows = await listJobs(merchantTenant(req));
  return successResponse(res, rows, 'Integration jobs', 200, { queue: queueEngine() });
}

async function createJob(req, res) {
  const result = await enqueueManual(merchantTenant(req), req.user?.id, req.body);
  return successResponse(res, result, 'Job queued', 201);
}

async function retryIntegrationJob(req, res) {
  const result = await requeueJob(merchantTenant(req), req.user?.id, req.params.id);
  return successResponse(res, result, 'Job requeued');
}

module.exports = {
  ingest,
  listWebhookEvents,
  retryWebhook,
  listIntegrationJobs,
  createJob,
  retryIntegrationJob,
};
