const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const ndr = require('../../controllers/ndr.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('orders.view')];
const edit = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('orders.edit')];

router.get('/', ...view, asyncHandler(ndr.listNdr));
router.post('/poll', ...edit, asyncHandler(ndr.poll));
router.post('/:orderNo/reattempt', ...edit, asyncHandler(ndr.reattempt));
router.post('/:orderNo/rto', ...edit, asyncHandler(ndr.toRto));

module.exports = router;
