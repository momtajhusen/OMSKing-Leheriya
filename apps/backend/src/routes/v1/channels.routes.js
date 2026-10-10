const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const channels = require('../../controllers/channels.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, vendorScope('channels'), requirePermission('settings.manage')];
const statusGate = [authMiddleware, tenantMiddleware];
const vendorGate = [authMiddleware, tenantMiddleware, vendorScope('vendors'), requirePermission('vendors.manage')];

router.get('/shopify/vendors', ...vendorGate, asyncHandler(channels.listShopifyVendors));
router.get('/status', ...statusGate, asyncHandler(channels.listStatus));
router.get('/', ...gate, asyncHandler(channels.listConnections));
router.patch('/:channel', ...gate, asyncHandler(channels.saveConnection));
router.post('/:channel/test', ...gate, asyncHandler(channels.testConnection));

module.exports = router;
