import express from 'express';
import { z } from 'zod';

import { ApiError, asyncHandler } from '../lib/errors.js';
import { parseBody, parseQuery, registerUuidParams } from '../lib/validate.js';
import { buildOfficialFare, lookupOfficialFare } from '../lib/fare.js';
import {
  asJson,
  int,
  iso,
  money,
  num,
  serializeAnomaly,
  serializePoint,
  serializeQuote,
  serializeTrip,
  toCsv,
} from '../lib/serialize.js';

const discountCodes = ['none', 'student', 'senior', 'pwd'];
const tripStatuses = ['completed', 'flagged', 'disputed'];
const recordedViaValues = ['fare_estimate', 'live_trip_recording', 'import'];

const filterSchema = z.object({
  cityId: z.string().min(1).optional(),
  vehicleId: z.string().min(1).optional(),
  status: z.enum(tripStatuses).optional(),
  discountCode: z.enum(discountCodes).optional(),
  recordedVia: z.enum(recordedViaValues).optional(),
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
  search: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function tripRoutes(db) {
  const router = express.Router();
  registerUuidParams(router, ['tripId']);

  router.get(
    '/trips',
    asyncHandler(async (req, res) => {
      const query = parseQuery(filterSchema, req);
      const { where, params } = buildTripFilters(query);
      const totalResult = await db.query(
        `SELECT COUNT(*)::int AS total FROM trips t ${where}`,
        params,
      );
      const listParams = [...params, query.limit, query.offset];
      const listResult = await db.query(
        `SELECT * FROM v_trip_enriched t ${where}
         ORDER BY t.recorded_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams,
      );
      const total = int(totalResult.rows[0].total);
      res.json({
        data: listResult.rows.map(serializeTrip),
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          hasMore: query.offset + listResult.rows.length < total,
        },
      });
    }),
  );

  router.get(
    '/trips.csv',
    asyncHandler(async (req, res) => {
      const query = parseQuery(filterSchema, req);
      const { where, params } = buildTripFilters(query);
      params.push(5000);
      const result = await db.query(
        `SELECT * FROM v_trip_enriched t ${where}
         ORDER BY t.recorded_at DESC
         LIMIT $${params.length}`,
        params,
      );
      const rows = [
        [
          'Trip ID',
          'Reference',
          'Timestamp',
          'City',
          'Vehicle',
          'Origin',
          'Destination',
          'Distance (km)',
          'Duration (sec)',
          'Passengers',
          'Pakyaw',
          'Discount',
          'Exact fare (PHP)',
          'Range min (PHP)',
          'Range max (PHP)',
          'Status',
          'Notes',
          'Recorded via',
        ],
        ...result.rows.map((row) => [
          row.id,
          row.reference,
          iso(row.recorded_at),
          row.city_name,
          row.vehicle_name,
          row.origin,
          row.destination,
          num(row.distance_km),
          int(row.duration_seconds),
          int(row.passengers),
          row.is_pakyaw ? 'Yes' : 'No',
          row.discount_code,
          money(row.exact_fare),
          money(row.fare_min),
          money(row.fare_max),
          row.status,
          row.flag_reason,
          row.recorded_via,
        ]),
      ];
      res
        .type('text/csv; charset=utf-8')
        .set(
          'Content-Disposition',
          'attachment; filename="farefair-trips.csv"',
        )
        .send(toCsv(rows));
    }),
  );

  router.get(
    '/trips/:tripId',
    asyncHandler(async (req, res) => {
      const trip = await getTripDetail(db, req.params.tripId);
      res.json(trip);
    }),
  );

  router.post(
    '/trips',
    asyncHandler(async (req, res) => {
      const input = parseBody(
        z.object({
          cityId: z.string().min(1),
          vehicleId: z.string().min(1),
          origin: z.string().min(1).max(200),
          destination: z.string().min(1).max(200),
          distanceKm: z.coerce.number().min(0).max(500).optional(),
          durationSeconds: z.coerce
            .number()
            .int()
            .min(0)
            .max(172800)
            .default(0),
          passengers: z.coerce.number().int().min(1).max(60).default(1),
          pakyaw: z.boolean().default(false),
          discountCode: z.enum(discountCodes).default('none'),
          recordedVia: z.enum(recordedViaValues).default('fare_estimate'),
          recordedAt: z.string().min(1).optional(),
          routePoints: z
            .array(
              z.object({
                lat: z.coerce.number().min(-90).max(90),
                lng: z.coerce.number().min(-180).max(180),
                recordedAt: z.string().min(1).optional(),
              }),
            )
            .max(5000)
            .default([]),
          runPrediction: z.boolean().default(true),
        }),
        req,
      );

      const policyResult = await db.query(
        `SELECT * FROM fare_policy_versions
         WHERE city_id = $1 AND status = 'active'
         LIMIT 1`,
        [input.cityId],
      );
      const policy = policyResult.rows[0];
      if (!policy) {
        throw new ApiError(
          404,
          'FARE_POLICY_NOT_FOUND',
          `No active fare policy for city "${input.cityId}".`,
        );
      }
      if (
        input.passengers < Number(policy.min_passengers) ||
        input.passengers > Number(policy.max_passengers)
      ) {
        throw new ApiError(
          422,
          'PASSENGER_COUNT_OUT_OF_RANGE',
          `passengers must be between ${policy.min_passengers} and ${policy.max_passengers} for this city.`,
        );
      }

      const recordedAt = input.recordedAt
        ? toIsoDate(input.recordedAt, 'recordedAt')
        : new Date().toISOString();

      const official = await lookupOfficialFare(
        db,
        input.cityId,
        input.vehicleId,
        input.origin,
        input.destination,
      );

      let fare;
      if (official) {
        fare = buildOfficialFare(input, official, input.distanceKm);
      } else {
        if (input.distanceKm === undefined) {
          throw new ApiError(
            400,
            'DISTANCE_REQUIRED',
            'distanceKm is required when the origin/destination pair is not in the official fare matrix.',
          );
        }
        const fareResult = await db.query(
          `SELECT * FROM fn_calculate_fare($1,$2,$3,$4,$5,$6::discount_code)`,
          [
            input.cityId,
            input.vehicleId,
            input.distanceKm,
            input.passengers,
            input.pakyaw,
            input.discountCode,
          ],
        );
        fare = fareResult.rows[0];
      }
      const fareSource = official ? 'official_matrix' : 'distance_matrix';
      const routeRowNumber = official ? Number(official.route.row_number) : null;
      const distanceKm = official
        ? input.distanceKm ?? official.derivedDistanceKm
        : input.distanceKm;

      const referenceResult = await db.query(
        `SELECT 'FF-' || nextval('trip_reference_seq') AS reference`,
      );
      const reference = referenceResult.rows[0].reference;

      const created = await db.transaction(async (tx) => {
        const tripResult = await tx.query(
          `INSERT INTO trips
            (reference, city_id, vehicle_type_id, matrix_version_id,
             policy_version_id, origin, destination, distance_km,
             duration_seconds, passengers, is_pakyaw, discount_code,
             exact_fare, fare_min, fare_max, fare_source, route_row_number,
             status, flag_reason, recorded_via, recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::discount_code,
                   $13,$14,$15,$16,$17,'completed','',$18::recorded_via,$19)
           RETURNING id`,
          [
            reference,
            input.cityId,
            input.vehicleId,
            fare.matrix_version_id,
            fare.policy_version_id,
            input.origin,
            input.destination,
            distanceKm,
            input.durationSeconds,
            input.passengers,
            input.pakyaw,
            input.discountCode,
            money(fare.exact_fare),
            money(fare.fare_min),
            money(fare.fare_max),
            fareSource,
            routeRowNumber,
            input.recordedVia,
            recordedAt,
          ],
        );
        const tripId = tripResult.rows[0].id;

        if (input.routePoints.length) {
          const placeholders = [];
          const values = [];
          input.routePoints.forEach((point, index) => {
            const base = values.length;
            values.push(
              tripId,
              index,
              point.recordedAt
                ? toIsoDate(point.recordedAt, `routePoints[${index}].recordedAt`)
                : recordedAt,
              point.lat,
              point.lng,
            );
            placeholders.push(
              `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`,
            );
          });
          await tx.query(
            `INSERT INTO trip_points (trip_id, seq, recorded_at, lat, lng)
             VALUES ${placeholders.join(',')}`,
            values,
          );
        }

        const quoteResult = await tx.query(
          `INSERT INTO fare_quotes
            (city_id, vehicle_type_id, matrix_version_id, policy_version_id,
             trip_id, origin, destination, route_row_number, distance_km,
             passengers, is_pakyaw, discount_code, base_rate, seat_units,
             exact_fare, fare_min, fare_max, fare_source, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::discount_code,
                   $13,$14,$15,$16,$17,$18,'api')
           RETURNING id`,
          [
            input.cityId,
            input.vehicleId,
            fare.matrix_version_id,
            fare.policy_version_id,
            tripId,
            input.origin,
            input.destination,
            routeRowNumber,
            distanceKm,
            input.passengers,
            input.pakyaw,
            input.discountCode,
            money(fare.base_rate),
            fare.seat_units,
            money(fare.exact_fare),
            money(fare.fare_min),
            money(fare.fare_max),
            fareSource,
          ],
        );

        let prediction = null;
        if (input.runPrediction) {
          const predictionResult = await tx.query(
            `SELECT * FROM fn_predict_fare($1,$2,$3,$4,$5,$6::discount_code)`,
            [
              input.cityId,
              input.vehicleId,
              distanceKm,
              input.passengers,
              input.pakyaw,
              input.discountCode,
            ],
          );
          const row = predictionResult.rows[0];
          const inserted = await tx.query(
            `INSERT INTO ml_predictions
              (model_version_id, trip_id, quote_id, features, predicted_fare,
               lower_bound, upper_bound, confidence, latency_ms)
             VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
             RETURNING id`,
            [
              row.model_version_id,
              tripId,
              quoteResult.rows[0].id,
              JSON.stringify(row.features),
              row.predicted_fare,
              row.lower_bound,
              row.upper_bound,
              row.confidence,
              1,
            ],
          );
          prediction = {
            id: inserted.rows[0].id,
            modelVersionId: row.model_version_id,
            predictedFare: money(row.predicted_fare),
            lowerBound: money(row.lower_bound),
            upperBound: money(row.upper_bound),
          };
        }

        return { tripId, quoteId: quoteResult.rows[0].id, prediction };
      });

      const detail = await getTripDetail(db, created.tripId);
      res.status(201).json({
        ...detail,
        createdQuoteId: created.quoteId,
        createdPrediction: created.prediction,
      });
    }),
  );

  router.patch(
    '/trips/:tripId/status',
    asyncHandler(async (req, res) => {
      const input = parseBody(
        z.object({
          status: z.enum(tripStatuses),
          flagReason: z.string().max(500).optional(),
          severity: z.enum(['low', 'medium', 'high']).default('medium'),
          actorName: z.string().min(1).default('API'),
        }),
        req,
      );
      const existing = await db.query(
        `SELECT * FROM trips WHERE id = $1`,
        [req.params.tripId],
      );
      const trip = existing.rows[0];
      if (!trip) {
        throw new ApiError(404, 'TRIP_NOT_FOUND', 'Trip not found.');
      }
      const flagReason =
        input.status === 'completed'
          ? ''
          : input.flagReason ?? trip.flag_reason ?? 'Flagged via API';

      await db.transaction(async (tx) => {
        await tx.query(
          `UPDATE trips
           SET status = $1::trip_status, flag_reason = $2
           WHERE id = $3`,
          [input.status, flagReason, req.params.tripId],
        );
        if (input.status !== 'completed') {
          await tx.query(
            `INSERT INTO fare_anomalies
              (trip_id, city_id, kind, severity, detail)
             SELECT $1,$2,'manual_flag',$3::anomaly_severity,$4
             WHERE NOT EXISTS (
               SELECT 1 FROM fare_anomalies
               WHERE trip_id = $1 AND kind = 'manual_flag' AND resolved_at IS NULL
             )`,
            [
              req.params.tripId,
              trip.city_id,
              input.severity,
              flagReason,
            ],
          );
        }
        await tx.query(
          `INSERT INTO audit_events
            (actor_name, role, action, entity_type, entity_id, city_id, detail)
           VALUES ($1,'api','trip.status_changed','trip',$2,$3,$4::jsonb)`,
          [
            input.actorName,
            req.params.tripId,
            trip.city_id,
            JSON.stringify({
              from: trip.status,
              to: input.status,
              flagReason,
            }),
          ],
        );
      });

      const detail = await getTripDetail(db, req.params.tripId);
      res.json(detail);
    }),
  );

  return router;
}

async function getTripDetail(db, tripId) {
  const tripResult = await db.query(
    `SELECT * FROM v_trip_enriched WHERE id = $1`,
    [tripId],
  );
  const trip = tripResult.rows[0];
  if (!trip) {
    throw new ApiError(404, 'TRIP_NOT_FOUND', 'Trip not found.');
  }

  const points = await db.query(
    `SELECT * FROM trip_points WHERE trip_id = $1 ORDER BY seq`,
    [tripId],
  );
  const anomalies = await db.query(
    `SELECT a.*, t.reference
     FROM fare_anomalies a
     JOIN trips t ON t.id = a.trip_id
     WHERE a.trip_id = $1
     ORDER BY a.detected_at DESC`,
    [tripId],
  );
  const predictions = await db.query(
    `SELECT p.*, m.model_key, v.version
     FROM ml_predictions p
     JOIN ml_model_versions v ON v.id = p.model_version_id
     JOIN ml_models m ON m.id = v.model_id
     WHERE p.trip_id = $1
     ORDER BY p.created_at DESC`,
    [tripId],
  );
  const quotes = await db.query(
    `SELECT q.*, c.display_name AS city_name, vt.name AS vehicle_name
     FROM fare_quotes q
     JOIN cities c ON c.id = q.city_id
     JOIN vehicle_types vt ON vt.id = q.vehicle_type_id
     WHERE q.trip_id = $1
     ORDER BY q.created_at DESC`,
    [tripId],
  );

  return {
    ...serializeTrip(trip),
    points: points.rows.map(serializePoint),
    anomalies: anomalies.rows.map(serializeAnomaly),
    predictions: predictions.rows.map((row) => ({
      id: row.id,
      modelKey: row.model_key,
      modelVersion: int(row.version),
      modelVersionId: row.model_version_id,
      features: asJson(row.features),
      predictedFare: money(row.predicted_fare),
      lowerBound: money(row.lower_bound),
      upperBound: money(row.upper_bound),
      confidence: num(row.confidence),
      latencyMs: int(row.latency_ms),
      createdAt: iso(row.created_at),
    })),
    quotes: quotes.rows.map(serializeQuote),
  };
}

function buildTripFilters(query) {
  const params = [];
  const clauses = [];
  const add = (template, value) => {
    params.push(value);
    clauses.push(template.replace('$?', `$${params.length}`));
  };

  if (query.cityId) add('t.city_id = $?', query.cityId);
  if (query.vehicleId) add('t.vehicle_type_id = $?', query.vehicleId);
  if (query.status) add('t.status = $?::trip_status', query.status);
  if (query.discountCode) {
    add('t.discount_code = $?::discount_code', query.discountCode);
  }
  if (query.recordedVia) {
    add('t.recorded_via = $?::recorded_via', query.recordedVia);
  }
  if (query.from) {
    add('t.recorded_at >= $?', toIsoDate(query.from, 'from'));
  }
  if (query.to) {
    add('t.recorded_at <= $?', toIsoDate(query.to, 'to'));
  }
  if (query.search) {
    params.push(`%${query.search}%`);
    const index = params.length;
    clauses.push(
      `(t.reference ILIKE $${index} OR t.origin ILIKE $${index} OR t.destination ILIKE $${index})`,
    );
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  };
}

function toIsoDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ApiError(400, 'INVALID_DATE', `${label} must be a valid ISO date.`);
  }
  return date.toISOString();
}
