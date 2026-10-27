import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applySchema, createDatabase, readSchemaSql } from '../src/db.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.resolve(here, '..', '..', 'assets', 'data');
const openapiPath = path.resolve(here, '..', 'docs', 'openapi.json');

let db;
let server;
let base;

before(
  async () => {
    db = await createDatabase({ driver: 'pglite', dataDir: null });
    await applySchema(db, await readSchemaSql());
    await seed(db, { assetsDir, now: new Date() });
    const app = await createApp(db, { openapiPath });
    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${server.address().port}`;
  },
  { timeout: 180_000 },
);

after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (db) await db.close();
});

async function api(pathname, options = {}) {
  const response = await fetch(`${base}${pathname}`, {
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    ...options,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  // Expose the real status code directly (not a documented/example status).
  const status = response.status;
  if (process.env.API_TEST_STATUS === '1') {
    const method = options.method ?? 'GET';
    const input = options.body ?? '';
    console.log(`[actual status] ${method} ${pathname} -> ${status} ${input}`);
  }

  return { response, status, body, text };
}

test('health reports an available database', async () => {
  const { response, body } = await api('/health');
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.database, 'pglite');
});

test('meta exposes focus city and seeded counts', async () => {
  const { response, body } = await api('/v1/meta');
  assert.equal(response.status, 200);
  assert.equal(body.activeCityId, 'cabadbaran');
  assert.equal(body.counts.cities, 1);
  assert.equal(body.counts.vehicles, 9);
  assert.equal(body.counts.ordinances, 1);
  assert.equal(body.counts.fare_matrix_entries, 1);
  assert.equal(body.counts.fare_routes, 68);
  assert.ok(body.counts.trips > 100);
  assert.ok(body.counts.active_models >= 1);
  assert.equal(body.endpoints.estimate, 'POST /v1/fare/estimate');
  assert.equal(body.endpoints.fareRoutes, '/v1/cities/:cityId/fare-routes');
  assert.equal(body.endpoints.allFareRoutes, '/v1/fare/routes');
});

test('cities catalog keeps Cabadbaran as the focus city', async () => {
  const { response, body } = await api('/v1/cities');
  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.equal(body.activeCityId, 'cabadbaran');
  const focus = body.data.find((city) => city.id === 'cabadbaran');
  assert.equal(focus.isFocus, true);
  assert.equal(focus.provisional, false);
  assert.equal(focus.activeVehicleCount, 1);
  assert.equal(focus.ordinanceCount, 1);
  assert.equal(focus.fareRouteCount, 68);
});

test('city detail mirrors the Cabadbaran official dataset', async () => {
  const { response, body } = await api('/v1/cities/cabadbaran');
  assert.equal(response.status, 200);
  assert.equal(body.displayName, 'Cabadbaran City, Caraga');
  assert.equal(body.center.lat, 9.1157);
  assert.equal(body.farePolicy.discountRate, 0.2);
  assert.equal(body.farePolicy.pakyawSeatCap, 4);
  assert.equal(body.vehicles.length, 1);
  assert.equal(body.ordinances.length, 1);
  assert.equal(body.simulatorCorridor.length, 5);
  assert.equal(body.fareMatrix.entries.length, 1);
  const tricycle = body.vehicles.find((vehicle) => vehicle.vehicleId === 'tricycle');
  assert.equal(tricycle.baseFare, 13);
  assert.equal(tricycle.baseDistanceKm, 1);
  assert.equal(tricycle.perKmRate, 2);
  assert.equal(tricycle.maxCustomary, 75);
});

test('calendar dates keep the enacted day without timezone drift', async () => {
  const { response, body } = await api('/v1/cities/cabadbaran');
  assert.equal(response.status, 200);
  const enacted = body.ordinances.find(
    (ordinance) => ordinance.title === 'Cabadbaran City Tricycle Fare Matrix',
  );
  assert.ok(enacted, 'expected the Cabadbaran fare matrix ordinance');
  assert.equal(enacted.dateEnacted, '2026-09-24');
  assert.equal(enacted.effectiveFrom, '2026-09-24');
  assert.equal(enacted.dateEnactedLabel, '2026-09-24');
});


test('active fare matrix is versioned and complete', async () => {
  const { response, body } = await api('/v1/cities/cabadbaran/fare-matrix');
  assert.equal(response.status, 200);
  assert.equal(body.version, 1);
  assert.equal(body.status, 'active');
  assert.equal(body.provisional, false);
  assert.equal(body.entries.length, 1);
  const tricycle = body.entries.find((entry) => entry.vehicleId === 'tricycle');
  assert.equal(tricycle.baseFare, 13);
  assert.equal(tricycle.baseDistanceKm, 1);
  assert.equal(tricycle.perKmRate, 2);
  assert.equal(tricycle.minFare, 13);
  assert.equal(tricycle.maxCustomary, 75);
});

test('official fare routes expose all 68 published rows', async () => {
  const { response, body } = await api('/v1/cities/cabadbaran/fare-routes');
  assert.equal(response.status, 200);
  assert.equal(body.cityId, 'cabadbaran');
  assert.equal(body.count, 68);
  assert.equal(body.effectiveFrom, '2026-09-24');
  assert.equal(body.provisional, false);
  assert.equal(body.data.length, 68);
  assert.ok(body.data.every((route) => route.vehicleId === 'tricycle'));

  const first = body.data.find((route) => route.rowNumber === 1);
  assert.equal(first.from, 'Anywhere in Poblacion');
  assert.equal(first.regularFare, 13);
  assert.equal(first.discountedFare, 11);

  const bayabas = body.data.find((route) => route.rowNumber === 4);
  assert.equal(bayabas.from, 'Poblacion or Terminal');
  assert.equal(bayabas.to, 'Bayabas');
  assert.equal(bayabas.regularFare, 50);
  assert.equal(bayabas.discountedFare, 40);
  assert.equal(bayabas.bidirectional, true);

  const searched = await api('/v1/cities/cabadbaran/fare-routes?search=Bayabas');
  assert.equal(searched.status, 200);
  assert.equal(searched.body.count, 1);
  assert.equal(searched.body.data[0].rowNumber, 4);

  const missing = await api('/v1/cities/atlantis/fare-routes');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'CITY_NOT_FOUND');
});

test('the global fare-route alias defaults to the focus city', async () => {
  const { response, body } = await api('/v1/fare/routes?vehicleId=tricycle&search=Bayabas');
  assert.equal(response.status, 200);
  assert.equal(body.cityId, 'cabadbaran');
  assert.equal(body.count, 1);
  assert.equal(body.data[0].rowNumber, 4);
});

test('fare engine matches the Cabadbaran distance formula', async () => {
  const { response, body } = await api('/v1/fare/estimate', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      distanceKm: 3.4,
      passengers: 2,
      pakyaw: false,
      discountCode: 'student',
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(body.fareSource, 'distance_matrix');
  assert.equal(body.fare.exact, 28.48);
  assert.equal(body.fare.min, 28);
  assert.equal(body.fare.max, 33);
  assert.equal(body.breakdown.baseRate, 17.8);
  assert.equal(body.breakdown.seatUnits, 2);
  assert.equal(body.breakdown.subtotal, 35.6);
  assert.equal(body.breakdown.discountAmount, 7.12);
  assert.equal(body.provisional, false);
});

test('a published origin/destination pair wins over the distance formula', async () => {
  const { response, body } = await api('/v1/fare/estimate', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      origin: 'Poblacion',
      destination: 'Bayabas',
      passengers: 1,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(body.fareSource, 'official_matrix');
  assert.equal(body.routeRowNumber, 4);
  assert.equal(body.distanceKmSource, 'derived_from_published_fare');
  assert.equal(body.distanceKm, 19.5);
  assert.equal(body.route.from, 'Poblacion or Terminal');
  assert.equal(body.route.to, 'Bayabas');
  assert.equal(body.route.regularFare, 50);
  assert.equal(body.route.discountedFare, 40);
  assert.equal(body.fare.exact, 50);
  assert.equal(body.fare.min, 50);
  assert.equal(body.fare.max, 50);

  const discounted = await api('/v1/fare/estimate', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      origin: 'Land Transport Terminal',
      destination: 'Sitio Pirada, Del Pilar',
      passengers: 3,
      discountCode: 'student',
    }),
  });
  assert.equal(discounted.status, 200);
  assert.equal(discounted.body.routeRowNumber, 28);
  assert.equal(discounted.body.route.regularFare, 75);
  assert.equal(discounted.body.route.discountedFare, 60);
  assert.equal(discounted.body.fare.exact, 180);
  assert.equal(discounted.body.breakdown.subtotal, 225);
  assert.equal(discounted.body.breakdown.discountAmount, 45);

  const reversed = await api('/v1/fare/estimate', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      origin: 'Bayabas',
      destination: 'Poblacion',
      passengers: 1,
    }),
  });
  assert.equal(reversed.status, 200);
  assert.equal(reversed.body.routeRowNumber, 4);
  assert.equal(reversed.body.route.reversed, true);
  assert.equal(reversed.body.fare.exact, 50);
});

test('an unpublished pair still needs a distance', async () => {
  const { response, body } = await api('/v1/fare/estimate', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      origin: 'Poblacion',
      destination: 'Atlantis',
      passengers: 1,
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(body.error.code, 'DISTANCE_REQUIRED');
});

test('pakyaw uses the policy seat cap', async () => {
  const { response, body } = await api('/v1/fare/estimate', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      distanceKm: 3.4,
      passengers: 1,
      pakyaw: true,
      discountCode: 'student',
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(body.breakdown.seatUnits, 4);
  assert.equal(body.fare.exact, 56.96);
});

test('minimum fare floor is applied', async () => {
  const { response, body } = await api('/v1/fare/estimate', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      distanceKm: 1,
      passengers: 1,
      discountCode: 'none',
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(body.fare.exact, 13);
  assert.equal(body.fare.min, 13);
  assert.equal(body.fare.max, 18);
});

test('estimate rejects unknown vehicles and malformed bodies', async () => {
  const unknown = await api('/v1/fare/estimate', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'hovercraft',
      distanceKm: 2,
    }),
  });
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.body.error.code, 'NOT_FOUND');

  const malformed = await api('/v1/fare/estimate', {
    method: 'POST',
    body: JSON.stringify({ cityId: 'cabadbaran' }),
  });
  assert.equal(malformed.response.status, 400);
  assert.equal(malformed.body.error.code, 'VALIDATION_ERROR');
  assert.ok(malformed.body.error.details.some((issue) => issue.path === 'vehicleId'));
});

test('persisted estimates can be fetched as quotes', async () => {
  const estimate = await api('/v1/fare/estimate', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      origin: 'Poblacion',
      destination: 'Bayabas',
      passengers: 2,
      discountCode: 'none',
      persist: true,
    }),
  });
  assert.equal(estimate.response.status, 200);
  assert.ok(estimate.body.quoteId);
  assert.equal(estimate.body.fareSource, 'official_matrix');
  assert.equal(estimate.body.fare.exact, 100);

  const quote = await api(`/v1/fare/quotes/${estimate.body.quoteId}`);
  assert.equal(quote.response.status, 200);
  assert.equal(quote.body.vehicleId, 'tricycle');
  assert.equal(quote.body.routeRowNumber, 4);
  assert.equal(quote.body.fareSource, 'official_matrix');
  assert.equal(quote.body.fare.exact, estimate.body.fare.exact);
});

test('ML prediction returns a model version and interval', async () => {
  const { response, body } = await api('/v1/fare/predict', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      distanceKm: 3.4,
      passengers: 2,
      discountCode: 'student',
      persist: true,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(body.model.key, 'fare-fair-linear');
  assert.equal(body.model.version, 1);
  assert.ok(body.prediction.fare > 25 && body.prediction.fare < 45);
  assert.ok(body.prediction.lowerBound <= body.prediction.fare);
  assert.ok(body.prediction.upperBound >= body.prediction.fare);
  assert.ok(body.prediction.confidence >= 0 && body.prediction.confidence <= 1);
  assert.ok(body.predictionId);
});

test('model registry lists the trained baseline', async () => {
  const { response, body } = await api('/v1/fare/models');
  assert.equal(response.status, 200);
  assert.ok(body.count >= 1);
  const model = body.data.find((item) => item.modelKey === 'fare-fair-linear');
  assert.ok(model);
  assert.ok(model.activeVersionId);
  const active = model.versions.find((version) => version.isActive);
  assert.equal(active.version, 1);
  assert.ok(active.metrics.train.r2 > 0.9);
});

test('training creates and activates a new model version', async () => {
  const trained = await api('/v1/fare/models/train', {
    method: 'POST',
    body: JSON.stringify({ activate: true, actorName: 'integration-test' }),
  });
  assert.equal(trained.response.status, 201);
  assert.equal(trained.body.version, 2);
  assert.equal(trained.body.status, 'active');
  assert.ok(trained.body.trainingRows > 100);

  const prediction = await api('/v1/fare/predict', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      distanceKm: 3.4,
      passengers: 2,
      discountCode: 'student',
    }),
  });
  assert.equal(prediction.response.status, 200);
  assert.equal(prediction.body.model.version, 2);
});

test('trips can be filtered and paginated', async () => {
  const all = await api('/v1/trips?limit=10');
  assert.equal(all.response.status, 200);
  assert.equal(all.body.data.length, 10);
  assert.ok(all.body.pagination.total > 100);
  assert.equal(all.body.pagination.hasMore, true);

  const cabadbaran = await api('/v1/trips?cityId=cabadbaran&limit=5');
  assert.equal(cabadbaran.response.status, 200);
  assert.ok(cabadbaran.body.data.every((trip) => trip.cityId === 'cabadbaran'));

  const flagged = await api('/v1/trips?status=flagged&limit=5');
  assert.ok(flagged.body.data.every((trip) => trip.status === 'flagged'));
});

test('live-recorded trips carry GPS breadcrumbs', async () => {
  const list = await api('/v1/trips?recordedVia=live_trip_recording&limit=10');
  assert.equal(list.response.status, 200);
  assert.ok(list.body.data.length > 0);

  let detail = null;
  for (const trip of list.body.data) {
    const candidate = await api(`/v1/trips/${trip.id}`);
    if (candidate.body.points.length > 0) {
      detail = candidate.body;
      break;
    }
  }
  assert.ok(detail, 'expected at least one live trip with GPS points');
  assert.ok(detail.points.length >= 2);
  assert.equal(typeof detail.points[0].lat, 'number');
  assert.equal(typeof detail.points[0].lng, 'number');
});

test('a trip detail includes its quote and prediction', async () => {
  const predictions = await api('/v1/fare/predictions?limit=100');
  assert.equal(predictions.response.status, 200);
  assert.ok(predictions.body.data.length > 0);
  const withTrip = predictions.body.data.find((prediction) => prediction.tripId);
  assert.ok(withTrip, 'expected a prediction linked to a seeded trip');
  const detail = await api(`/v1/trips/${withTrip.tripId}`);
  assert.equal(detail.response.status, 200);
  assert.ok(detail.body.quotes.length >= 1);
  assert.ok(detail.body.predictions.length >= 1);
});

test('recording a trip prices an official route server-side', async () => {
  const created = await api('/v1/trips', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      origin: 'Poblacion',
      destination: 'Bayabas',
      durationSeconds: 780,
      passengers: 2,
      discountCode: 'none',
      recordedVia: 'live_trip_recording',
      routePoints: [
        { lat: 9.1157, lng: 125.5427 },
        { lat: 9.1171, lng: 125.5443 },
        { lat: 9.1143, lng: 125.5495 },
      ],
      runPrediction: true,
    }),
  });
  assert.equal(created.response.status, 201);
  assert.match(created.body.reference, /^FF-\d+$/);
  assert.equal(created.body.fareSource, 'official_matrix');
  assert.equal(created.body.routeRowNumber, 4);
  assert.equal(created.body.distanceKm, 19.5);
  assert.equal(created.body.fare.exact, 100);
  assert.equal(created.body.points.length, 3);
  assert.equal(created.body.quotes.length, 1);
  assert.equal(created.body.quotes[0].fareSource, 'official_matrix');
  assert.equal(created.body.predictions.length, 1);
  assert.ok(created.body.createdPrediction);

  const fetched = await api(`/v1/trips/${created.body.id}`);
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.body.reference, created.body.reference);
});

test('recording an unpublished pair still rejects a missing distance', async () => {
  const { status, body } = await api('/v1/trips', {
    method: 'POST',
    body: JSON.stringify({
      cityId: 'cabadbaran',
      vehicleId: 'tricycle',
      origin: 'Poblacion',
      destination: 'Atlantis',
      passengers: 1,
    }),
  });
  assert.equal(status, 400);
  assert.equal(body.error.code, 'DISTANCE_REQUIRED');
});

test('trip status changes open an anomaly and write an audit event', async () => {
  const list = await api('/v1/trips?status=completed&limit=1');
  const trip = list.body.data[0];

  const patched = await api(`/v1/trips/${trip.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'flagged',
      flagReason: 'Integration test flag',
      severity: 'high',
      actorName: 'integration-test',
    }),
  });
  assert.equal(patched.response.status, 200);
  assert.equal(patched.body.status, 'flagged');
  assert.equal(patched.body.flagReason, 'Integration test flag');
  assert.ok(
    patched.body.anomalies.some((anomaly) => anomaly.kind === 'manual_flag'),
  );

  const audit = await api('/v1/audit?action=trip.status_changed&limit=10');
  assert.equal(audit.response.status, 200);
  assert.ok(audit.body.data.length >= 1);
});

test('analytics overview aggregates the Cabadbaran dataset', async () => {
  const { response, body } = await api('/v1/analytics/overview?days=30');
  assert.equal(response.status, 200);
  assert.ok(body.totals.trips > 100);
  assert.ok(body.totals.avgFare > 0);
  assert.ok(body.daily.length > 5);
  assert.equal(body.byVehicle.length, 1);
  assert.equal(body.byVehicle[0].vehicleId, 'tricycle');
  assert.ok(body.byStatus.length >= 2);
  assert.ok(body.topRoutes.length > 0);
});

test('fare analytics compares the matrix with observed fares', async () => {
  const global = await api('/v1/analytics/fares?days=30');
  assert.equal(global.response.status, 200);
  assert.equal(global.body.count, 1);

  const city = await api('/v1/analytics/fares?cityId=cabadbaran&days=30');
  assert.equal(city.response.status, 200);
  assert.equal(city.body.count, 1);
  assert.ok(city.body.data.every((row) => row.cityId === 'cabadbaran'));
  assert.equal(city.body.data[0].vehicleId, 'tricycle');
});

test('ordinances are searchable by vehicle applicability', async () => {
  const all = await api('/v1/ordinances');
  assert.equal(all.response.status, 200);
  assert.equal(all.body.count, 1);
  assert.equal(all.body.data[0].vehicleIds[0], 'tricycle');

  const tricycle = await api('/v1/ordinances?vehicleId=tricycle');
  assert.equal(tricycle.response.status, 200);
  assert.equal(tricycle.body.count, 1);
  assert.ok(tricycle.body.data.every((row) => row.vehicleIds.includes('tricycle')));

  const puj = await api('/v1/ordinances?vehicleId=modern-puj');
  assert.equal(puj.response.status, 200);
  assert.equal(puj.body.count, 0);

  const slug = tricycle.body.data[0].slug;
  const detail = await api(`/v1/ordinances/${slug}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.slug, slug);
});

test('anomalies can be listed and resolved', async () => {
  const open = await api('/v1/anomalies?resolved=false&limit=5');
  assert.equal(open.response.status, 200);
  assert.ok(open.body.pagination.total > 0);
  const anomaly = open.body.data[0];

  const resolved = await api(`/v1/anomalies/${anomaly.id}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify({ resolutionNote: 'Verified by integration test' }),
  });
  assert.equal(resolved.response.status, 200);
  assert.ok(resolved.body.resolvedAt);
  assert.equal(resolved.body.resolutionNote, 'Verified by integration test');
});

test('audit trail exposes seeded and API actions', async () => {
  const { response, body } = await api('/v1/audit?limit=50');
  assert.equal(response.status, 200);
  assert.ok(body.pagination.total >= 4);
  assert.ok(body.data.some((entry) => entry.action === 'dataset.seeded'));
  assert.ok(body.data.some((entry) => entry.action === 'ml_model.trained'));
});

test('CSV export streams trip rows', async () => {
  const { response, text } = await api('/v1/trips.csv?cityId=cabadbaran');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(text, /^Trip ID,Reference,Timestamp/);
  assert.match(text, /FF-\d+/);
});

test('OpenAPI spec and docs are served', async () => {
  const spec = await api('/openapi.json');
  assert.equal(spec.response.status, 200);
  assert.equal(spec.body.openapi, '3.1.0');
  assert.ok(spec.body.paths['/v1/fare/estimate']);

  const docs = await api('/docs');
  assert.equal(docs.response.status, 200);
  assert.match(docs.text, /SwaggerUIBundle/);
});

test('unknown routes return a structured 404', async () => {
  const { response, body } = await api('/v1/does-not-exist');
  assert.equal(response.status, 404);
  assert.equal(body.error.code, 'NOT_FOUND');
});

test('blank optional fields fall back to defaults instead of failing', async () => {
  const trips = await api(
    '/v1/trips?cityId=&vehicleId=&status=&discountCode=&recordedVia=&from=&to=&search=&limit=&offset=',
  );
  assert.equal(trips.status, 200);
  assert.ok(trips.body.data.length > 0);
  assert.equal(trips.body.pagination.limit, 50);
  assert.equal(trips.body.pagination.offset, 0);

  const overview = await api('/v1/analytics/overview?cityId=&days=');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.range.days, 30);
  assert.equal(overview.body.range.cityId, null);

  const cities = await api('/v1/cities?status=&provisional=');
  assert.equal(cities.status, 200);
  assert.equal(cities.body.count, 1);
});

test('empty filters return 200 with a valid empty payload', async () => {
  const trips = await api('/v1/trips?cityId=not-a-city&search=ZZZZZZ');
  assert.equal(trips.status, 200);
  assert.deepEqual(trips.body.data, []);
  assert.equal(trips.body.pagination.total, 0);
  assert.equal(trips.body.pagination.hasMore, false);

  const anomalies = await api('/v1/anomalies?cityId=not-a-city');
  assert.equal(anomalies.status, 200);
  assert.deepEqual(anomalies.body.data, []);
  assert.equal(anomalies.body.pagination.total, 0);
  assert.equal(anomalies.body.pagination.hasMore, false);

  const audit = await api('/v1/audit?cityId=not-a-city');
  assert.equal(audit.status, 200);
  assert.deepEqual(audit.body.data, []);
  assert.equal(audit.body.pagination.hasMore, false);

  const overview = await api('/v1/analytics/overview?cityId=not-a-city');
  assert.equal(overview.status, 200);
  assert.equal(overview.body.totals.trips, 0);
  assert.equal(overview.body.totals.avgFare, 0);
  assert.deepEqual(overview.body.byVehicle, []);

  const fares = await api('/v1/analytics/fares?cityId=not-a-city');
  assert.equal(fares.status, 200);
  assert.equal(fares.body.count, 0);
  assert.deepEqual(fares.body.data, []);

  const cities = await api('/v1/cities?status=retired');
  assert.equal(cities.status, 200);
  assert.equal(cities.body.count, 0);
  assert.deepEqual(cities.body.data, []);

  const csv = await api('/v1/trips.csv?cityId=not-a-city');
  assert.equal(csv.status, 200);
  assert.equal(csv.text.trim().split(/\r?\n/).length, 1);
});

test('trip list items expose every serialized field', async () => {
  const { status, body } = await api('/v1/trips?limit=1');
  assert.equal(status, 200);
  assert.equal(body.data.length, 1);
  const trip = body.data[0];
  for (const key of [
    'id',
    'reference',
    'cityId',
    'cityName',
    'cityRegion',
    'vehicleId',
    'vehicleName',
    'vehicleCategory',
    'origin',
    'destination',
    'distanceKm',
    'durationSeconds',
    'durationMinutes',
    'passengers',
    'pakyaw',
    'discountCode',
    'discountLabel',
    'fare',
    'fareSource',
    'routeRowNumber',
    'status',
    'flagReason',
    'recordedVia',
    'recordedAt',
    'createdAt',
    'matrixVersionId',
    'policyVersionId',
    'openAnomalies',
  ]) {
    assert.ok(Object.hasOwn(trip, key), `missing ${key}`);
  }
  assert.equal(trip.fare.currency, 'PHP');
  assert.equal(typeof trip.fare.exact, 'number');
});

test('optional request bodies fall back to defaults', async () => {
  const model = await api('/v1/fare/models/fare-fair-linear');
  assert.equal(model.status, 200);
  const activated = await api(
    `/v1/fare/models/versions/${model.body.activeVersionId}/activate`,
    { method: 'POST' },
  );
  assert.equal(activated.status, 200);
  assert.equal(activated.body.isActive, true);

  const open = await api('/v1/anomalies?resolved=false&limit=1');
  assert.equal(open.status, 200);
  const resolved = await api(`/v1/anomalies/${open.body.data[0].id}/resolve`, {
    method: 'PATCH',
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.resolutionNote, 'Resolved via API');
});

test('invalid IDs, enum values and malformed JSON return 400', async () => {
  const badId = await api('/v1/trips/not-a-uuid');
  assert.equal(badId.status, 400);
  assert.equal(badId.body.error.code, 'INVALID_ID');

  const badStatus = await api('/v1/trips?status=hovering');
  assert.equal(badStatus.status, 400);
  assert.equal(badStatus.body.error.code, 'VALIDATION_ERROR');

  const badJson = await api('/v1/fare/estimate', {
    method: 'POST',
    body: '{"cityId":',
  });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error.code, 'INVALID_JSON');
});
