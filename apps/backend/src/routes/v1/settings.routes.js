const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const settings = require('../../controllers/settings.controller');

const router = require('express').Router();
const company = [authMiddleware, tenantMiddleware, vendorScope('settings'), requirePermission('settings.manage')];
const keys = [authMiddleware, tenantMiddleware, vendorScope('settings'), requirePermission('users.manage')];

router.get('/company', ...company, asyncHandler(settings.getCompany));
router.patch(
  '/company',
  ...company,
  body('companyName').optional().trim().isLength({ min: 2 }).withMessage('Company name is required'),
  body('gstin').optional().trim().isLength({ min: 15, max: 15 }).withMessage('GSTIN must be 15 characters'),
  body('pan').optional().trim().isLength({ min: 10, max: 10 }).withMessage('PAN must be 10 characters'),
  body('supportEmail').optional().trim().isEmail().withMessage('Invalid email format'),
  body('gmailUser').optional({ values: 'falsy' }).trim().isEmail().withMessage('Enter the company Gmail address'),
  body('gmailAppPassword').optional().trim(),
  validate,
  asyncHandler(settings.patchCompany),
);
router.get('/tax', ...company, asyncHandler(settings.getTax));
router.patch('/tax', ...company, asyncHandler(settings.patchTax));
router.post('/tax/hsn', ...company, asyncHandler(settings.uploadHsn));
router.get('/couriers', ...company, asyncHandler(settings.listCouriers));
router.post(
  '/couriers',
  ...company,
  body('source').isIn(['platform', 'own']).withMessage('Choose our courier or your own'),
  body('code').optional().trim().isLength({ min: 2, max: 60 }),
  body('name').optional().trim().isLength({ min: 2, max: 80 }).withMessage('Courier name is required'),
  body('status').optional().isIn(['active', 'inactive']),
  body('mode').optional().isIn(['air', 'surface']),
  body('priority').optional().isInt({ min: 1, max: 99 }),
  body('rateHalfKg').optional().isFloat({ min: 0, max: 100000 }),
  body('serviceability').optional().trim().isLength({ max: 120 }),
  body('credentials').optional().isObject(),
  validate,
  asyncHandler(settings.createCourier),
);
router.patch(
  '/couriers/:id',
  ...company,
  body('status').optional().isIn(['active', 'inactive']),
  body('mode').optional().isIn(['air', 'surface']),
  body('priority').optional().isInt({ min: 1, max: 99 }),
  body('rateHalfKg').optional().isFloat({ min: 0, max: 100000 }),
  body('serviceability').optional().trim().isLength({ max: 120 }),
  body('name').optional().trim().isLength({ min: 2, max: 80 }),
  body('credentials').optional().isObject(),
  validate,
  asyncHandler(settings.patchCourier),
);
router.delete('/couriers/:id', ...company, asyncHandler(settings.removeCourier));
router.get('/api-keys', ...keys, asyncHandler(settings.listApiKeys));
router.post(
  '/api-keys',
  ...keys,
  body('label').trim().isLength({ min: 2 }).withMessage('Label is required'),
  validate,
  asyncHandler(settings.createApiKey),
);
router.post('/api-keys/:id/revoke', ...keys, asyncHandler(settings.revokeApiKey));

module.exports = router;
