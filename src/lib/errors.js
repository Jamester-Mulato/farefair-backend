export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route matches ${req.method} ${req.originalUrl}`,
    },
  });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  const pgCode = error?.code;
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON.',
      },
    });
    return;
  }
  if (error?.type === 'entity.too.large') {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the 2 MB limit.',
      },
    });
    return;
  }
  if (pgCode === 'P0002') {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: error.message },
    });
    return;
  }
  if (pgCode === '23505') {
    res.status(409).json({
      error: { code: 'CONFLICT', message: 'A record with those unique values already exists.' },
    });
    return;
  }
  if (pgCode === '23503') {
    res.status(409).json({
      error: { code: 'REFERENCE_ERROR', message: 'A referenced record does not exist or is still in use.' },
    });
    return;
  }
  if (pgCode === '23514' || pgCode === '22023' || pgCode === '22P02' || pgCode === '22003') {
    res.status(400).json({
      error: { code: 'INVALID_INPUT', message: error.message },
    });
    return;
  }

  console.error('[farefair-api] unhandled error:', error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The request could not be completed.',
    },
  });
}
