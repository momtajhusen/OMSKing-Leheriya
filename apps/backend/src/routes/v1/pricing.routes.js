const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const pricing = require('../../controllers/pricing.controller');

const router = require('express').Router();

router.get('/', asyncHandler(pricing.getPricing));
router.post('/razorpay-webhook', asyncHandler(pricing.razorpayWebhook));
router.get('/mine', authMiddleware, tenantMiddleware, asyncHandler(pricing.mine));
router.get('/mine/upi', authMiddleware, tenantMiddleware, requirePermission('settings.manage'), asyncHandler(pricing.upi));
router.post('/mine/checkout', authMiddleware, tenantMiddleware, requirePermission('settings.manage'), asyncHandler(pricing.checkout));
router.post('/mine/confirm', authMiddleware, tenantMiddleware, requirePermission('settings.manage'), asyncHandler(pricing.confirm));
router.post('/mine/reference', authMiddleware, tenantMiddleware, requirePermission('settings.manage'), asyncHandler(pricing.reference));
router.get(
  '/subscriptions',
  authMiddleware,
  tenantMiddleware,
  requirePermission('tenants.manage'),
  asyncHandler(pricing.subscriptions),
);
router.post(
  '/subscriptions/:tenantId/payments',
  authMiddleware,
  tenantMiddleware,
  requirePermission('tenants.manage'),
  asyncHandler(pricing.recordPayment),
);
router.post(
  '/inquiries',
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Name is required'),
  body('email').trim().isEmail().withMessage('Enter a valid email'),
  body('phone').optional({ values: 'falsy' }).trim().custom((value) => /^(?:\+91)?[6-9]\d{9}$/.test(String(value).replace(/[\s-]/g, ''))).withMessage('Enter a 10-digit mobile number'),
  body('company').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
  body('orders').optional({ values: 'falsy' }).trim().isLength({ max: 40 }),
  body('products').optional({ values: 'falsy' }).trim().isLength({ max: 40 }),
  body('channels').optional({ values: 'falsy' }).trim().isLength({ max: 120 }),
  body('city').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  body('message').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
  validate,
  asyncHandler(pricing.createInquiry),
);
router.get(
  '/inquiries',
  authMiddleware,
  tenantMiddleware,
  requirePermission('tenants.manage'),
  asyncHandler(pricing.listInquiries),
);
router.put(
  '/',
  authMiddleware,
  tenantMiddleware,
  requirePermission('tenants.manage'),
  body('minimumMonthly').isFloat({ min: 0 }).withMessage('Minimum monthly charge must be 0 or more'),
  body('slabs').isArray({ min: 1, max: 8 }).withMessage('Add between 1 and 8 order slabs'),
  validate,
  asyncHandler(pricing.putPricing),
);

module.exports = router;
