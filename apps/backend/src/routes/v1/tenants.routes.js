const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const tenants = require('../../controllers/tenants.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, requirePermission('tenants.manage')];

router.get('/', ...gate, asyncHandler(tenants.listTenants));
router.post(
  '/',
  ...gate,
  body('name').trim().isLength({ min: 2 }).withMessage('Merchant name must be at least 2 characters'),
  body('email').trim().isEmail().withMessage('Enter a valid owner email'),
  validate,
  asyncHandler(tenants.createTenant),
);
router.patch('/:id', ...gate, asyncHandler(tenants.patchTenant));
router.post('/:id/impersonate', ...gate, asyncHandler(tenants.impersonate));

module.exports = router;
