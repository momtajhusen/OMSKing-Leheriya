const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const setup = require('../../controllers/setup.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, requirePermission('settings.manage')];

router.get('/checklist', ...gate, asyncHandler(setup.tenantSetup));

module.exports = router;
