import { readFile } from 'node:fs/promises';
import { createHash, scryptSync } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DISCOUNT_PROGRAMS,
  VEHICLE_CATALOG,
  VEHICLE_BY_ID,
} from './data/vehicle-catalog.js';
import { buildFeatures, computeMetrics, fitLinearRegression } from './lib/ml.js';
import { mulberry32, pick, weighted } from './lib/mulberry32.js';

const MODEL_KEY = 'fare-fair-linear';

/**
 * Demo accounts created by `npm run db:reset`. The password is fixture data,
 * not a production credential: it can be overridden with SEED_DEMO_PASSWORD
 * and must be set explicitly when NODE_ENV=production.
 */
const DEMO_PASSWORD =
  process.env.SEED_DEMO_PASSWORD ??
  (process.env.NODE_ENV === 'production' ? null : 'farefair');

const here = path.dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = path.resolve(
  here,
  '..',
  'db',
  'data',
  'cabadbaran-tricycle-fare-matrix.json',
);

const FLAG_REASONS = [
  'Reported fare above the published matrix',
  'GPS breadcrumb gap over 400 m',
  'Passenger count exceeds seat cap',
  'Duplicate trip signature detected',
];

export async function seed(db, { now = new Date(), tripDays = 21, log = () => {} } = {}) {
  const dataset = JSON.parse(await readFile(DATASET_PATH, 'utf8'));
  const city = dataset.city;
  const official = dataset.fareMatrix;
  const vehicle = VEHICLE_BY_ID.get(official.vehicleId);
  if (!vehicle) {
    throw new Error(`Unknown official vehicle "${official.vehicleId}"`);
  }

  const placeByAlias = new Map();
  for (const place of dataset.places) {
    for (const alias of place.aliases) placeByAlias.set(alias, place);
    placeByAlias.set(place.key, place);
  }

  const summary = await db.transaction(async (tx) => {
    // ---------------------------------------------------------------------
    // Global catalog (vehicle classes + statutory discount programs)
    // ---------------------------------------------------------------------
    for (const [index, entry] of VEHICLE_CATALOG.entries()) {
      await tx.query(
        `INSERT INTO vehicle_types
          (id, category, name, tag, description, icon,
           default_base_fare, default_base_distance_km, default_per_km_rate,
           default_min_fare, default_max_customary, typical_capacity,
           regulation_note, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          entry.id,
          entry.category,
          entry.name,
          entry.tag,
          entry.description,
          entry.icon,
          entry.baseFare,
          entry.baseDistanceKm,
          entry.perKmRate,
          entry.minFare,
          entry.maxCustomary,
          entry.typicalCapacity,
          entry.regulationNote,
          index + 1,
        ],
      );
    }

    for (const program of DISCOUNT_PROGRAMS) {
      await tx.query(
        `INSERT INTO discount_programs (code, label, rate, legal_basis, description, is_active)
         VALUES ($1,$2,$3,$4,$5,TRUE)`,
        [
          program.code,
          program.label,
          program.rate,
          program.legalBasis,
          program.description,
        ],
      );
    }

    // ---------------------------------------------------------------------
    // The single live city: Cabadbaran
    // ---------------------------------------------------------------------
    const effectiveFrom = parseDateOnly(official.effectiveFrom);
    await tx.query(
      `INSERT INTO cities
        (id, display_name, province, region, status, centro_label,
         center_lat, center_lng, timezone, is_focus)
       VALUES ($1,$2,$3,$4,$5::city_status,$6,$7,$8,$9,TRUE)`,
      [
        city.id,
        city.displayName,
        city.province,
        city.region,
        city.status ?? 'active',
        city.centroLabel ?? '',
        city.center.lat,
        city.center.lng,
        city.timezone ?? 'Asia/Manila',
      ],
    );

    await tx.query(
      `INSERT INTO city_provenance
        (city_id, provisional, source, last_verified, verified_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        city.id,
        city.provenance.provisional,
        city.provenance.source,
        parseDateOnly(city.provenance.lastVerified),
        city.provenance.verifiedBy ?? null,
      ],
    );

    await tx.query(
      `INSERT INTO city_demo_routes
        (city_id, origin_name, destination_name, distance_km, is_primary)
       VALUES ($1,$2,$3,$4,TRUE)`,
      [
        city.id,
        dataset.demoRoute.originName,
        dataset.demoRoute.destinationName,
        dataset.demoRoute.distanceKm,
      ],
    );

    for (const [index, pair] of dataset.simulatorCorridor.entries()) {
      await tx.query(
        `INSERT INTO city_corridor_points (city_id, seq, lat, lng)
         VALUES ($1,$2,$3,$4)`,
        [city.id, index, pair[0], pair[1]],
      );
    }

    // ---------------------------------------------------------------------
    // Ordinance + active policy + active fare matrix
    // ---------------------------------------------------------------------
    const ordinance = dataset.ordinance;
    const ordinanceRow = await tx.query(
      `INSERT INTO ordinances
        (external_id, slug, city_id, title, municipality, ordinance_number,
         status, date_enacted_label, date_enacted, effective_from, summary,
         vehicle_applicability, base_fare, succeeding_km_rate, discount_terms)
       VALUES ($1,$2,$3,$4,$5,$6,$7::ordinance_status,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        ordinance.externalId,
        `${city.id}-${slugify(ordinance.externalId)}`,
        city.id,
        ordinance.title,
        ordinance.municipality,
        ordinance.ordinanceNumber,
        ordinance.status,
        ordinance.dateEnacted,
        parseDateOnly(ordinance.dateEnacted),
        effectiveFrom,
        ordinance.summary,
        ordinance.vehicleApplicability,
        ordinance.baseFare,
        ordinance.succeedingKmRate,
        ordinance.discountTerms,
      ],
    );
    const ordinanceId = ordinanceRow.rows[0].id;

    for (const vehicleId of mapApplicability(ordinance.vehicleApplicability)) {
      await tx.query(
        `INSERT INTO ordinance_vehicle_applicability (ordinance_id, vehicle_type_id)
         VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [ordinanceId, vehicleId],
      );
    }

    const policyRow = await tx.query(
      `INSERT INTO fare_policy_versions
        (city_id, version, status, discount_rate, customary_leeway_min,
         customary_leeway_max, min_passengers, max_passengers,
         pakyaw_seat_cap, effective_from, ordinance_id, notes, activated_at)
       VALUES ($1,1,'active',$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
       RETURNING *`,
      [
        city.id,
        dataset.farePolicy.discountRate,
        dataset.farePolicy.customaryLeewayMin,
        dataset.farePolicy.customaryLeewayMax,
        dataset.farePolicy.minPassengers,
        dataset.farePolicy.maxPassengers,
        dataset.farePolicy.pakyawSeatCap,
        effectiveFrom,
        ordinanceId,
        'Official Cabadbaran City tricycle fare policy.',
      ],
    );
    const policy = policyRow.rows[0];

    const matrixRow = await tx.query(
      `INSERT INTO fare_matrix_versions
        (city_id, version, status, policy_version_id, ordinance_id,
         effective_from, provisional, source, notes, activated_at)
       VALUES ($1,1,'active',$2,$3,$4,$5,$6,$7,now())
       RETURNING *`,
      [
        city.id,
        policy.id,
        ordinanceId,
        effectiveFrom,
        official.provisional,
        official.source,
        official.notes,
      ],
    );
    const matrix = matrixRow.rows[0];

    const matrixVehicle = official.vehicle;
    await tx.query(
      `INSERT INTO fare_matrix_entries
        (matrix_version_id, vehicle_type_id, ordinance_id, active,
         base_fare, base_distance_km, per_km_rate, min_fare,
         max_customary, typical_capacity, regulation_matrix)
       VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10)`,
      [
        matrix.id,
        official.vehicleId,
        ordinanceId,
        matrixVehicle.baseFare,
        matrixVehicle.baseDistanceKm,
        matrixVehicle.perKmRate,
        matrixVehicle.minFare,
        matrixVehicle.maxCustomary,
        matrixVehicle.typicalCapacity,
        matrixVehicle.regulationMatrix,
      ],
    );

    for (const place of dataset.places) {
      for (const alias of place.aliases) {
        await tx.query(
          `INSERT INTO fare_place_aliases (city_id, place_key, alias_key)
           VALUES ($1,$2,$3)
           ON CONFLICT (city_id, alias_key) DO NOTHING`,
          [city.id, place.key, alias],
        );
      }
    }

    for (const route of dataset.routes) {
      await tx.query(
        `INSERT INTO fare_matrix_routes
          (matrix_version_id, vehicle_type_id, row_number, from_label, to_label,
           via, regular_fare, discounted_fare, remark, bidirectional)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          matrix.id,
          official.vehicleId,
          route.row,
          route.from,
          route.to,
          route.via ?? '',
          route.regular,
          route.discounted,
          route.remark ?? '',
          route.bidirectional !== false,
        ],
      );
    }

    // ---------------------------------------------------------------------
    // Admin identities
    // ---------------------------------------------------------------------
    const adminUsers = [
      ['admin@farefair.local', 'FareFair Administrator', 'admin', []],
      ['analyst@farefair.local', 'FareFair Analyst', 'analyst', []],
      ['lgu@farefair.local', 'Cabadbaran LGU Editor', 'lgu_editor', [city.id]],
    ];
    if (!DEMO_PASSWORD) {
      throw new Error(
        'SEED_DEMO_PASSWORD must be set when seeding demo accounts with NODE_ENV=production.',
      );
    }
    const adminIds = [];
    for (const [email, displayName, role, cityScope] of adminUsers) {
      const result = await tx.query(
        `INSERT INTO admin_users
           (email, display_name, role, password_hash, city_scope)
         VALUES ($1,$2,$3::admin_role,$4,$5::text[])
         RETURNING id`,
        [email, displayName, role, hashPassword(DEMO_PASSWORD), cityScope],
      );
      adminIds.push(result.rows[0].id);
    }

    // ---------------------------------------------------------------------
    // Trips generated from the published routes, never from random fares
    // ---------------------------------------------------------------------
    const random = mulberry32(20260924);
    const legs = buildRouteLegs(dataset, placeByAlias);
    if (!legs.length) throw new Error('The official matrix has no usable routes.');

    const sampleRows = [];
    const tripRows = [];
    const dayMs = 24 * 60 * 60 * 1000;
    const anchor = new Date(now);
    anchor.setUTCHours(0, 0, 0, 0);

    const capacity = Number(matrixVehicle.typicalCapacity);
    const seatCap = Number(policy.pakyaw_seat_cap);
    const minRegular = Number(official.minimumRegularFare);
    const perKm = Number(official.perKmBeyondPoblacion);

    let tripIndex = 0;
    for (let dayOffset = tripDays - 1; dayOffset >= 0; dayOffset -= 1) {
      const day = new Date(anchor.getTime() - dayOffset * dayMs);
      const count = 8 + Math.floor(random() * 7);

      for (let i = 0; i < count; i += 1) {
        const leg = pick(random, legs);

        const lookup = await tx.query(
          `SELECT * FROM fn_lookup_fare_route($1,$2,$3,$4)`,
          [city.id, official.vehicleId, leg.origin, leg.destination],
        );
        if (!lookup.rows.length) continue;
        const route = lookup.rows[0];

        const recordedAt = pickRecordedAt(day, now, random);
        const regularFare = Number(route.regular_fare);
        const discountedFare = Number(route.discounted_fare);
        const distanceKm = derivedDistanceKm(regularFare, minRegular, perKm);
        const passengers =
          Number(policy.min_passengers) +
          Math.floor(random() * (Number(policy.max_passengers) - Number(policy.min_passengers) + 1));
        const pakyaw = random() < 0.12;
        const discountCode = weighted(random, [
          ['none', 70],
          ['student', 15],
          ['senior', 8],
          ['pwd', 7],
        ]);
        const seatUnits = pakyaw ? Math.min(capacity, seatCap) : passengers;
        const perPassengerFare =
          discountCode === 'none' ? regularFare : discountedFare;
        const exactFare = roundMoney(perPassengerFare * seatUnits);
        const recordedVia = random() < 0.28 ? 'live_trip_recording' : 'fare_estimate';
        const status =
          tripIndex === 0
            ? 'flagged'
            : tripIndex === 1
              ? 'disputed'
              : weighted(random, [
                  ['completed', 84],
                  ['flagged', 10],
                  ['disputed', 6],
                ]);
        const flagReason = status === 'completed' ? '' : pick(random, FLAG_REASONS);
        const speedKmh = 14 + random() * 12;
        const durationSeconds = Math.max(
          90,
          Math.round((distanceKm / speedKmh) * 3600),
        );

        const referenceResult = await tx.query(
          `SELECT 'FF-' || nextval('trip_reference_seq') AS reference`,
        );
        const reference = referenceResult.rows[0].reference;

        const tripResult = await tx.query(
          `INSERT INTO trips
            (reference, city_id, vehicle_type_id, matrix_version_id,
             policy_version_id, origin, destination, distance_km,
             duration_seconds, passengers, is_pakyaw, discount_code,
             exact_fare, fare_min, fare_max, fare_source, route_row_number,
             status, flag_reason, recorded_via, recorded_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::discount_code,
                   $13,$14,$15,'official_matrix',$16,$17::trip_status,$18,
                   $19::recorded_via,$20)
           RETURNING id`,
          [
            reference,
            city.id,
            official.vehicleId,
            matrix.id,
            policy.id,
            leg.origin,
            leg.destination,
            distanceKm,
            durationSeconds,
            passengers,
            pakyaw,
            discountCode,
            exactFare,
            exactFare,
            exactFare,
            Number(route.row_number),
            status,
            flagReason,
            recordedVia,
            recordedAt.toISOString(),
          ],
        );
        const tripId = tripResult.rows[0].id;

        await tx.query(
          `INSERT INTO fare_quotes
            (city_id, vehicle_type_id, matrix_version_id, policy_version_id,
             trip_id, origin, destination, route_row_number, distance_km,
             passengers, is_pakyaw, discount_code, base_rate, seat_units,
             exact_fare, fare_min, fare_max, fare_source, source, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::discount_code,
                   $13,$14,$15,$16,$17,'official_matrix','seed',$18)`,
          [
            city.id,
            official.vehicleId,
            matrix.id,
            policy.id,
            tripId,
            leg.origin,
            leg.destination,
            Number(route.row_number),
            distanceKm,
            passengers,
            pakyaw,
            discountCode,
            roundMoney(perPassengerFare),
            seatUnits,
            exactFare,
            exactFare,
            exactFare,
            recordedAt.toISOString(),
          ],
        );

        if (recordedVia === 'live_trip_recording' && dataset.simulatorCorridor.length > 1) {
          const points = buildTripPoints(
            dataset.simulatorCorridor,
            10,
            recordedAt,
            durationSeconds,
            random,
          );
          for (const point of points) {
            await tx.query(
              `INSERT INTO trip_points (trip_id, seq, recorded_at, lat, lng)
               VALUES ($1,$2,$3,$4,$5)`,
              [
                tripId,
                point.seq,
                point.recordedAt.toISOString(),
                point.lat,
                point.lng,
              ],
            );
          }
        }

        if (status !== 'completed') {
          const anomaly = anomalyFor(
            status,
            flagReason,
            perPassengerFare,
            Number(matrixVehicle.maxCustomary),
            durationSeconds,
            distanceKm,
          );
          await tx.query(
            `INSERT INTO fare_anomalies
              (trip_id, city_id, kind, severity, detail, detected_at)
             VALUES ($1,$2,$3,$4::anomaly_severity,$5,$6)`,
            [
              tripId,
              city.id,
              anomaly.kind,
              anomaly.severity,
              anomaly.detail,
              recordedAt.toISOString(),
            ],
          );
        }

        const features = buildFeatures({
          distanceKm,
          passengers,
          seatUnits,
          baseFare: Number(matrixVehicle.baseFare),
          perKmRate: Number(matrixVehicle.perKmRate),
          distanceComponent: Math.max(distanceKm - Number(matrixVehicle.baseDistanceKm), 0) * Number(matrixVehicle.perKmRate),
          discountCode,
        });
        const split =
          tripIndex % 10 === 0
            ? 'test'
            : tripIndex % 10 === 1
              ? 'validation'
              : 'train';

        await tx.query(
          `INSERT INTO ml_training_samples
            (trip_id, city_id, vehicle_type_id, features, label_fare, split)
           VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
          [
            tripId,
            city.id,
            official.vehicleId,
            JSON.stringify(features),
            exactFare,
            split,
          ],
        );

        sampleRows.push({ features, label: exactFare, split });
        tripRows.push({
          id: tripId,
          cityId: city.id,
          vehicleId: official.vehicleId,
          distanceKm,
          passengers,
          pakyaw,
          discountCode,
        });
        tripIndex += 1;
      }
    }

    // ---------------------------------------------------------------------
    // Train the baseline fare model from the official-route history
    // ---------------------------------------------------------------------
    const trainSamples = sampleRows.filter((sample) => sample.split === 'train');
    const validationSamples = sampleRows.filter((sample) => sample.split === 'validation');
    const testSamples = sampleRows.filter((sample) => sample.split === 'test');
    const fitted = fitLinearRegression(trainSamples);
    const metrics = {
      train: computeMetrics(trainSamples, fitted.coefficients),
      validation: computeMetrics(validationSamples, fitted.coefficients),
      test: computeMetrics(testSamples, fitted.coefficients),
    };

    const modelRow = await tx.query(
      `INSERT INTO ml_models (model_key, name, task, target, description)
       VALUES ($1,$2,'fare_regression'::model_task,'exact_fare',$3)
       ON CONFLICT (model_key) DO UPDATE
         SET name = EXCLUDED.name,
             description = EXCLUDED.description
       RETURNING id`,
      [
        MODEL_KEY,
        'FareFair Linear Fare Baseline',
        'Ridge linear regression over engineered fare-matrix features. Retrained from official Cabadbaran trip history through POST /v1/fare/models/train.',
      ],
    );
    const modelId = modelRow.rows[0].id;

    const checksum = createHash('sha256')
      .update(JSON.stringify(fitted.coefficients))
      .digest('hex');

    const versionRow = await tx.query(
      `INSERT INTO ml_model_versions
        (model_id, version, status, algorithm, feature_names, coefficients,
         hyperparameters, metrics, residual_stddev, training_rows,
         trained_at, activated_at, artifact_uri, checksum)
       VALUES ($1,1,'active',$2,$3::text[],$4::jsonb,$5::jsonb,$6::jsonb,
               $7,$8,$9,now(),'inline://coefficients',$10)
       RETURNING id`,
      [
        modelId,
        fitted.algorithm,
        arrayLiteral(fitted.featureNames),
        JSON.stringify(fitted.coefficients),
        JSON.stringify({
          ridge: 1e-6,
          featureSet: 'fare-fair-v1',
          trainRows: trainSamples.length,
          validationRows: validationSamples.length,
          testRows: testSamples.length,
        }),
        JSON.stringify(metrics),
        fitted.residualStddev,
        trainSamples.length,
        new Date(now).toISOString(),
        checksum,
      ],
    );
    const modelVersionId = versionRow.rows[0].id;

    let predictionCount = 0;
    for (const trip of tripRows.slice(0, 80)) {
      const result = await tx.query(
        `SELECT * FROM fn_predict_fare($1,$2,$3,$4,$5,$6::discount_code,$7)`,
        [
          trip.cityId,
          trip.vehicleId,
          trip.distanceKm,
          trip.passengers,
          trip.pakyaw,
          trip.discountCode,
          MODEL_KEY,
        ],
      );
      const prediction = result.rows[0];
      await tx.query(
        `INSERT INTO ml_predictions
          (model_version_id, trip_id, features, predicted_fare,
           lower_bound, upper_bound, confidence, latency_ms)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8)`,
        [
          prediction.model_version_id,
          trip.id,
          JSON.stringify(prediction.features),
          prediction.predicted_fare,
          prediction.lower_bound,
          prediction.upper_bound,
          prediction.confidence,
          1 + Math.floor(random() * 20),
        ],
      );
      predictionCount += 1;
    }

    // ---------------------------------------------------------------------
    // Seed audit trail
    // ---------------------------------------------------------------------
    await recordAudit(tx, {
      actorId: adminIds[0],
      actorName: 'FareFair Administrator',
      role: 'admin',
      action: 'dataset.seeded',
      entityType: 'city',
      entityId: city.id,
      cityId: city.id,
      detail: {
        cities: 1,
        trips: tripRows.length,
        fareRoutes: dataset.routes.length,
        places: dataset.places.length,
        modelKey: MODEL_KEY,
      },
      occurredAt: new Date(now.getTime() - 5 * 60 * 1000).toISOString(),
    });
    await recordAudit(tx, {
      actorId: adminIds[2],
      actorName: 'Cabadbaran LGU Editor',
      role: 'lgu_editor',
      action: 'fare_matrix.activated',
      entityType: 'fare_matrix_version',
      entityId: matrix.id,
      cityId: city.id,
      detail: {
        version: 1,
        provisional: official.provisional,
        effectiveFrom: official.effectiveFrom,
        source: official.source,
        fareRoutes: dataset.routes.length,
      },
      occurredAt: new Date(now.getTime() - 4 * 60 * 1000).toISOString(),
    });
    await recordAudit(tx, {
      actorId: adminIds[1],
      actorName: 'FareFair Analyst',
      role: 'analyst',
      action: 'ml_model.trained',
      entityType: 'ml_model_version',
      entityId: modelVersionId,
      cityId: null,
      detail: { modelKey: MODEL_KEY, rows: trainSamples.length, metrics },
      occurredAt: new Date(now.getTime() - 3 * 60 * 1000).toISOString(),
    });
    await recordAudit(tx, {
      actorId: adminIds[0],
      actorName: 'FareFair Administrator',
      role: 'admin',
      action: 'ml_model.activated',
      entityType: 'ml_model_version',
      entityId: modelVersionId,
      cityId: null,
      detail: { modelKey: MODEL_KEY, version: 1 },
      occurredAt: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
    });

    return {
      cities: 1,
      vehicles: VEHICLE_CATALOG.length,
      ordinances: 1,
      fareMatrixEntries: 1,
      fareRoutes: dataset.routes.length,
      farePlaces: dataset.places.length,
      trips: tripRows.length,
      trainingSamples: sampleRows.length,
      predictions: predictionCount,
      modelVersionId,
      metrics,
    };
  });

  log(
    `Seeded ${summary.cities} city (Cabadbaran), ${summary.fareMatrixEntries} matrix entry, ` +
      `${summary.fareRoutes} official fare routes, ${summary.ordinances} ordinance, ` +
      `${summary.trips} trips, ${summary.trainingSamples} ML samples and ` +
      `${summary.predictions} predictions.`,
  );
  return summary;
}

function buildRouteLegs(dataset, placeByAlias) {
  const legs = [];
  for (const route of dataset.routes) {
    const origins = splitRouteLabel(route.from)
      .map((part) => placeByAlias.get(normalizeKey(part)))
      .filter(Boolean);
    const destinations = splitRouteLabel(route.to)
      .map((part) => placeByAlias.get(normalizeKey(part)))
      .filter(Boolean);
    for (const origin of origins) {
      for (const destination of destinations) {
        legs.push({
          row: route.row,
          origin: origin.label,
          destination: destination.label,
          originKey: origin.key,
          destinationKey: destination.key,
        });
      }
    }
  }
  return legs;
}

function splitRouteLabel(label) {
  return String(label)
    .split(/\s+or\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeKey(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function derivedDistanceKm(regularFare, minimumFare, perKmRate) {
  const extra = Math.max(0, regularFare - minimumFare);
  const km = 1 + extra / perKmRate;
  return Math.round(km * 10) / 10;
}

function pickRecordedAt(day, now, random) {
  const hour = 6 + Math.floor(random() * 14);
  const minute = Math.floor(random() * 60);
  let recordedAt = new Date(
    Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      hour,
      minute,
      Math.floor(random() * 60),
    ),
  );
  if (recordedAt > now) {
    recordedAt = new Date(
      now.getTime() - (5 + Math.floor(random() * 90)) * 60 * 1000,
    );
  }
  return recordedAt;
}

function parseDateOnly(value) {
  if (!value || /pending/i.test(value)) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mapApplicability(text) {
  const value = String(text).toLowerCase();
  const ids = new Set();
  if (value.includes('tricycle')) ids.add('tricycle');
  if (value.includes('bao-bao') || value.includes('bao bao')) ids.add('bao-bao');
  if (value.includes('trisikad')) ids.add('trisikad');
  if (value.includes('habal')) ids.add('habal-habal');
  if (value.includes('skylab')) ids.add('skylab');
  if (value.includes('motorela')) ids.add('motorela');
  if (value.includes('multicab')) ids.add('multicab');
  if (value.includes('modern')) ids.add('modern-puj');
  if (value.includes('traditional') || value.includes('jeepney')) {
    ids.add('jeepney');
  }
  if (
    value.includes('puj') &&
    !value.includes('modern') &&
    !value.includes('traditional')
  ) {
    ids.add('jeepney');
  }
  return [...ids];
}

function buildTripPoints(corridor, count, start, durationSeconds, random) {
  const points = [];
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    const scaled = t * (corridor.length - 1);
    const index = Math.min(corridor.length - 2, Math.floor(scaled));
    const fraction = scaled - index;
    const from = corridor[index];
    const to = corridor[index + 1];
    points.push({
      seq: i,
      lat: round6(
        Number(from[0]) + (Number(to[0]) - Number(from[0])) * fraction +
          (random() - 0.5) * 0.00008,
      ),
      lng: round6(
        Number(from[1]) + (Number(to[1]) - Number(from[1])) * fraction +
          (random() - 0.5) * 0.00008,
      ),
      recordedAt: new Date(start.getTime() + t * durationSeconds * 1000),
    });
  }
  return points;
}

function anomalyFor(status, reason, perPassengerFare, maxCustomary, durationSeconds, distanceKm) {
  if (perPassengerFare > maxCustomary) {
    return {
      kind: 'above_customary_ceiling',
      severity: 'high',
      detail: `Recorded fare ₱${perPassengerFare.toFixed(2)} exceeds the published cap of ₱${maxCustomary.toFixed(2)}.`,
    };
  }
  if (/GPS/i.test(reason)) {
    return {
      kind: 'gps_breadcrumb_gap',
      severity: 'medium',
      detail: 'Recorded trajectory contains a gap larger than 400 m.',
    };
  }
  if (durationSeconds > 0 && distanceKm / (durationSeconds / 3600) > 60) {
    return {
      kind: 'gps_speed_outlier',
      severity: 'medium',
      detail: 'Implied average speed exceeds 60 km/h for an informal transit trip.',
    };
  }
  return {
    kind: 'manual_flag',
    severity: status === 'disputed' ? 'high' : 'low',
    detail: reason || 'Trip was flagged for manual review.',
  };
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function round6(value) {
  return Math.round(value * 1e6) / 1e6;
}

function arrayLiteral(values) {
  return `{${values.join(',')}}`;
}

function hashPassword(password) {
  const salt = 'farefair-seed-salt';
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

async function recordAudit(tx, entry) {
  await tx.query(
    `INSERT INTO audit_events
      (occurred_at, actor_id, actor_name, role, action, entity_type,
       entity_id, city_id, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      entry.occurredAt ?? new Date().toISOString(),
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

export { MODEL_KEY };
