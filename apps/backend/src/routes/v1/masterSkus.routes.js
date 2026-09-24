const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const masterSkus = require('../../controllers/masterSkus.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, requirePermission('catalog.view')];
const edit = [authMiddleware, tenantMiddleware, requirePermission('catalog.edit')];

router.get('/', ...view, asyncHandler(masterSkus.listMasterSkus));
router.get('/:id', ...view, asyncHandler(masterSkus.getMasterSku));
router.post(
  '/',
  ...edit,
  body('name').trim().isLength({ min: 2 }).withMessage('Name is required'),
  validate,
  asyncHandler(masterSkus.createMasterSku),
);
router.patch('/:id', ...edit, asyncHandler(masterSkus.updateMasterSku));

module.exports = router;
