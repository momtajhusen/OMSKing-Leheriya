const { asyncHandler } = require('../../utils/asyncHandler');
const { authMiddleware } = require('../../middleware/auth');
const { tenantMiddleware } = require('../../middleware/tenant');
const { requirePermission } = require('../../middleware/requirePermission');
const { vendorScope } = require('../../middleware/vendorScope');
const orders = require('../../controllers/orders.controller');

const router = require('express').Router();
const view = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('orders.view')];
const edit = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('orders.edit')];
const ship = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('shipping.generate')];
const cancelShip = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('shipping.cancel')];
const finance = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('finance.view')];
const reconcile = [authMiddleware, tenantMiddleware, vendorScope('orders'), requirePermission('finance.reconcile')];

router.post('/labels/bulk', ...ship, asyncHandler(orders.bookBulkLabels));
router.post('/manifest', ...ship, asyncHandler(orders.closeManifest));
router.get('/', ...view, asyncHandler(orders.listOrders));
router.get('/:orderId', ...view, asyncHandler(orders.getOrder));
router.post('/:orderId/label', ...ship, asyncHandler(orders.generateLabel));
router.post('/:orderId/ship', ...ship, asyncHandler(orders.shipOrder));
router.post('/:orderId/label/cancel', ...cancelShip, asyncHandler(orders.cancelLabel));
router.post('/:orderId/invoice', ...finance, asyncHandler(orders.generateInvoice));
router.post('/:orderId/payment', ...reconcile, asyncHandler(orders.markPaid));
router.patch('/:orderId/sub-orders/:subOrderId', ...edit, asyncHandler(orders.assignSubOrder));
router.patch('/:orderId/sub-orders/:subOrderId/vendor', ...edit, asyncHandler(orders.vendorUpdate));
router.patch('/:orderId/status', ...edit, asyncHandler(orders.patchStatus));
router.post('/:orderId/reverse', ...edit, asyncHandler(orders.bookReverse));

module.exports = router;
