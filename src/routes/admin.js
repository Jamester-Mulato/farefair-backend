import express from 'express';
import { z } from 'zod';

import { ApiError, asyncHandler } from '../lib/errors.js';
import {
  canEditFares,
  recordAudit,
  requireAuth,
  requireRole,
} from '../lib/auth.js';
import { parseBody } from '../lib/validate.js';
import { blankToNull } from '../lib/fare.js';
import { serializeFareRoute, serializeMatrixEntry } from '../lib/serialize.js';

const farePatchSchema = z.object({
  baseFare: z.number().min(0).max(100000),
  baseDistanceKm: z.number().min(0).max(1000),
  perKmRate: z.number().min(0).max(10000),
  minFare: z.number().min(0).max(100000),
  maxCustomary: z.number().min(0).max(100000),
  typicalCapacity: z.number().int().min(1).max(30),
  active: z.boolean().default(true),
});

const fareRouteSchema = z.object({
  fromLabel: z.string().min(1).max(200).optional(),
  toLabel: z.string().min(1).max(200).optional(),
  via: z.string().max(200).optional(),
  regularFare: z.number().min(0).max(100000),
  discountedFare: z.number().min(0).max(100000),
  remark: z.string().max(500).optional(),
  bidirectional: z.boolean().default(true),
});

export function adminRoutes(db) {
  const router = express.Router();

  const updateFareMatrix = asyncHandler(async (req, res) => {
      const { cityId, vehicleId } = req.params;
      const input = parseBody(farePatchSchema, req);

      if (!canEditFares(req.admin, cityId)) {
        throw new ApiError(
          403,
          'FORBIDDEN',
          'Your account cannot edit fares for this city.',
        );
      }

      const city = await db.query(
        `SELECT id, display_name FROM cities WHERE id = $1`,
        [cityId],
      );
      if (!city.rows.length) {
        throw new ApiError(404, 'CITY_NOT_FOUND', `City "${cityId}" was not found.`);
      }

      const matrix = await db.query(
        `SELECT id FROM fare_matrix_versions
         WHERE city_id = $1 AND status = 'active'
         LIMIT 1`,
        [cityId],
      );
      if (!matrix.rows.length) {
        throw new ApiError(
          404,
          'FARE_MATRIX_NOT_FOUND',
          `No active fare matrix for city "${cityId}".`,
        );
      }

      const before = await db.query(
        `SELECT e.*, vt.name AS vehicle_name, vt.category
         FROM fare_matrix_entries e
         JOIN vehicle_types vt ON vt.id = e.vehicle_type_id
         WHERE e.matrix_version_id = $1 AND e.vehicle_type_id = $2`,
        [matrix.rows[0].id, vehicleId],
      );
      if (!before.rows.length) {
        throw new ApiError(
          404,
          'VEHICLE_MATRIX_NOT_FOUND',
          `Vehicle "${vehicleId}" is not part of the active matrix for "${cityId}".`,
        );
      }

      const updated = await db.query(
        `UPDATE fare_matrix_entries
         SET base_fare = $3,
             base_distance_km = $4,
             per_km_rate = $5,
             min_fare = $6,
             max_customary = $7,
             typical_capacity = $8,
             active = $9
         WHERE matrix_version_id = $1 AND vehicle_type_id = $2
         RETURNING *`,
        [
          matrix.rows[0].id,
          vehicleId,
          input.baseFare,
          input.baseDistanceKm,
          input.perKmRate,
          input.minFare,
          input.maxCustomary,
          input.typicalCapacity,
          input.active,
        ],
      );

      const previous = before.rows[0];
      const detail = {
        summary:
          `Updated ${previous.vehicle_name} in ${city.rows[0].display_name}: ` +
          `base ₱${input.baseFare.toFixed(2)}, ` +
          `₱${input.perKmRate.toFixed(2)}/km`,
        vehicleId,
        before: {
          baseFare: Number(previous.base_fare),
          baseDistanceKm: Number(previous.base_distance_km),
          perKmRate: Number(previous.per_km_rate),
          minFare: Number(previous.min_fare),
          maxCustomary: Number(previous.max_customary),
          typicalCapacity: Number(previous.typical_capacity),
          active: previous.active,
        },
        after: input,
      };

      await recordAudit(db, {
        actorId: req.admin.id,
        actorName: req.admin.displayName,
        role: req.admin.role,
        action: 'fare.update',
        entityType: 'fare_matrix_entry',
        entityId: `${matrix.rows[0].id}:${vehicleId}`,
        cityId,
        detail,
      });

      res.json({
        ...serializeMatrixEntry({
          ...updated.rows[0],
          vehicle_name: previous.vehicle_name,
          category: previous.category,
        }),
        matrixVersionId: matrix.rows[0].id,
        cityId,
        updatedBy: req.admin.displayName,
      });
    });

  router.patch(
    '/admin/cities/:cityId/fare-matrix/:vehicleId',
    requireAuth(db),
    updateFareMatrix,
  );
  // PUT is the idempotent form of the same full-entry replacement.
  router.put(
    '/admin/cities/:cityId/fare-matrix/:vehicleId',
    requireAuth(db),
    updateFareMatrix,
  );

  router.put(
    '/admin/cities/:cityId/fare-routes/:rowNumber',
    requireAuth(db),
    asyncHandler(async (req, res) => {
      const { cityId } = req.params;
      const rowNumber = Number(req.params.rowNumber);
      if (!Number.isInteger(rowNumber) || rowNumber < 1) {
        throw new ApiError(
          400,
          'INVALID_ROUTE_NUMBER',
          'rowNumber must be a positive integer.',
        );
      }
      const input = parseBody(fareRouteSchema, req);
      if (input.discountedFare > input.regularFare) {
        throw new ApiError(
          400,
          'INVALID_DISCOUNTED_FARE',
          'discountedFare cannot exceed regularFare.',
        );
      }
      if (!canEditFares(req.admin, cityId)) {
        throw new ApiError(
          403,
          'FORBIDDEN',
          'Your account cannot edit fares for this city.',
        );
      }

      const city = await db.query(
        `SELECT id, display_name FROM cities WHERE id = $1`,
        [cityId],
      );
      if (!city.rows.length) {
        throw new ApiError(404, 'CITY_NOT_FOUND', `City "${cityId}" was not found.`);
      }

      const matrix = await db.query(
        `SELECT id FROM fare_matrix_versions
         WHERE city_id = $1 AND status = 'active'
         LIMIT 1`,
        [cityId],
      );
      if (!matrix.rows.length) {
        throw new ApiError(
          404,
          'FARE_MATRIX_NOT_FOUND',
          `No active fare matrix for city "${cityId}".`,
        );
      }

      const vehicleId =
        blankToNull(req.query.vehicleId) ??
        blankToNull(req.body?.vehicleId) ??
        'tricycle';

      const before = await db.query(
        `SELECT r.*, vt.name AS vehicle_name
         FROM fare_matrix_routes r
         JOIN vehicle_types vt ON vt.id = r.vehicle_type_id
         WHERE r.matrix_version_id = $1
           AND r.vehicle_type_id = $2
           AND r.row_number = $3`,
        [matrix.rows[0].id, vehicleId, rowNumber],
      );
      if (!before.rows.length) {
        throw new ApiError(
          404,
          'FARE_ROUTE_NOT_FOUND',
          `Fare route row ${rowNumber} was not found for "${vehicleId}" in "${cityId}".`,
        );
      }

      const previous = before.rows[0];
      const updated = await db.query(
        `UPDATE fare_matrix_routes
         SET from_label = $4,
             to_label = $5,
             via = $6,
             regular_fare = $7,
             discounted_fare = $8,
             remark = $9,
             bidirectional = $10
         WHERE matrix_version_id = $1
           AND vehicle_type_id = $2
           AND row_number = $3
         RETURNING *`,
        [
          matrix.rows[0].id,
          vehicleId,
          rowNumber,
          input.fromLabel ?? previous.from_label,
          input.toLabel ?? previous.to_label,
          input.via ?? previous.via,
          input.regularFare,
          input.discountedFare,
          input.remark ?? previous.remark,
          input.bidirectional,
        ],
      );

      await recordAudit(db, {
        actorId: req.admin.id,
        actorName: req.admin.displayName,
        role: req.admin.role,
        action: 'fare_route.update',
        entityType: 'fare_matrix_route',
        entityId: `${matrix.rows[0].id}:${vehicleId}:${rowNumber}`,
        cityId,
        detail: {
          summary:
            `Updated ${previous.vehicle_name} route #${rowNumber} in ` +
            `${city.rows[0].display_name}: ₱${input.regularFare.toFixed(2)} / ` +
            `₱${input.discountedFare.toFixed(2)} discounted`,
          rowNumber,
          vehicleId,
          before: {
            fromLabel: previous.from_label,
            toLabel: previous.to_label,
            via: previous.via,
            regularFare: Number(previous.regular_fare),
            discountedFare: Number(previous.discounted_fare),
            remark: previous.remark,
            bidirectional: previous.bidirectional,
          },
          after: {
            fromLabel: input.fromLabel ?? previous.from_label,
            toLabel: input.toLabel ?? previous.to_label,
            via: input.via ?? previous.via,
            regularFare: input.regularFare,
            discountedFare: input.discountedFare,
            remark: input.remark ?? previous.remark,
            bidirectional: input.bidirectional,
          },
        },
      });

      res.json({
        ...serializeFareRoute({
          ...updated.rows[0],
          vehicle_name: previous.vehicle_name,
        }),
        cityId,
        matrixVersionId: matrix.rows[0].id,
        updatedBy: req.admin.displayName,
      });
    }),
  );

  router.post(
    '/admin/cities/:cityId/activate',
    requireAuth(db),
    asyncHandler(async (req, res) => {
      requireRole(req.admin, ['admin']);
      const { cityId } = req.params;

      const found = await db.query(
        `SELECT id, display_name FROM cities WHERE id = $1`,
        [cityId],
      );
      if (!found.rows.length) {
        throw new ApiError(404, 'CITY_NOT_FOUND', `City "${cityId}" was not found.`);
      }

      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE cities SET is_focus = FALSE, updated_at = now()
           WHERE is_focus AND id <> $1`,
          [cityId],
        );
        await tx.query(
          `UPDATE cities SET is_focus = TRUE, updated_at = now() WHERE id = $1`,
          [cityId],
        );
      });

      await recordAudit(db, {
        actorId: req.admin.id,
        actorName: req.admin.displayName,
        role: req.admin.role,
        action: 'city.activate',
        entityType: 'city',
        entityId: cityId,
        cityId,
        detail: {
          summary: `Set ${found.rows[0].display_name} as the live dataset`,
        },
      });

      res.json({
        activeCityId: cityId,
        activeCityName: found.rows[0].display_name,
        activatedBy: req.admin.displayName,
      });
    }),
  );

  router.post(
    '/admin/audit',
    requireAuth(db),
    asyncHandler(async (req, res) => {
      const input = parseBody(
        z.object({
          action: z.string().min(1).max(80),
          detail: z.string().max(2000).default(''),
          cityId: z.string().min(1).max(80).optional(),
          entityType: z.string().max(80).default(''),
          entityId: z.string().max(120).optional(),
        }),
        req,
      );

      await recordAudit(db, {
        actorId: req.admin.id,
        actorName: req.admin.displayName,
        role: req.admin.role,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        cityId: input.cityId,
        detail: { summary: input.detail },
      });

      res.status(201).json({ ok: true });
    }),
  );

  return router;
}
