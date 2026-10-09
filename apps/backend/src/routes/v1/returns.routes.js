const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const returns = require('../../controllers/returns.controller');

const router = require('express').Router();
const approve = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('returns.approve')];

router.get('/', ...approve, asyncHandler(returns.listReturns));
router.post('/:returnNo/approve', ...approve, asyncHandler(returns.approveReturn));
router.post('/:returnNo/receive', ...approve, asyncHandler(returns.receiveReturn));
router.post(
  '/approve-restock',
  ...approve,
  body('items').isArray({ min: 1 }),
  validate,
  asyncHandler(returns.approveRestock),
);

module.exports = router;
