const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { passwordRules } = require('../../middleware/passwordRules');
const { authMiddleware } = require('../../middleware/auth');
const { uploadAvatarImage } = require('../../middleware/uploadImage');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const auth = require('../../controllers/auth.controller');

const router = require('express').Router();

router.post(
  '/login',
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Enter a valid email address'),
  body('password').notEmpty().withMessage('Password is required').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('workspace').optional().trim().isLength({ max: 80 }),
  validate,
  asyncHandler(auth.login),
);
router.post('/demo', asyncHandler(auth.demoLogin));
router.post(
  '/register',
  body('plan').optional().isIn(['starter', 'growth', 'enterprise']).withMessage('Choose Starter, Growth, or Enterprise'),
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
  body('workspace').optional().trim().isLength({ max: 80 }),
  validate,
  asyncHandler(auth.forgotPassword),
);
router.post(
  '/reset-password',
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Enter a valid email address'),
  body('otp').trim().isLength({ min: 6, max: 6 }).withMessage('Enter the 6-digit OTP from Gmail').isNumeric().withMessage('OTP must be 6 digits'),
  body('workspace').optional().trim().isLength({ max: 80 }),
  ...passwordRules(),
  validate,
  asyncHandler(auth.resetPassword),
);

router.get('/me', authMiddleware, tenantMiddleware, asyncHandler(auth.me));
router.patch('/me', authMiddleware, tenantMiddleware, asyncHandler(auth.patchMe));
router.post('/me/avatar', authMiddleware, tenantMiddleware, uploadAvatarImage, asyncHandler(auth.uploadMyAvatar));
router.delete('/me/avatar', authMiddleware, tenantMiddleware, asyncHandler(auth.clearMyAvatar));
router.post('/exit-impersonation', authMiddleware, tenantMiddleware, asyncHandler(auth.exitImpersonation));
router.get(
  '/password-resets',
  authMiddleware,
  tenantMiddleware,
  requirePermission('users.manage'),
  asyncHandler(auth.listPasswordResets),
);

module.exports = router;
