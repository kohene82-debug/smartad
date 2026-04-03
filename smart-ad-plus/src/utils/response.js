const success = (res, data = {}, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, data });
};

const created = (res, data = {}, message = 'Created') => {
  return res.status(201).json({ success: true, message, data });
};

const error = (res, message = 'An error occurred', statusCode = 400, details = null) => {
  const body = { success: false, message };
  if (details && process.env.NODE_ENV !== 'production') body.details = details;
  return res.status(statusCode).json(body);
};

const unauthorized = (res, message = 'Unauthorized') => error(res, message, 401);
const forbidden    = (res, message = 'Forbidden')     => error(res, message, 403);
const notFound     = (res, message = 'Not found')     => error(res, message, 404);
const serverError  = (res, message = 'Internal server error', details = null) =>
  error(res, message, 500, details);

module.exports = { success, created, error, unauthorized, forbidden, notFound, serverError };
