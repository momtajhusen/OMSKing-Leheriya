const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const roles = require('../../controllers/roles.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, requirePermission('users.manage')];

router.get('/', ...gate, asyncHandler(roles.listRoles));
router.patch('/:id', ...gate, asyncHandler(roles.updateRolePermissions));

module.exports = router;
