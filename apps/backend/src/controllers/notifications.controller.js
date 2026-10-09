const { successResponse } = require('../utils/response');
const { merchantTenant } = require('./products.controller');
const { loadTenant, publicSettings, saveNotificationSettings, recentAlerts } = require('../services/notify.service');

async function getNotifications(req, res) {
  const tenant = await loadTenant(merchantTenant(req));
  const settings = publicSettings(tenant);
  settings.recent = await recentAlerts(tenant?._id);
  return successResponse(res, settings, 'Notification settings');
}

async function patchNotifications(req, res) {
  const tenantId = merchantTenant(req);
  const saved = await saveNotificationSettings(tenantId, req.body || {});
  saved.recent = await recentAlerts(tenantId);
  return successResponse(res, saved, 'Notification settings saved');
}

module.exports = { getNotifications, patchNotifications };
