const express = require('express');
const { healthCheck } = require('../../controllers/v1Health.controller');
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const rolesRoutes = require('./roles.routes');
const tenantsRoutes = require('./tenants.routes');
const sessionsRoutes = require('./sessions.routes');
const productsRoutes = require('./products.routes');
const masterSkusRoutes = require('./masterSkus.routes');
const skuMappingsRoutes = require('./skuMappings.routes');
const channelsRoutes = require('./channels.routes');
const warehousesRoutes = require('./warehouses.routes');
const inventoryRoutes = require('./inventory.routes');
const settingsRoutes = require('./settings.routes');
const integrationsRoutes = require('./integrations.routes');
const ordersRoutes = require('./orders.routes');
const returnsRoutes = require('./returns.routes');
const financeRoutes = require('./finance.routes');
const reportsRoutes = require('./reports.routes');
const ndrRoutes = require('./ndr.routes');
const vendorsRoutes = require('./vendors.routes');
const auditLogsRoutes = require('./audit-logs.routes');
const notificationsRoutes = require('./notifications.routes');
const demoRequestsRoutes = require('./demoRequests.routes');
const pricingRoutes = require('./pricing.routes');
const setupRoutes = require('./setup.routes');
const marketingImagesRoutes = require('./marketingImages.routes');
const supportRoutes = require('./support.routes');
const config = require('../../config');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { createSupportLiveProxy } = require('../../services/supportLiveProxy');
const { createReportAutofix } = require('../../services/reportAutofix');

const router = express.Router();
const supportLive = createSupportLiveProxy(config.supportLive, {
  developer: [authMiddleware, tenantMiddleware, requirePermission('tenants.manage')],
  client: [authMiddleware, tenantMiddleware],
});
const reportAutofix = createReportAutofix({
  ...config.reportAutofix, liveSettings: config.supportLive, guards: [authMiddleware, tenantMiddleware],
});

router.get('/', healthCheck);
router.get('/health', healthCheck);
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/tenants', tenantsRoutes);
router.use('/sessions', sessionsRoutes);
router.use('/products', productsRoutes);
router.use('/master-skus', masterSkusRoutes);
router.use('/sku-mappings', skuMappingsRoutes);
router.use('/channels', channelsRoutes);
router.use('/warehouses', warehousesRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/settings', settingsRoutes);
router.use('/integrations', integrationsRoutes);
router.use('/orders', ordersRoutes);
router.use('/returns', returnsRoutes);
router.use('/finance', financeRoutes);
router.use('/reports', reportsRoutes);
router.use('/ndr', ndrRoutes);
router.use('/vendors', vendorsRoutes);
router.use('/audit-logs', auditLogsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/demo-requests', demoRequestsRoutes);
router.use('/pricing', pricingRoutes);
router.use('/setup', setupRoutes);
router.use('/marketing-images', marketingImagesRoutes);
router.use('/dev/report-autofix', reportAutofix);
router.use('/support', (req, res, next) => (config.nodeEnv === 'development' ? supportLive : supportRoutes)(req, res, next));

module.exports = router;
