const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const finance = require('../../controllers/finance.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('finance.view')];

router.get('/', ...view, asyncHandler(finance.salesReport));

module.exports = router;
