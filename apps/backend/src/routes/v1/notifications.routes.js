const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const notifications = require('../../controllers/notifications.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, vendorScope('settings'), requirePermission('settings.manage')];

router.get('/', ...gate, asyncHandler(notifications.getNotifications));
router.patch('/', ...gate, asyncHandler(notifications.patchNotifications));

module.exports = router;
