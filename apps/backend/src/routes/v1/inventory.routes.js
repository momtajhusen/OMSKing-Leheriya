const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const inventory = require('../../controllers/inventory.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, requirePermission('inventory.view')];
const edit = [authMiddleware, tenantMiddleware, requirePermission('inventory.adjust')];

router.get('/', ...view, asyncHandler(inventory.list));
router.get('/ats', ...view, asyncHandler(inventory.ats));
router.get('/ledger', ...view, asyncHandler(inventory.ledger));
router.get('/alerts', ...view, asyncHandler(inventory.alerts));
router.post('/stock-in', ...edit, body('masterSkuId').notEmpty(), body('warehouseId').notEmpty(), validate, asyncHandler(inventory.inStock));
router.post('/stock-out', ...edit, body('masterSkuId').notEmpty(), body('warehouseId').notEmpty(), validate, asyncHandler(inventory.outStock));
router.post('/adjust', ...edit, body('masterSkuId').notEmpty(), body('warehouseId').notEmpty(), validate, asyncHandler(inventory.adjust));
router.patch('/:id/threshold', ...edit, asyncHandler(inventory.threshold));
router.post('/reserve', ...edit, body('masterSkuId').notEmpty(), validate, asyncHandler(inventory.reserve));
router.post('/release', ...edit, asyncHandler(inventory.release));
router.post('/consume', ...edit, asyncHandler(inventory.consume));
router.post('/stress-test', ...edit, body('masterSkuId').notEmpty(), validate, asyncHandler(inventory.stress));

module.exports = router;
