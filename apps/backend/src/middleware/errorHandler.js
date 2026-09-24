const { errorResponse } = require('../utils/response');
const { HttpError } = require('../utils/httpError');

const notFoundHandler = (req, res) => {
  return errorResponse(res, `Route ${req.method} ${req.originalUrl} not found`, 404);
};

const globalErrorHandler = (err, req, res, next) => {
  if (err instanceof HttpError) {
    return errorResponse(res, err.message, err.statusCode, err.errors);
  }
  console.error('[ERROR]', err);
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  return errorResponse(res, message, statusCode);
};

module.exports = {
  notFoundHandler,
  globalErrorHandler,
};
