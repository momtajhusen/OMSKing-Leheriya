const { body } = require('express-validator');
const { asyncHandler } = require('../../utils/asyncHandler');
const { validate } = require('../../middleware/validate');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const users = require('../../controllers/users.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, requirePermission('users.manage')];

router.get('/', ...gate, asyncHandler(users.listUsers));
router.post(
  '/',
  ...gate,
  body('name').trim().isLength({ min: 2 }).withMessage('Name must be at least 2 characters'),
  body('email').trim().isEmail().withMessage('Enter a valid email address'),
  body('role').trim().notEmpty().withMessage('Select a role'),
  validate,
  asyncHandler(users.createUser),
);
router.patch('/:id', ...gate, asyncHandler(users.updateUser));
router.patch('/:id/status', ...gate, asyncHandler(users.patchUserStatus));

module.exports = router;
