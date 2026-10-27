import express from 'express';
import { z } from 'zod';

import { ApiError, asyncHandler } from '../lib/errors.js';
import { parseQuery } from '../lib/validate.js';
import {
  num,
  dateOnly,
  serializeCitySummary,
  serializeFareRoute,
  serializeMatrix,
  serializeMatrixEntry,
  serializeOrdinance,
  serializePolicy,
  serializeVehicle,
} from '../lib/serialize.js';

export function catalogRoutes(db) {
  const router = express.Router();

  router.get(
    '/cities',
    asyncHandler(async (req, res) => {
      const query = parseQuery(
        z.object({
          status: z.enum(['active', 'candidate', 'retired']).optional(),
          provisional: z.enum(['true', 'false']).optional(),
        }),
        req,
      );
      const params = [];
      const clauses = [];
      if (query.status) {
        params.push(query.status);
        clauses.push(`status = $${params.length}`);
      }
      if (query.provisional) {
        params.push(query.provisional === 'true');
        clauses.push(`provisional = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const result = await db.query(
        `SELECT * FROM v_city_catalog ${where}
         ORDER BY is_focus DESC, display_name`,
        params,
      );
      const data = result.rows.map(serializeCitySummary);
      res.json({
        data,
        count: data.length,
        activeCityId: data.find((city) => city.isFocus)?.id ?? null,
      });
    }),
  );

  router.get(
    '/cities/:cityId',
    asyncHandler(async (req, res) => {
      const { cityId } = req.params;
      const cityResult = await db.query(
        `SELECT c.*, p.provisional, p.source, p.last_verified, p.verified_by
         FROM cities c
         LEFT JOIN city_provenance p ON p.city_id = c.id
         WHERE c.id = $1`,
        [cityId],
      );
      const city = cityResult.rows[0];
      if (!city) {
        throw new ApiError(404, 'CITY_NOT_FOUND', `City "${cityId}" was not found.`);
      }

      const policyResult = await db.query(
        `SELECT * FROM fare_policy_versions
         WHERE city_id = $1 AND status = 'active'
         LIMIT 1`,
        [cityId],
      );
      const matrixResult = await db.query(
        `SELECT * FROM fare_matrix_versions
         WHERE city_id = $1 AND status = 'active'
         LIMIT 1`,
        [cityId],
      );
      const matrix = matrixResult.rows[0] ?? null;

      const entriesResult = matrix
        ? await db.query(
            `SELECT e.*, vt.name AS vehicle_name, vt.category, vt.sort_order
             FROM fare_matrix_entries e
             JOIN vehicle_types vt ON vt.id = e.vehicle_type_id
             WHERE e.matrix_version_id = $1
             ORDER BY vt.sort_order`,
            [matrix.id],
          )
        : { rows: [] };

      const ordinancesResult = await db.query(
        `SELECT * FROM v_ordinance_catalog
         WHERE city_id = $1
         ORDER BY date_enacted NULLS LAST, title`,
        [cityId],
      );
      const routeResult = await db.query(
        `SELECT * FROM city_demo_routes
         WHERE city_id = $1
         ORDER BY is_primary DESC
         LIMIT 1`,
        [cityId],
      );
      const corridorResult = await db.query(
        `SELECT seq, lat, lng FROM city_corridor_points
         WHERE city_id = $1 ORDER BY seq`,
        [cityId],
      );

      const route = routeResult.rows[0];
      const policy = policyResult.rows[0] ?? null;

      res.json({
        id: city.id,
        displayName: city.display_name,
        province: city.province,
        region: city.region,
        status: city.status,
        centroLabel: city.centro_label,
        isFocus: city.is_focus,
        center: { lat: num(city.center_lat), lng: num(city.center_lng) },
        provenance: {
          provisional: city.provisional ?? true,
          source: city.source ?? '',
          lastVerified: dateOnly(city.last_verified),
          verifiedBy: city.verified_by ?? null,
        },
        farePolicy: policy
          ? serializePolicy(policy)
          : null,
        demoRoute: route
          ? {
              originName: route.origin_name,
              destinationName: route.destination_name,
              distanceKm: num(route.distance_km),
            }
          : null,
        vehicles: entriesResult.rows.map(serializeMatrixEntry),
        ordinances: ordinancesResult.rows.map(serializeOrdinance),
        simulatorCorridor: corridorResult.rows.map((point) => [
          num(point.lat),
          num(point.lng),
        ]),
        fareMatrix: matrix ? serializeMatrix(matrix, entriesResult.rows) : null,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // Official point-to-point fare routes
  // -------------------------------------------------------------------------
  router.get(
    '/cities/:cityId/fare-routes',
    asyncHandler(async (req, res) => {
      const { cityId } = req.params;
      const query = parseQuery(
        z.object({
          vehicleId: z.string().min(1).optional(),
          search: z.string().min(1).max(120).optional(),
        }),
        req,
      );

      const city = await db.query(
        `SELECT id, display_name FROM cities WHERE id = $1`,
        [cityId],
      );
      if (!city.rows.length) {
        throw new ApiError(404, 'CITY_NOT_FOUND', `City "${cityId}" was not found.`);
      }

      const params = [cityId];
      const clauses = [`city_id = $1`];
      if (query.vehicleId) {
        params.push(query.vehicleId);
        clauses.push(`vehicle_type_id = $${params.length}`);
      }
      if (query.search) {
        params.push(`%${query.search}%`);
        const index = params.length;
        clauses.push(
          `(from_label ILIKE $${index} OR to_label ILIKE $${index} OR remark ILIKE $${index} OR via ILIKE $${index})`,
        );
      }

      const result = await db.query(
        `SELECT * FROM v_official_fare_routes
         WHERE ${clauses.join(' AND ')}
         ORDER BY vehicle_type_id, row_number`,
        params,
      );
      const first = result.rows[0] ?? null;
      res.json({
        cityId,
        cityName: city.rows[0].display_name,
        matrixVersionId: first?.matrix_version_id ?? null,
        vehicleId: query.vehicleId ?? null,
        effectiveFrom: first ? dateOnly(first.effective_from) : null,
        provisional: first ? first.provisional : null,
        source: first?.source ?? '',
        count: result.rows.length,
        data: result.rows.map(serializeFareRoute),
      });
    }),
  );

  router.get(
    '/cities/:cityId/fare-policy',
    asyncHandler(async (req, res) => {
      const { cityId } = req.params;
      const includeHistory = req.query.includeHistory === 'true';
      const result = await db.query(
        `SELECT * FROM fare_policy_versions
         WHERE city_id = $1
         ORDER BY version DESC`,
        [cityId],
      );
      if (!result.rows.length) {
        throw new ApiError(
          404,
          'FARE_POLICY_NOT_FOUND',
          `No fare policy found for city "${cityId}".`,
        );
      }
      const current = result.rows.find((row) => row.status === 'active') ?? null;
      res.json({
        current: current ? serializePolicy(current) : null,
        ...(includeHistory
          ? { history: result.rows.map(serializePolicy) }
          : {}),
      });
    }),
  );

  router.get(
    '/cities/:cityId/fare-matrix',
    asyncHandler(async (req, res) => {
      const { cityId } = req.params;
      const query = parseQuery(
        z.object({
          version: z.coerce.number().int().positive().optional(),
          includeInactive: z.enum(['true', 'false']).optional(),
        }),
        req,
      );
      const params = [cityId];
      let clause = `city_id = $1 AND status = 'active'`;
      if (query.version) {
        params.push(query.version);
        clause = `city_id = $1 AND version = $${params.length}`;
      }
      const matrixResult = await db.query(
        `SELECT * FROM fare_matrix_versions WHERE ${clause} LIMIT 1`,
        params,
      );
      const matrix = matrixResult.rows[0];
      if (!matrix) {
        throw new ApiError(
          404,
          'FARE_MATRIX_NOT_FOUND',
          `No matching fare matrix found for city "${cityId}".`,
        );
      }
      const entryParams = [matrix.id];
      let entryClause = 'matrix_version_id = $1';
      if (query.includeInactive !== 'true') {
        entryClause += ' AND active';
      }
      const entries = await db.query(
        `SELECT e.*, vt.name AS vehicle_name, vt.category, vt.sort_order
         FROM fare_matrix_entries e
         JOIN vehicle_types vt ON vt.id = e.vehicle_type_id
         WHERE ${entryClause}
         ORDER BY vt.sort_order`,
        entryParams,
      );
      res.json(serializeMatrix(matrix, entries.rows));
    }),
  );

  router.get(
    '/vehicles',
    asyncHandler(async (req, res) => {
      const result = await db.query(
        `SELECT vt.*,
           (
             SELECT COUNT(DISTINCT mv.city_id)::int
             FROM fare_matrix_entries e
             JOIN fare_matrix_versions mv ON mv.id = e.matrix_version_id
             WHERE e.vehicle_type_id = vt.id AND mv.status = 'active'
           ) AS city_count
         FROM vehicle_types vt
         ORDER BY vt.sort_order`,
      );
      res.json({ data: result.rows.map(serializeVehicle), count: result.rows.length });
    }),
  );

  router.get(
    '/vehicles/:vehicleId',
    asyncHandler(async (req, res) => {
      const result = await db.query(
        `SELECT vt.*,
           (
             SELECT COUNT(DISTINCT mv.city_id)::int
             FROM fare_matrix_entries e
             JOIN fare_matrix_versions mv ON mv.id = e.matrix_version_id
             WHERE e.vehicle_type_id = vt.id AND mv.status = 'active'
           ) AS city_count
         FROM vehicle_types vt
         WHERE vt.id = $1`,
        [req.params.vehicleId],
      );
      if (!result.rows.length) {
        throw new ApiError(
          404,
          'VEHICLE_NOT_FOUND',
          `Vehicle "${req.params.vehicleId}" was not found.`,
        );
      }
      const cities = await db.query(
        `SELECT city_id, base_fare, base_distance_km, per_km_rate,
                min_fare, max_customary, typical_capacity
         FROM v_active_fare_matrix
         WHERE vehicle_type_id = $1
         ORDER BY city_name`,
        [req.params.vehicleId],
      );
      res.json({
        ...serializeVehicle(result.rows[0]),
        cities: cities.rows.map((row) => ({
          cityId: row.city_id,
          baseFare: num(row.base_fare),
          baseDistanceKm: num(row.base_distance_km),
          perKmRate: num(row.per_km_rate),
          minFare: num(row.min_fare),
          maxCustomary: num(row.max_customary),
          typicalCapacity: Number(row.typical_capacity),
        })),
      });
    }),
  );

  router.get(
    '/ordinances',
    asyncHandler(async (req, res) => {
      const query = parseQuery(
        z.object({
          cityId: z.string().min(1).optional(),
          status: z
            .enum(['pending', 'enacted', 'amended', 'repealed'])
            .optional(),
          vehicleId: z.string().min(1).optional(),
        }),
        req,
      );
      const params = [];
      const clauses = [];
      if (query.cityId) {
        params.push(query.cityId);
        clauses.push(`city_id = $${params.length}`);
      }
      if (query.status) {
        params.push(query.status);
        clauses.push(`status = $${params.length}`);
      }
      if (query.vehicleId) {
        params.push(query.vehicleId);
        clauses.push(`$${params.length} = ANY(vehicle_ids)`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const result = await db.query(
        `SELECT * FROM v_ordinance_catalog ${where}
         ORDER BY city_name, date_enacted NULLS LAST, title`,
        params,
      );
      res.json({
        data: result.rows.map(serializeOrdinance),
        count: result.rows.length,
      });
    }),
  );

  router.get(
    '/ordinances/:slug',
    asyncHandler(async (req, res) => {
      const result = await db.query(
        `SELECT * FROM v_ordinance_catalog WHERE slug = $1`,
        [req.params.slug],
      );
      if (!result.rows.length) {
        throw new ApiError(
          404,
          'ORDINANCE_NOT_FOUND',
          `Ordinance "${req.params.slug}" was not found.`,
        );
      }
      res.json(serializeOrdinance(result.rows[0]));
    }),
  );

  return router;
}
