const { successResponse } = require('../../utils/response');

const healthCheck = (req, res) => {
  return successResponse(res, {
    service: 'OMSKing Backend',
    version: 'v1',
    status: 'running',
    timestamp: new Date().toISOString(),
  }, 'OMSKing API v1 running');
};

module.exports = {
  healthCheck,
};
