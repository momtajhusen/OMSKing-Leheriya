const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const finance = require('../../controllers/finance.controller');

const router = require('express').Router();
const reconcile = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('finance.reconcile')];

router.post('/settlements', ...reconcile, asyncHandler(finance.matchSettlement));
router.post('/returns', ...reconcile, asyncHandler(finance.matchReturnFile));
router.post('/courier-bills', ...reconcile, asyncHandler(finance.matchCourierBill));

module.exports = router;
