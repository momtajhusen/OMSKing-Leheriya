const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const sessions = require('../../controllers/sessions.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, requirePermission('users.manage')];

router.get('/', ...gate, asyncHandler(sessions.listSessions));
router.delete('/:id', ...gate, asyncHandler(sessions.revokeSession));

module.exports = router;
