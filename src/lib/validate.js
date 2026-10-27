import { ApiError } from './errors.js';

/**
 * Treat blank optional inputs as "not provided" so an empty field never
 * turns a valid request into a 400. Required fields still fail validation
 * because their key is removed entirely.
 */
function compact(value) {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(typeof item === 'string' && item.trim() === ''))
      .map(compact);
  }
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      if (typeof item === 'string' && item.trim() === '') continue;
      output[key] = compact(item);
    }
    return output;
  }
  return value;
}

export function parseBody(schema, req) {
  const result = schema.safeParse(compact(req.body ?? {}));
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Request body is invalid.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function parseQuery(schema, req) {
  const result = schema.safeParse(compact(req.query ?? {}));
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      'Query parameters are invalid.',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate UUID path parameters on the router that owns them. Express 5 does
 * not propagate parent `app.param` callbacks into mounted routers.
 */
export function registerUuidParams(router, names) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => {
      if (!uuidPattern.test(value)) {
        next(
          new ApiError(
            400,
            'INVALID_ID',
            `Path parameter "${name}" must be a UUID.`,
          ),
        );
        return;
      }
      next();
    });
  }
}
