const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const warehouses = require('../../controllers/warehouses.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, vendorScope('inventory'), requirePermission('inventory.view')];
const adjust = [authMiddleware, tenantMiddleware, vendorScope('inventory'), requirePermission('inventory.adjust')];
const settings = [authMiddleware, tenantMiddleware, vendorScope('inventory'), requirePermission('settings.manage')];

router.get('/', ...view, asyncHandler(warehouses.list));
router.get('/config', ...view, asyncHandler(warehouses.getConfig));
router.patch('/config', ...settings, asyncHandler(warehouses.patchConfig));
router.get('/links', ...view, asyncHandler(warehouses.listLinks));
router.get('/links/history', ...settings, asyncHandler(warehouses.linkHistory));
router.get('/links/export', ...settings, asyncHandler(warehouses.exportLinks));
router.post('/links', ...settings, asyncHandler(warehouses.addLink));
router.patch('/links/:linkId', ...settings, asyncHandler(warehouses.updateLink));
router.delete('/links/:linkId', ...settings, asyncHandler(warehouses.removeLink));
router.post(
  '/',
  ...adjust,
  body('name').trim().notEmpty().withMessage('Name is required'),
  validate,
  asyncHandler(warehouses.create),
);
router.patch('/:id', ...adjust, asyncHandler(warehouses.update));
router.get('/:id/delete-check', ...settings, asyncHandler(warehouses.deleteCheck));
router.delete('/:id', ...settings, asyncHandler(warehouses.remove));

module.exports = router;
