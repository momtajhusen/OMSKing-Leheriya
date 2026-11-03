const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { uploadSupportMedia } = require('../../middleware/uploadSupportMedia');
const support = require('../../controllers/supportChat.controller');

const router = require('express').Router();
const merchant = [authMiddleware, tenantMiddleware, support.merchantReporter];
const platform = [authMiddleware, tenantMiddleware, requirePermission('tenants.manage'), support.platformThread];

/** <img>/<video>/<audio> cannot send a bearer token, so media links carry an HMAC signature instead. */
router.get('/media/:id', asyncHandler(support.media));

router.get('/messages', ...merchant, asyncHandler(support.listOwn));
router.post('/messages', ...merchant, uploadSupportMedia, asyncHandler(support.sendOwn));
router.delete('/messages/:id', ...merchant, asyncHandler(support.deleteMessage));
router.post('/read', ...merchant, asyncHandler(support.readOwn));
router.get('/unread', ...merchant, asyncHandler(support.unreadOwn));
router.get('/updates', ...merchant, asyncHandler(support.listOwnUpdates));
router.post('/updates', ...merchant, asyncHandler(support.createOwnUpdate));
router.patch('/updates/:id', ...merchant, asyncHandler(support.markOwnUpdate));

router.get('/threads', authMiddleware, tenantMiddleware, requirePermission('tenants.manage'), asyncHandler(support.listThreads));
router.get('/all-updates', authMiddleware, tenantMiddleware, requirePermission('tenants.manage'), asyncHandler(support.listAllUpdates));
router.get('/threads/:tenantId/messages', ...platform, asyncHandler(support.listThread));
router.post('/threads/:tenantId/messages', ...platform, uploadSupportMedia, asyncHandler(support.sendThread));
router.delete('/threads/:tenantId/messages/:id', ...platform, asyncHandler(support.deleteMessage));
router.post('/threads/:tenantId/read', ...platform, asyncHandler(support.readThread));
router.get('/threads/:tenantId/updates', ...platform, asyncHandler(support.listThreadUpdates));
router.post('/threads/:tenantId/updates', ...platform, asyncHandler(support.createThreadUpdate));
router.patch('/threads/:tenantId/updates/:id', ...platform, asyncHandler(support.markThreadUpdate));

module.exports = router;
