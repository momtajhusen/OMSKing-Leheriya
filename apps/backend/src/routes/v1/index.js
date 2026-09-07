const express = require('express');
const { healthCheck } = require('../../controllers/v1Health.controller');

const router = express.Router();

router.get('/', healthCheck);

module.exports = router;
