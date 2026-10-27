import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { ApiError } from './errors.js';

const SESSION_HOURS = 8;
const DUMMY_HASH = `scrypt$${'0'.repeat(16)}$${'0'.repeat(128)}`;

const ROLE_TITLES = {
  admin: 'Transport Administrator',
  lgu_editor: 'City Data Steward',
  analyst: 'Fare Data Analyst',
  viewer: 'Read-only Viewer',
};

/** Verify a password against the `scrypt$salt$hex` format written by seed.js. */
export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(String(password ?? ''), salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Constant-work verification for unknown accounts so a failed login takes the
 * same time whether or not the email exists.
 */
export function verifyDummy(password) {
  verifyPassword(password, DUMMY_HASH);
}

export function issueToken() {
  return `ff_${randomBytes(32).toString('hex')}`;
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function publicUser(row) {
  const email = String(row.email ?? '');
  return {
    id: row.id,
    email,
    username: email.includes('@') ? email.split('@')[0] : email,
    displayName: row.display_name ?? row.displayName ?? '',
    name: row.display_name ?? row.displayName ?? '',
    role: row.role,
    title: ROLE_TITLES[row.role] ?? 'Administrator',
    cityScope: Array.isArray(row.city_scope) ? row.city_scope : [],
    isActive: row.is_active ?? true,
    lastLoginAt: row.last_login_at ?? null,
  };
}

/**
 * Middleware factory. Resolves `Authorization: Bearer <token>` against
 * admin_sessions, rejects revoked/expired sessions and attaches the account to
 * `req.admin` plus the session id to `req.sessionId`.
 */
export function requireAuth(db) {
  return async function authenticate(req, res, next) {
    try {
      const header = req.get('authorization') ?? '';
      const match = /^Bearer\s+(.+)$/i.exec(header);
      if (!match) {
        throw new ApiError(
          401,
          'AUTH_REQUIRED',
          'Sign in with an admin account to perform this action.',
        );
      }

      const result = await db.query(
        `SELECT s.id AS session_id, s.expires_at,
                u.id, u.email, u.display_name, u.role, u.city_scope,
                u.is_active, u.last_login_at
         FROM admin_sessions s
         JOIN admin_users u ON u.id = s.user_id
         WHERE s.token_hash = $1
           AND s.revoked_at IS NULL
           AND s.expires_at > now()
         LIMIT 1`,
        [hashToken(match[1].trim())],
      );

      const row = result.rows[0];
      if (!row || !row.is_active) {
        throw new ApiError(
          401,
          'SESSION_INVALID',
          'Your session has expired. Sign in again.',
        );
      }

      req.admin = publicUser(row);
      req.sessionId = row.session_id;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireRole(user, roles) {
  if (!user) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
  }
  if (!roles.includes(user.role)) {
    throw new ApiError(
      403,
      'FORBIDDEN',
      'Your account does not have permission for this action.',
    );
  }
  return user;
}

/** Empty city scope means unrestricted; otherwise the city must be listed. */
export function inScope(user, cityId) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const scope = Array.isArray(user.cityScope) ? user.cityScope : [];
  return scope.length === 0 || scope.includes(cityId);
}

export function canEditFares(user, cityId) {
  if (!user) return false;
  if (!['admin', 'lgu_editor'].includes(user.role)) return false;
  return inScope(user, cityId);
}

export async function recordAudit(db, entry) {
  await db.query(
    `INSERT INTO audit_events
       (actor_id, actor_name, role, action, entity_type, entity_id, city_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      entry.actorId ?? null,
      entry.actorName ?? 'System',
      entry.role ?? 'system',
      entry.action,
      entry.entityType ?? '',
      entry.entityId ?? null,
      entry.cityId ?? null,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
}

export const SESSION_TTL_HOURS = SESSION_HOURS;
