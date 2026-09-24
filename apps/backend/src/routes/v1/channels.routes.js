const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const channels = require('../../controllers/channels.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, requirePermission('settings.manage')];

router.get('/', ...gate, asyncHandler(channels.listConnections));
router.patch('/:channel', ...gate, asyncHandler(channels.saveConnection));
router.post('/:channel/test', ...gate, asyncHandler(channels.testConnection));

module.exports = router;
