/**
 * Error handling middleware for Express
 * @param {Error} err - The error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} _next - Express next middleware function (unused)
 */
const errorHandler = (err, req, res, _next) => {
  console.error('Error:', err);
  
  // Default error status and message
  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.errors;
  
  // Handle specific error types
  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    statusCode = 400;
    message = 'Validation Error';
    errors = {};
    
    // Extract validation errors
    err.errors.forEach((e) => {
      if (e.path) {
        errors[e.path] = e.message;
      }
    });
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }
  
  // Send error response
  res.status(statusCode).json({
    success: false,
    message,
    errors,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
};

/**
 * 404 Not Found middleware
 */
const notFound = (req, res, _next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.status = 404;
  _next(error);
};

/**
 * Async handler to wrap async/await route handlers
 * @param {Function} fn - The async route handler function
 * @returns {Function} - Wrapped route handler with error handling
 */
const asyncHandler = (fn) => (req, res, next) => {
  return Promise.resolve(fn(req, res, next)).catch(next);
};

export { errorHandler, notFound, asyncHandler };
