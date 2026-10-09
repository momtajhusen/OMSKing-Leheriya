const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const demo = require('../../controllers/demoRequest.controller');

const router = require('express').Router();

router.post(
  '/',
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Full name is required'),
  body('email').trim().isEmail().withMessage('Enter a valid work email'),
  body('phone').trim().custom((value) => /^(?:\+91)?[6-9]\d{9}$/.test(String(value).replace(/[\s-]/g, ''))).withMessage('Enter a 10-digit mobile number'),
  body('company').trim().isLength({ min: 2, max: 120 }).withMessage('Company name is required'),
  body('city').optional({ values: 'falsy' }).trim().isLength({ max: 80 }),
  body('monthlyOrders').isIn(demo.ORDER_BANDS).withMessage('Choose a monthly order band'),
  body('channels').isArray({ min: 1, max: 3 }).withMessage('Choose at least one channel'),
  body('channels.*').isIn(demo.CHANNELS),
  body('message').optional({ values: 'falsy' }).trim().isLength({ max: 1000 }),
  validate,
  asyncHandler(demo.createDemoRequest),
);

router.get(
  '/',
  authMiddleware,
  tenantMiddleware,
  requirePermission('tenants.manage'),
  asyncHandler(demo.listDemoRequests),
);

module.exports = router;
