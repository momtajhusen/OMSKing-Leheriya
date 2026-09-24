const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const warehouses = require('../../controllers/warehouses.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, requirePermission('inventory.view')];
const adjust = [authMiddleware, tenantMiddleware, requirePermission('inventory.adjust')];
const settings = [authMiddleware, tenantMiddleware, requirePermission('settings.manage')];

router.get('/', ...view, asyncHandler(warehouses.list));
router.get('/config', ...view, asyncHandler(warehouses.getConfig));
router.patch('/config', ...settings, asyncHandler(warehouses.patchConfig));
router.post(
  '/',
  ...adjust,
  body('name').trim().notEmpty().withMessage('Name is required'),
  validate,
  asyncHandler(warehouses.create),
);
router.patch('/:id', ...adjust, asyncHandler(warehouses.update));

module.exports = router;
