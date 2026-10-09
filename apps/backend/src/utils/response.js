const successResponse = (res, data = null, message = 'Success', statusCode = 200, meta = null) => {
  const payload = {
    success: true,
    message,
    data,
  };
  if (meta) payload.meta = meta;
  return res.status(statusCode).json(payload);
};

const errorResponse = (res, message = 'Something went wrong', statusCode = 500, errors = null, data = null) => {
  const payload = {
    success: false,
    message,
  };
  if (errors) payload.errors = errors;
  if (data) payload.data = data;
  return res.status(statusCode).json(payload);
};

const paginatedResponse = (res, data, page, limit, total, message = 'Success', extra = null) => {
  const totalPages = Math.ceil(total / limit) || 1;
  return res.status(200).json({
    success: true,
    message,
    data,
    meta: {
      page: Number(page),
      limit: Number(limit),
      total: Number(total),
      totalPages,
      hasNext: Number(page) < totalPages,
      hasPrev: Number(page) > 1,
      ...(extra || {}),
    },
  });
};

module.exports = {
  successResponse,
  errorResponse,
  paginatedResponse,
};
