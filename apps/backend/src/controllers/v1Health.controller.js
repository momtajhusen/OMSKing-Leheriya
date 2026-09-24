const { successResponse } = require('../utils/response');
const mongoose = require('mongoose');
const config = require('../config');

function mongoState() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  return states[mongoose.connection.readyState] || 'unknown';
}

const healthCheck = (req, res) => {
  const db = mongoState();
  const ok = db === 'connected';
  return successResponse(
    res,
    {
      service: 'OMSKing Backend',
      version: 'v1',
      status: ok ? 'running' : 'degraded',
      port: Number(config.port),
      env: config.nodeEnv,
      mongo: db,
      timestamp: new Date().toISOString(),
    },
    ok ? 'OMSKing API v1 running' : 'OMSKing API up but MongoDB is not connected',
    ok ? 200 : 503,
  );
};

module.exports = {
  healthCheck,
};
