// Optional HTTP Basic gate for the browser-facing surface of the API.
//
// The console is a public URL the moment it is tunnelled, and its demo
// credentials are meant to be *predictable* for a walkthrough. Predictable plus
// public is a fare matrix anyone can rewrite, so the browser surface (console,
// docs, and the sign-in endpoints) can be put behind one shared credential.
//
// Set `ADMIN_BASIC_AUTH=user:password` to enable it. Leave it unset locally and
// nothing changes. `/health` and the client-facing `/v1/sync` and seed
// endpoints stay reachable, because the phone cannot answer a browser prompt.
import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

export function readGateSpec() {
  const spec = String(process.env.ADMIN_BASIC_AUTH ?? '').trim();
  if (!spec) return null;
  const separator = spec.indexOf(':');
  if (separator < 1) {
    throw new Error(
      'ADMIN_BASIC_AUTH must look like "user:password" (no empty user).',
    );
  }
  return {
    user: spec.slice(0, separator),
    password: spec.slice(separator + 1),
  };
}

export function basicAuthGate() {
  const spec = readGateSpec();
  if (!spec) {
    return function passthrough(req, res, next) {
      next();
    };
  }

  const expectedUser = digest(spec.user);
  const expectedPassword = digest(spec.password);

  return function gate(req, res, next) {
    const header = req.get('authorization') ?? '';
    const match = /^Basic\s+(.+)$/i.exec(header);
    if (match) {
      const decoded = Buffer.from(match[1].trim(), 'base64').toString('utf8');
      const separator = decoded.indexOf(':');
      const user = separator === -1 ? decoded : decoded.slice(0, separator);
      const password = separator === -1 ? '' : decoded.slice(separator + 1);
      const userOk = timingSafeEqual(digest(user), expectedUser);
      const passwordOk = timingSafeEqual(digest(password), expectedPassword);
      if (userOk && passwordOk) {
        next();
        return;
      }
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="FareFair console", charset="UTF-8"');
    res.status(401).type('text/plain').send('Authentication required.');
  };
}

/** Paths a browser reaches directly: the console, its assets, docs, sign-in. */
export function isBrowserSurface(reqPath) {
  return (
    reqPath === '/admin' ||
    reqPath.startsWith('/admin/') ||
    reqPath === '/docs' ||
    reqPath === '/openapi.json' ||
    reqPath === '/v1/auth' ||
    reqPath.startsWith('/v1/auth/')
  );
}
