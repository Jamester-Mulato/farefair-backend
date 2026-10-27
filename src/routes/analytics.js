import express from 'express';
import { z } from 'zod';

import { ApiError, asyncHandler } from '../lib/errors.js';
import { parseBody, parseQuery, registerUuidParams } from '../lib/validate.js';
import {
  int,
  money,
  num,
  serializeAnomaly,
  serializeAudit,
} from '../lib/serialize.js';

const rangeSchema = z.object({
  cityId: z.string().min(1).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
});

export function analyticsRoutes(db) {
  const router = express.Router();
  registerUuidParams(router, ['anomalyId']);

  router.get(
    '/analytics/overview',
    asyncHandler(async (req, res) => {
      const query = parseQuery(rangeSchema, req);
      const from = new Date(Date.now() - query.days * 86400000).toISOString();
      const params = [from, query.cityId ?? null];
      const filter = `recorded_at >= $1 AND ($2::text IS NULL OR city_id = $2)`;

      const totals = await db.query(
        `SELECT
           COUNT(*)::int AS trips,
           COALESCE(ROUND(AVG(exact_fare),2),0) AS avg_fare,
           COALESCE(ROUND(AVG(distance_km),2),0) AS avg_distance_km,
           COALESCE(ROUND(SUM(exact_fare),2),0) AS total_fare_value,
           COUNT(*) FILTER (WHERE status = 'flagged')::int AS flagged,
           COUNT(*) FILTER (WHERE status = 'disputed')::int AS disputed,
           COUNT(*) FILTER (WHERE discount_code <> 'none')::int AS discounted,
           COUNT(*) FILTER (WHERE is_pakyaw)::int AS pakyaw
         FROM trips WHERE ${filter}`,
        params,
      );

      const byVehicle = await db.query(
        `SELECT t.vehicle_type_id, vt.name,
           COUNT(*)::int AS trips,
           ROUND(AVG(t.exact_fare),2) AS avg_fare,
           ROUND(MIN(t.exact_fare),2) AS min_fare,
           ROUND(MAX(t.exact_fare),2) AS max_fare
         FROM trips t
         JOIN vehicle_types vt ON vt.id = t.vehicle_type_id
         WHERE t.recorded_at >= $1 AND ($2::text IS NULL OR t.city_id = $2)
         GROUP BY t.vehicle_type_id, vt.name, vt.sort_order
         ORDER BY trips DESC`,
        params,
      );

      const byStatus = await db.query(
        `SELECT status, COUNT(*)::int AS trips
         FROM trips WHERE ${filter}
         GROUP BY status ORDER BY trips DESC`,
        params,
      );

      const byDiscount = await db.query(
        `SELECT t.discount_code AS code, COALESCE(dp.label, t.discount_code::text) AS label,
           COUNT(*)::int AS trips
         FROM trips t
         LEFT JOIN discount_programs dp ON dp.code = t.discount_code::text
         WHERE t.recorded_at >= $1 AND ($2::text IS NULL OR t.city_id = $2)
         GROUP BY t.discount_code, dp.label
         ORDER BY trips DESC`,
        params,
      );

      const daily = await db.query(
        `SELECT to_char(date_trunc('day', recorded_at), 'YYYY-MM-DD') AS date,
           COUNT(*)::int AS trips,
           ROUND(AVG(exact_fare),2) AS avg_fare,
           COUNT(*) FILTER (WHERE status = 'flagged')::int AS flagged
         FROM trips WHERE ${filter}
         GROUP BY 1 ORDER BY 1`,
        params,
      );

      const topRoutes = await db.query(
        `SELECT origin, destination, COUNT(*)::int AS trips,
           ROUND(AVG(exact_fare),2) AS avg_fare
         FROM trips WHERE ${filter}
         GROUP BY origin, destination
         ORDER BY trips DESC, origin
         LIMIT 10`,
        params,
      );

      const anomalies = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS open,
           COUNT(*)::int AS total
         FROM fare_anomalies
         WHERE ($1::text IS NULL OR city_id = $1)
           AND detected_at >= $2`,
        [query.cityId ?? null, from],
      );

      res.json({
        range: {
          days: query.days,
          from,
          to: new Date().toISOString(),
          cityId: query.cityId ?? null,
        },
        totals: {
          trips: int(totals.rows[0].trips),
          avgFare: money(totals.rows[0].avg_fare),
          avgDistanceKm: num(totals.rows[0].avg_distance_km),
          totalFareValue: money(totals.rows[0].total_fare_value),
          flagged: int(totals.rows[0].flagged),
          disputed: int(totals.rows[0].disputed),
          discounted: int(totals.rows[0].discounted),
          pakyaw: int(totals.rows[0].pakyaw),
          openAnomalies: int(anomalies.rows[0].open),
          totalAnomalies: int(anomalies.rows[0].total),
        },
        byVehicle: byVehicle.rows.map((row) => ({
          vehicleId: row.vehicle_type_id,
          name: row.name,
          trips: int(row.trips),
          avgFare: money(row.avg_fare),
          minFare: money(row.min_fare),
          maxFare: money(row.max_fare),
        })),
        byStatus: byStatus.rows.map((row) => ({
          status: row.status,
          trips: int(row.trips),
        })),
        byDiscount: byDiscount.rows.map((row) => ({
          code: row.code,
          label: row.label,
          trips: int(row.trips),
        })),
        daily: daily.rows.map((row) => ({
          date: row.date,
          trips: int(row.trips),
          avgFare: money(row.avg_fare),
          flagged: int(row.flagged),
        })),
        topRoutes: topRoutes.rows.map((row) => ({
          origin: row.origin,
          destination: row.destination,
          trips: int(row.trips),
          avgFare: money(row.avg_fare),
        })),
      });
    }),
  );

  router.get(
    '/analytics/fares',
    asyncHandler(async (req, res) => {
      const query = parseQuery(rangeSchema, req);
      const from = new Date(Date.now() - query.days * 86400000).toISOString();
      const params = [from, query.cityId ?? null];
      const result = await db.query(
        `SELECT
           m.city_id,
           m.city_name,
           m.vehicle_type_id,
           m.vehicle_name,
           m.base_fare,
           m.base_distance_km,
           m.per_km_rate,
           m.min_fare,
           m.max_customary,
           m.typical_capacity,
           COALESCE(s.trips,0)::int AS trips,
           s.avg_fare,
           s.min_observed,
           s.max_observed,
           COALESCE(s.flagged,0)::int AS flagged
         FROM v_active_fare_matrix m
         LEFT JOIN (
           SELECT city_id, vehicle_type_id,
             COUNT(*)::int AS trips,
             ROUND(AVG(exact_fare),2) AS avg_fare,
             ROUND(MIN(exact_fare),2) AS min_observed,
             ROUND(MAX(exact_fare),2) AS max_observed,
             COUNT(*) FILTER (WHERE status = 'flagged')::int AS flagged
           FROM trips
           WHERE recorded_at >= $1 AND ($2::text IS NULL OR city_id = $2)
           GROUP BY city_id, vehicle_type_id
         ) s ON s.city_id = m.city_id AND s.vehicle_type_id = m.vehicle_type_id
         WHERE ($2::text IS NULL OR m.city_id = $2)
         ORDER BY m.city_name, m.sort_order`,
        params,
      );

      const data = result.rows.map((row) => {
        const baseFare = num(row.base_fare);
        const avgFare = money(row.avg_fare);
        return {
          cityId: row.city_id,
          cityName: row.city_name,
          vehicleId: row.vehicle_type_id,
          vehicleName: row.vehicle_name,
          matrix: {
            baseFare,
            baseDistanceKm: num(row.base_distance_km),
            perKmRate: money(row.per_km_rate),
            minFare: money(row.min_fare),
            maxCustomary: money(row.max_customary),
            typicalCapacity: int(row.typical_capacity),
          },
          observed: {
            trips: int(row.trips),
            avgFare,
            minFare: money(row.min_observed),
            maxFare: money(row.max_observed),
            flagged: int(row.flagged),
            variancePct:
              baseFare && avgFare !== null
                ? Math.round(((avgFare - baseFare) / baseFare) * 10000) / 100
                : null,
          },
        };
      });

      res.json({
        range: { days: query.days, from, to: new Date().toISOString() },
        count: data.length,
        data,
      });
    }),
  );

  router.get(
    '/anomalies',
    asyncHandler(async (req, res) => {
      const query = parseQuery(
        z.object({
          cityId: z.string().min(1).optional(),
          resolved: z.enum(['true', 'false']).optional(),
          severity: z.enum(['low', 'medium', 'high']).optional(),
          kind: z.string().min(1).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        req,
      );
      const params = [];
      const clauses = [];
      const add = (template, value) => {
        params.push(value);
        clauses.push(template.replace('$?', `$${params.length}`));
      };
      if (query.cityId) add('a.city_id = $?', query.cityId);
      if (query.resolved) {
        clauses.push(
          query.resolved === 'true'
            ? 'a.resolved_at IS NOT NULL'
            : 'a.resolved_at IS NULL',
        );
      }
      if (query.severity) add('a.severity = $?::anomaly_severity', query.severity);
      if (query.kind) add('a.kind = $?', query.kind);

      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = await db.query(
        `SELECT COUNT(*)::int AS total FROM fare_anomalies a ${where}`,
        params,
      );
      const listParams = [...params, query.limit, query.offset];
      const result = await db.query(
        `SELECT a.*, t.reference, c.display_name AS city_name
         FROM fare_anomalies a
         JOIN trips t ON t.id = a.trip_id
         JOIN cities c ON c.id = a.city_id
         ${where}
         ORDER BY a.detected_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );
      res.json({
        data: result.rows.map(serializeAnomaly),
        pagination: {
          total: int(total.rows[0].total),
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + result.rows.length < Number(total.rows[0].total),
        },
      });
    }),
  );

  router.patch(
    '/anomalies/:anomalyId/resolve',
    asyncHandler(async (req, res) => {
      const input = parseBody(
        z.object({
          resolutionNote: z.string().max(1000).default('Resolved via API'),
          actorName: z.string().min(1).default('API'),
        }),
        req,
      );
      const existing = await db.query(
        `SELECT * FROM fare_anomalies WHERE id = $1`,
        [req.params.anomalyId],
      );
      if (!existing.rows.length) {
        throw new ApiError(404, 'ANOMALY_NOT_FOUND', 'Anomaly not found.');
      }
      const updated = await db.query(
        `UPDATE fare_anomalies
         SET resolved_at = now(), resolution_note = $2
         WHERE id = $1
         RETURNING *`,
        [req.params.anomalyId, input.resolutionNote],
      );
      await db.query(
        `INSERT INTO audit_events
          (actor_name, role, action, entity_type, entity_id, city_id, detail)
         VALUES ($1,'api','anomaly.resolved','fare_anomaly',$2,$3,$4::jsonb)`,
        [
          input.actorName,
          req.params.anomalyId,
          updated.rows[0].city_id,
          JSON.stringify({ resolutionNote: input.resolutionNote }),
        ],
      );
      res.json(serializeAnomaly(updated.rows[0]));
    }),
  );

  router.get(
    '/audit',
    asyncHandler(async (req, res) => {
      const query = parseQuery(
        z.object({
          cityId: z.string().min(1).optional(),
          action: z.string().min(1).optional(),
          limit: z.coerce.number().int().min(1).max(500).default(50),
          offset: z.coerce.number().int().min(0).default(0),
        }),
        req,
      );
      const params = [];
      const clauses = [];
      if (query.cityId) {
        params.push(query.cityId);
        clauses.push(`a.city_id = $${params.length}`);
      }
      if (query.action) {
        params.push(query.action);
        clauses.push(`a.action = $${params.length}`);
      }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const total = await db.query(
        `SELECT COUNT(*)::int AS total FROM audit_events a ${where}`,
        params,
      );
      const listParams = [...params, query.limit, query.offset];
      const result = await db.query(
        `SELECT a.*, c.display_name AS city_name
         FROM audit_events a
         LEFT JOIN cities c ON c.id = a.city_id
         ${where}
         ORDER BY a.occurred_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );
      res.json({
        data: result.rows.map(serializeAudit),
        pagination: {
          total: int(total.rows[0].total),
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + result.rows.length < Number(total.rows[0].total),
        },
      });
    }),
  );

  return router;
}
