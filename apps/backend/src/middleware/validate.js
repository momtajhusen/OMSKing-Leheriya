const { validationResult } = require('express-validator');
const { errorResponse } = require('../utils/response');

function validate(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const errors = result.array().map((item) => ({
    field: item.path,
    message: item.msg,
  }));
  return errorResponse(res, 'Validation failed', 400, errors);
}

module.exports = { validate };
