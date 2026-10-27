import express from 'express';
import { z } from 'zod';

import { ApiError, asyncHandler } from '../lib/errors.js';
import {
  issueToken,
  hashToken,
  publicUser,
  recordAudit,
  requireAuth,
  requireRole,
  verifyDummy,
  verifyPassword,
  SESSION_TTL_HOURS,
} from '../lib/auth.js';
import { parseBody } from '../lib/validate.js';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function authRoutes(db) {
  const router = express.Router();
  const attempts = new Map();

  router.post(
    '/auth/login',
    asyncHandler(async (req, res) => {
      const input = parseBody(
        z.object({
          login: z.string().min(1).max(200),
          password: z.string().min(1).max(200),
        }),
        req,
      );

      const key = input.login.trim().toLowerCase();
      const now = Date.now();
      const state = attempts.get(key);
      if (state && state.until > now) {
        const seconds = Math.ceil((state.until - now) / 1000);
        throw new ApiError(
          429,
          'TOO_MANY_ATTEMPTS',
          `Too many failed sign-in attempts. Try again in ${seconds}s.`,
        );
      }

      const found = await db.query(
        `SELECT *
         FROM admin_users
         WHERE is_active
           AND (
             lower(email) = lower($1)
             OR lower(split_part(email, '@', 1)) = lower($1)
           )
         LIMIT 1`,
        [input.login.trim()],
      );
      const user = found.rows[0] ?? null;

      const valid = user
        ? verifyPassword(input.password, user.password_hash)
        : (verifyDummy(input.password), false);

      if (!valid) {
        const previous = attempts.get(key);
        const expired =
          previous && previous.until > 0 && previous.until <= now;
        const current =
          expired || !previous ? { count: 0, until: 0 } : previous;
        current.count += 1;
        if (current.count >= MAX_ATTEMPTS) {
          current.count = 0;
          current.until = now + LOCKOUT_MS;
        }
        attempts.set(key, current);
        await recordAudit(db, {
          actorName: input.login,
          role: 'guest',
          action: 'auth.failed',
          detail: { summary: `Failed sign-in attempt for "${input.login}"` },
        });
        throw new ApiError(
          401,
          'INVALID_CREDENTIALS',
          'Incorrect email/username or password.',
        );
      }

      attempts.delete(key);

      const token = issueToken();
      const session = await db.query(
        `INSERT INTO admin_sessions (user_id, token_hash, expires_at)
         VALUES ($1, $2, now() + make_interval(hours => $3))
         RETURNING id, expires_at`,
        [user.id, hashToken(token), SESSION_TTL_HOURS],
      );

      await db.query(
        `UPDATE admin_users SET last_login_at = now() WHERE id = $1`,
        [user.id],
      );

      await recordAudit(db, {
        actorId: user.id,
        actorName: user.display_name,
        role: user.role,
        action: 'auth.login',
        entityType: 'admin_user',
        entityId: user.id,
        detail: { summary: 'Signed in to the admin console' },
      });

      res.json({
        token,
        tokenType: 'Bearer',
        expiresAt: session.rows[0].expires_at,
        user: publicUser(user),
      });
    }),
  );

  router.get(
    '/auth/me',
    requireAuth(db),
    asyncHandler(async (req, res) => {
      res.json({ user: req.admin });
    }),
  );

  router.post(
    '/auth/logout',
    requireAuth(db),
    asyncHandler(async (req, res) => {
      await db.query(
        `UPDATE admin_sessions SET revoked_at = now() WHERE id = $1`,
        [req.sessionId],
      );
      await recordAudit(db, {
        actorId: req.admin.id,
        actorName: req.admin.displayName,
        role: req.admin.role,
        action: 'auth.logout',
        entityType: 'admin_user',
        entityId: req.admin.id,
        detail: { summary: 'Signed out of the admin console' },
      });
      res.json({ ok: true });
    }),
  );

  router.get(
    '/auth/accounts',
    requireAuth(db),
    asyncHandler(async (req, res) => {
      requireRole(req.admin, ['admin']);
      const result = await db.query(
        `SELECT id, email, display_name, role, city_scope, is_active,
                created_at, last_login_at
         FROM admin_users
         ORDER BY created_at, email`,
      );
      res.json({
        data: result.rows.map(publicUser),
        count: result.rows.length,
      });
    }),
  );

  return router;
}
