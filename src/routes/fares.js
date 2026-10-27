import express from 'express';
import { z } from 'zod';

import { ApiError, asyncHandler } from '../lib/errors.js';
import { parseBody, parseQuery, registerUuidParams } from '../lib/validate.js';
import {
  blankToNull,
  buildOfficialFare,
  lookupOfficialFare,
} from '../lib/fare.js';
import {
  asJson,
  dateOnly,
  int,
  iso,
  money,
  num,
  serializeFareRoute,
  serializeModelVersion,
  serializeQuote,
} from '../lib/serialize.js';
import {
  DEFAULT_MODEL_KEY,
  activateModelVersion,
  trainFareModel,
} from '../services/model-service.js';

const discountCodes = ['none', 'student', 'senior', 'pwd'];

const fareInputSchema = z.object({
  cityId: z.string().min(1),
  vehicleId: z.string().min(1),
  distanceKm: z.coerce.number().min(0).max(500).optional(),
  passengers: z.coerce.number().int().min(1).max(60).default(1),
  pakyaw: z.boolean().default(false),
  discountCode: z.enum(discountCodes).default('none'),
  origin: z.string().max(200).optional(),
  destination: z.string().max(200).optional(),
  persist: z.boolean().default(false),
});

const predictSchema = fareInputSchema.extend({
  modelKey: z.string().min(1).default(DEFAULT_MODEL_KEY),
});

export function fareRoutes(db) {
  const router = express.Router();
  registerUuidParams(router, ['quoteId', 'versionId']);

  // -------------------------------------------------------------------------
  // Official fare routes (city-scoped alias used by clients)
  // -------------------------------------------------------------------------
  router.get(
    '/fare/routes',
    asyncHandler(async (req, res) => {
      const query = parseQuery(
        z.object({
          cityId: z.string().min(1).optional(),
          vehicleId: z.string().min(1).optional(),
          search: z.string().min(1).max(120).optional(),
        }),
        req,
      );
      let cityId = query.cityId;
      let cityName = null;
      if (cityId) {
        const city = await db.query(
          `SELECT id, display_name FROM cities WHERE id = $1`,
          [cityId],
        );
        if (!city.rows.length) {
          throw new ApiError(
            404,
            'CITY_NOT_FOUND',
            `City "${cityId}" was not found.`,
          );
        }
        cityName = city.rows[0].display_name;
      } else {
        const focus = await db.query(
          `SELECT id, display_name FROM cities WHERE is_focus LIMIT 1`,
        );
        cityId = focus.rows[0]?.id ?? null;
        cityName = focus.rows[0]?.display_name ?? null;
      }

      const params = [];
      const clauses = [];
      if (cityId) {
        params.push(cityId);
        clauses.push(`city_id = $${params.length}`);
      }
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
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const result = await db.query(
        `SELECT * FROM v_official_fare_routes ${where}
         ORDER BY city_id, vehicle_type_id, row_number`,
        params,
      );
      const first = result.rows[0] ?? null;
      res.json({
        cityId,
        cityName,
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

  // -------------------------------------------------------------------------
  // Fare engine
  // -------------------------------------------------------------------------
  router.post(
    '/fare/estimate',
    asyncHandler(async (req, res) => {
      const input = parseBody(fareInputSchema, req);
      const origin = blankToNull(input.origin);
      const destination = blankToNull(input.destination);

      // A published point-to-point fare always wins over the distance formula.
      const official =
        origin && destination
          ? await lookupOfficialFare(
              db,
              input.cityId,
              input.vehicleId,
              origin,
              destination,
            )
          : null;

      if (!official && input.distanceKm === undefined) {
        throw new ApiError(
          400,
          'DISTANCE_REQUIRED',
          'distanceKm is required when the origin/destination pair is not in the official fare matrix.',
        );
      }

      const distanceProvided = input.distanceKm !== undefined;
      const distanceKm = official
        ? input.distanceKm ?? official.derivedDistanceKm
        : input.distanceKm;

      let fare;
      if (official) {
        fare = buildOfficialFare(input, official, distanceKm);
      } else {
        const result = await db.query(
          `SELECT * FROM fn_calculate_fare($1,$2,$3,$4,$5,$6::discount_code)`,
          [
            input.cityId,
            input.vehicleId,
            distanceKm,
            input.passengers,
            input.pakyaw,
            input.discountCode,
          ],
        );
        fare = result.rows[0];
      }

      let quoteId = null;
      if (input.persist) {
        const inserted = await db.query(
          `INSERT INTO fare_quotes
            (city_id, vehicle_type_id, matrix_version_id, policy_version_id,
             origin, destination, route_row_number, distance_km, passengers,
             is_pakyaw, discount_code, base_rate, seat_units, exact_fare,
             fare_min, fare_max, fare_source, source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::discount_code,$12,$13,
                   $14,$15,$16,$17,'api')
           RETURNING id`,
          [
            input.cityId,
            input.vehicleId,
            fare.matrix_version_id,
            fare.policy_version_id,
            origin,
            destination,
            fare.route_row_number ?? null,
            distanceKm,
            input.passengers,
            input.pakyaw,
            input.discountCode,
            money(fare.base_rate),
            fare.seat_units,
            money(fare.exact_fare),
            money(fare.fare_min),
            money(fare.fare_max),
            fare.fare_source ?? 'distance_matrix',
          ],
        );
        quoteId = inserted.rows[0].id;
      }

      res.json(
        toEstimateResponse(
          { ...input, distanceKm, distanceProvided },
          fare,
          quoteId,
          official,
        ),
      );
    }),
  );

  router.get(
    '/fare/quotes/:quoteId',
    asyncHandler(async (req, res) => {
      const result = await db.query(
        `SELECT q.*, c.display_name AS city_name, vt.name AS vehicle_name
         FROM fare_quotes q
         JOIN cities c ON c.id = q.city_id
         JOIN vehicle_types vt ON vt.id = q.vehicle_type_id
         WHERE q.id = $1`,
        [req.params.quoteId],
      );
      if (!result.rows.length) {
        throw new ApiError(404, 'QUOTE_NOT_FOUND', 'Fare quote not found.');
      }
      res.json(serializeQuote(result.rows[0]));
    }),
  );

  // -------------------------------------------------------------------------
  // ML prediction
  // -------------------------------------------------------------------------
  router.post(
    '/fare/predict',
    asyncHandler(async (req, res) => {
      const input = parseBody(predictSchema, req);
      const started = performance.now();
      const result = await db.query(
        `SELECT * FROM fn_predict_fare($1,$2,$3,$4,$5,$6::discount_code,$7)`,
        [
          input.cityId,
          input.vehicleId,
          input.distanceKm,
          input.passengers,
          input.pakyaw,
          input.discountCode,
          input.modelKey,
        ],
      );
      const prediction = result.rows[0];
      const latencyMs = Math.max(1, Math.round(performance.now() - started));

      let predictionId = null;
      if (input.persist) {
        const inserted = await db.query(
          `INSERT INTO ml_predictions
            (model_version_id, features, predicted_fare, lower_bound,
             upper_bound, confidence, latency_ms)
           VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7)
           RETURNING id`,
          [
            prediction.model_version_id,
            JSON.stringify(prediction.features),
            prediction.predicted_fare,
            prediction.lower_bound,
            prediction.upper_bound,
            prediction.confidence,
            latencyMs,
          ],
        );
        predictionId = inserted.rows[0].id;
      }

      res.json({
        cityId: input.cityId,
        vehicleId: input.vehicleId,
        distanceKm: input.distanceKm,
        passengers: input.passengers,
        pakyaw: input.pakyaw,
        discountCode: input.discountCode,
        model: {
          key: prediction.model_key,
          versionId: prediction.model_version_id,
          version: int(prediction.model_version),
          algorithm: prediction.algorithm,
        },
        prediction: {
          currency: prediction.currency,
          fare: money(prediction.predicted_fare),
          lowerBound: money(prediction.lower_bound),
          upperBound: money(prediction.upper_bound),
          confidence: num(prediction.confidence),
        },
        features: asJson(prediction.features),
        predictionId,
      });
    }),
  );

  router.get(
    '/fare/predictions',
    asyncHandler(async (req, res) => {
      const query = parseQuery(
        z.object({
          modelVersionId: z.string().uuid().optional(),
          tripId: z.string().uuid().optional(),
          limit: z.coerce.number().int().min(1).max(500).default(50),
        }),
        req,
      );
      const params = [];
      const clauses = [];
      if (query.modelVersionId) {
        params.push(query.modelVersionId);
        clauses.push(`p.model_version_id = $${params.length}`);
      }
      if (query.tripId) {
        params.push(query.tripId);
        clauses.push(`p.trip_id = $${params.length}`);
      }
      params.push(query.limit);
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const result = await db.query(
        `SELECT p.*, m.model_key, v.version, t.reference AS trip_reference
         FROM ml_predictions p
         JOIN ml_model_versions v ON v.id = p.model_version_id
         JOIN ml_models m ON m.id = v.model_id
         LEFT JOIN trips t ON t.id = p.trip_id
         ${where}
         ORDER BY p.created_at DESC
         LIMIT $${params.length}`,
        params,
      );
      res.json({
        data: result.rows.map((row) => ({
          id: row.id,
          modelKey: row.model_key,
          modelVersion: int(row.version),
          modelVersionId: row.model_version_id,
          tripId: row.trip_id,
          tripReference: row.trip_reference,
          features: asJson(row.features),
          predictedFare: money(row.predicted_fare),
          lowerBound: money(row.lower_bound),
          upperBound: money(row.upper_bound),
          confidence: num(row.confidence),
          latencyMs: int(row.latency_ms),
          createdAt: iso(row.created_at),
        })),
        count: result.rows.length,
      });
    }),
  );

  // -------------------------------------------------------------------------
  // Model registry + training
  // -------------------------------------------------------------------------
  router.get(
    '/fare/models',
    asyncHandler(async (req, res) => {
      const result = await db.query(
        `SELECT v.*, m.model_key, m.name, m.task, m.target, m.description,
           (
             SELECT COUNT(*)::int FROM ml_predictions p
             WHERE p.model_version_id = v.id
           ) AS prediction_count
         FROM ml_model_versions v
         JOIN ml_models m ON m.id = v.model_id
         ORDER BY m.model_key, v.version DESC`,
      );
      const byModel = new Map();
      for (const row of result.rows) {
        if (!byModel.has(row.model_key)) {
          byModel.set(row.model_key, {
            modelKey: row.model_key,
            name: row.name,
            task: row.task,
            target: row.target,
            description: row.description,
            versions: [],
            activeVersionId: null,
          });
        }
        const model = byModel.get(row.model_key);
        const version = {
          ...serializeModelVersion(row),
          predictionCount: int(row.prediction_count),
        };
        model.versions.push(version);
        if (version.isActive) model.activeVersionId = version.id;
      }
      res.json({ data: [...byModel.values()], count: byModel.size });
    }),
  );

  router.post(
    '/fare/models/train',
    asyncHandler(async (req, res) => {
      const input = parseBody(
        z.object({
          modelKey: z.string().min(1).default(DEFAULT_MODEL_KEY),
          activate: z.boolean().default(true),
          actorName: z.string().min(1).default('API'),
          role: z.string().min(1).default('system'),
        }),
        req,
      );
      const version = await trainFareModel(db, input);
      res.status(201).json(version);
    }),
  );

  router.get(
    '/fare/models/versions/:versionId',
    asyncHandler(async (req, res) => {
      const result = await db.query(
        `SELECT v.*, m.model_key, m.name, m.task, m.target, m.description
         FROM ml_model_versions v
         JOIN ml_models m ON m.id = v.model_id
         WHERE v.id = $1`,
        [req.params.versionId],
      );
      if (!result.rows.length) {
        throw new ApiError(404, 'MODEL_VERSION_NOT_FOUND', 'Model version not found.');
      }
      const predictions = await db.query(
        `SELECT COUNT(*)::int AS count,
                COALESCE(ROUND(AVG(latency_ms),1),0) AS avg_latency_ms,
                COALESCE(ROUND(AVG(confidence),4),0) AS avg_confidence
         FROM ml_predictions WHERE model_version_id = $1`,
        [req.params.versionId],
      );
      res.json({
        ...serializeModelVersion(result.rows[0]),
        predictionStats: {
          count: int(predictions.rows[0].count),
          avgLatencyMs: num(predictions.rows[0].avg_latency_ms),
          avgConfidence: num(predictions.rows[0].avg_confidence),
        },
      });
    }),
  );

  router.post(
    '/fare/models/versions/:versionId/activate',
    asyncHandler(async (req, res) => {
      const input = parseBody(
        z.object({
          actorName: z.string().min(1).default('API'),
          role: z.string().min(1).default('system'),
        }),
        req,
      );
      const version = await activateModelVersion(db, req.params.versionId, input);
      res.json(version);
    }),
  );

  router.get(
    '/fare/models/:idOrKey',
    asyncHandler(async (req, res) => {
      const modelResult = await db.query(
        `SELECT * FROM ml_models
         WHERE model_key = $1 OR id::text = $1
         LIMIT 1`,
        [req.params.idOrKey],
      );
      const model = modelResult.rows[0];
      if (!model) {
        throw new ApiError(404, 'MODEL_NOT_FOUND', 'Model not found.');
      }
      const versions = await db.query(
        `SELECT v.*, m.model_key, m.name, m.task, m.target,
           (
             SELECT COUNT(*)::int FROM ml_predictions p
             WHERE p.model_version_id = v.id
           ) AS prediction_count
         FROM ml_model_versions v
         JOIN ml_models m ON m.id = v.model_id
         WHERE v.model_id = $1
         ORDER BY v.version DESC`,
        [model.id],
      );
      const serialized = versions.rows.map((row) => ({
        ...serializeModelVersion(row),
        predictionCount: int(row.prediction_count),
      }));
      res.json({
        id: model.id,
        modelKey: model.model_key,
        name: model.name,
        task: model.task,
        target: model.target,
        description: model.description,
        createdAt: iso(model.created_at),
        activeVersionId: serialized.find((version) => version.isActive)?.id ?? null,
        versions: serialized,
      });
    }),
  );

  return router;
}

function toEstimateResponse(input, fare, quoteId, official = null) {
  const subtotal = Number(fare.subtotal);
  const exact = Number(fare.exact_fare);
  return {
    cityId: input.cityId,
    vehicleId: input.vehicleId,
    distanceKm: input.distanceKm,
    distanceKmSource: official
      ? input.distanceProvided
        ? 'requested'
        : 'derived_from_published_fare'
      : 'requested',
    passengers: input.passengers,
    pakyaw: input.pakyaw,
    discountCode: input.discountCode,
    origin: blankToNull(input.origin),
    destination: blankToNull(input.destination),
    fareSource: fare.fare_source ?? 'distance_matrix',
    routeRowNumber: fare.route_row_number ?? null,
    route: official
      ? {
          rowNumber: Number(official.route.row_number),
          from: official.route.from_label,
          to: official.route.to_label,
          matchedOrigin: official.route.matched_origin,
          matchedDestination: official.route.matched_destination,
          via: blankToNull(official.route.via),
          remark: blankToNull(official.route.remark),
          reversed: Boolean(official.route.reversed),
          regularFare: money(official.route.regular_fare),
          discountedFare: money(official.route.discounted_fare),
        }
      : null,
    fare: {
      currency: fare.currency,
      exact: money(fare.exact_fare),
      min: money(fare.fare_min),
      max: money(fare.fare_max),
    },
    breakdown: {
      baseFare: money(fare.base_fare),
      baseDistanceKm: num(fare.base_distance_km),
      perKmRate: money(fare.per_km_rate),
      distanceComponent: money(fare.distance_component),
      baseRate: money(fare.base_rate),
      seatUnits: int(fare.seat_units),
      subtotal: money(subtotal),
      discountRate: num(fare.discount_rate),
      discountAmount: money(subtotal - exact),
    },
    matrixVersionId: fare.matrix_version_id,
    policyVersionId: fare.policy_version_id,
    provisional: fare.provisional,
    quoteId,
  };
}

