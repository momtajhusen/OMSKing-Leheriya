const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { passwordRules } = require('../../middleware/passwordRules');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const auth = require('../../controllers/auth.controller');

const router = require('express').Router();

router.post(
  '/login',
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Enter a valid email address'),
  body('password').notEmpty().withMessage('Password is required').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  validate,
  asyncHandler(auth.login),
);
router.post(
  '/register',
  body('name').trim().isLength({ min: 2 }).withMessage('Full name must be at least 2 characters'),
  body('email').trim().isEmail().withMessage('Enter a valid email address'),
  body('company').trim().isLength({ min: 2 }).withMessage('Company name is required'),
  ...passwordRules(),
  validate,
  asyncHandler(auth.register),
);
router.post('/refresh', asyncHandler(auth.refresh));
router.post('/logout', asyncHandler(auth.logout));
router.post(
  '/forgot-password',
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Enter a valid email address'),
  validate,
  asyncHandler(auth.forgotPassword),
);
router.post(
  '/reset-password',
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Enter a valid email address'),
  body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('Enter the 6-digit OTP from Gmail').isNumeric().withMessage('OTP must be 6 digits'),
  ...passwordRules(),
  validate,
  asyncHandler(auth.resetPassword),
);

router.get('/me', authMiddleware, tenantMiddleware, asyncHandler(auth.me));
router.patch('/me', authMiddleware, tenantMiddleware, asyncHandler(auth.patchMe));
router.post('/exit-impersonation', authMiddleware, tenantMiddleware, asyncHandler(auth.exitImpersonation));
router.get(
  '/password-resets',
  authMiddleware,
  tenantMiddleware,
  requirePermission('users.manage'),
  asyncHandler(auth.listPasswordResets),
);

module.exports = router;
