const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const sku = require('../../controllers/skuMappings.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, requirePermission('catalog.view')];
const edit = [authMiddleware, tenantMiddleware, requirePermission('catalog.edit')];

router.get('/', ...view, asyncHandler(sku.listMappings));
router.get('/unlisted', ...view, asyncHandler(sku.listUnlisted));
router.get('/summary', ...view, asyncHandler(sku.mappingSummary));
router.get('/import-order', ...view, asyncHandler(sku.importOrderHint));
router.post('/import', ...edit, asyncHandler(sku.importListings));
router.post('/', ...edit, asyncHandler(sku.ingest));
router.post(
  '/:id/map',
  ...edit,
  body('masterSkuCode').trim().notEmpty().withMessage('Master SKU code is required'),
  validate,
  asyncHandler(sku.mapToMaster),
);
router.post('/:id/create-as-new', ...edit, asyncHandler(sku.createAsNew));
router.post('/:id/unmap', ...edit, asyncHandler(sku.unmap));
router.post('/:id/retry', ...edit, asyncHandler(sku.retry));

module.exports = router;
