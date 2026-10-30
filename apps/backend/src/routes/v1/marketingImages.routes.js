const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { uploadMarketingImage } = require('../../middleware/uploadImage');
const images = require('../../controllers/marketingImages.controller');

const router = require('express').Router();
const gate = [authMiddleware, tenantMiddleware, requirePermission('tenants.manage')];

router.get('/', asyncHandler(images.publicImages));
router.get('/manage', ...gate, asyncHandler(images.listImages));
router.put('/:name', ...gate, images.checkName, uploadMarketingImage, asyncHandler(images.saveImage));
router.patch('/:name', ...gate, images.checkName, asyncHandler(images.updateImage));
router.delete('/:name', ...gate, images.checkName, asyncHandler(images.removeImage));

module.exports = router;
