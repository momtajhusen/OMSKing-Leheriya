const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { passwordRules } = require('../../middleware/passwordRules');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const vendors = require('../../controllers/vendors.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, vendorScope('vendors'), requirePermission('orders.view')];
const manage = [authMiddleware, tenantMiddleware, vendorScope('vendors'), requirePermission('vendors.manage')];

router.get('/', ...view, asyncHandler(vendors.listVendors));
router.patch('/me', ...view, asyncHandler(vendors.updateMe));
router.post('/', ...manage, asyncHandler(vendors.createVendor));
router.post('/import', ...manage, asyncHandler(vendors.importVendors));
router.post('/:id/password', ...manage, ...passwordRules(), validate, asyncHandler(vendors.setVendorPassword));
router.patch('/:id', ...manage, asyncHandler(vendors.updateVendor));
router.delete('/:id', ...manage, asyncHandler(vendors.removeVendor));

module.exports = router;
