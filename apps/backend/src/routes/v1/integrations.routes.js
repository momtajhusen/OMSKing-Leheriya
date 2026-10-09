const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const integrations = require('../../controllers/integrations.controller');
const myntra = require('../../controllers/myntra.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, vendorScope('settings'), requirePermission('settings.manage')];
const ordersGate = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('orders.view')];

router.get('/myntra/status', ...gate, asyncHandler(myntra.status));
router.post('/myntra/push-token', ...gate, asyncHandler(myntra.rotatePushToken));
router.post('/myntra/orders/pull', ...gate, asyncHandler(myntra.pullOrders));
router.get('/myntra/inventory', ...gate, asyncHandler(myntra.stock));
router.post('/myntra/inventory', ...gate, asyncHandler(myntra.pushStock));
router.get('/myntra/packets/:packetId/:type', ...ordersGate, asyncHandler(myntra.packetDocument));

// Myntra PPMP outbound calls ("seller domain" = <public host>/api/v1/integrations/myntra).
router.post('/myntra/storefront/v4/order/:sellerOrderId', myntra.storefrontCreateOrder);
router.put('/myntra/storefront/v4/order/:sellerOrderId/:eventType', myntra.storefrontOrderEvent);
router.post('/myntra/storefront/v4/return/:returnId', myntra.storefrontCreateReturn);
router.put('/myntra/storefront/v4/return/:returnId/update', myntra.storefrontUpdateReturn);

router.get('/jobs', ...gate, asyncHandler(integrations.listIntegrationJobs));
router.post('/jobs', ...gate, asyncHandler(integrations.createJob));
router.post('/jobs/:id/retry', ...gate, asyncHandler(integrations.retryIntegrationJob));
router.get('/webhooks', ...gate, asyncHandler(integrations.listWebhookEvents));
router.post('/webhooks/:id/retry', ...gate, asyncHandler(integrations.retryWebhook));
router.post('/:channel/webhook', asyncHandler(integrations.ingest));

module.exports = router;
