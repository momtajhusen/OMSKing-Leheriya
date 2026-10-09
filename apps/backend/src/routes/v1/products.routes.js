const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const { uploadProductImage } = require('../../middleware/uploadImage');
const products = require('../../controllers/products.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, vendorScope('catalog'), requirePermission('catalog.view')];
const edit = [authMiddleware, tenantMiddleware, vendorScope('catalog'), requirePermission('catalog.edit')];

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
router.delete('/:id', ...edit, asyncHandler(products.deleteProduct));
router.post('/:id/images', ...edit, uploadProductImage, asyncHandler(products.addImage));
router.post('/:id/variants', ...edit, asyncHandler(products.addVariant));

module.exports = router;
