const express = require('express');
const { healthCheck } = require('../../controllers/v1Health.controller');
const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const rolesRoutes = require('./roles.routes');
const tenantsRoutes = require('./tenants.routes');
const sessionsRoutes = require('./sessions.routes');
const productsRoutes = require('./products.routes');
const masterSkusRoutes = require('./masterSkus.routes');
const skuMappingsRoutes = require('./skuMappings.routes');
const channelsRoutes = require('./channels.routes');
const warehousesRoutes = require('./warehouses.routes');
const inventoryRoutes = require('./inventory.routes');

const router = express.Router();

router.get('/', healthCheck);
router.get('/health', healthCheck);
router.use('/auth', authRoutes);
router.use('/users', usersRoutes);
router.use('/roles', rolesRoutes);
router.use('/tenants', tenantsRoutes);
router.use('/sessions', sessionsRoutes);
router.use('/products', productsRoutes);
router.use('/master-skus', masterSkusRoutes);
router.use('/sku-mappings', skuMappingsRoutes);
router.use('/channels', channelsRoutes);
router.use('/warehouses', warehousesRoutes);
router.use('/inventory', inventoryRoutes);

module.exports = router;
