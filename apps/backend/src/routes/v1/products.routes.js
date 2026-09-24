const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const products = require('../../controllers/products.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, requirePermission('catalog.view')];
const edit = [authMiddleware, tenantMiddleware, requirePermission('catalog.edit')];

router.get('/', ...view, asyncHandler(products.listProducts));
router.get('/:id', ...view, asyncHandler(products.getProduct));
router.post(
  '/',
  ...edit,
  body('name').trim().isLength({ min: 2 }).withMessage('Product name is required'),
  validate,
  asyncHandler(products.createProduct),
);
router.patch('/:id', ...edit, asyncHandler(products.updateProduct));
router.post('/:id/variants', ...edit, asyncHandler(products.addVariant));

module.exports = router;
