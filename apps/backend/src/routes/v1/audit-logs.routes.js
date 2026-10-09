const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const auditLogs = require('../../controllers/auditLogs.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, vendorScope('settings'), requirePermission('users.manage')];

router.get('/', ...gate, asyncHandler(auditLogs.list));

module.exports = router;
