/**
 * Live API status check.
 *
 * Calls the running API (default http://localhost:4000), prints the ACTUAL
 * HTTP status returned by each request, and exits non-zero on a mismatch.
 *
 * Usage:
 *   npm run api:status
 *   API_BASE=http://localhost:4000 npm run api:status
 *
 * Note: this exercises the write endpoints too, so it creates one trip and
 * flags it. Run `npm run db:reset` afterwards if you want a pristine seed.
 */

const base = process.env.API_BASE ?? 'http://localhost:4000';
const results = [];
let failures = 0;

function compact(value, max = 58) {
  if (value === undefined || value === null || value === '') return '-';
  const text =
    typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function call({ name, method = 'GET', path, query, body, expect = 200 }) {
  const url = new URL(path, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const input = body ?? query ?? {};
  let status = 'ERR';
  let payload;
  let error;

  try {
    const response = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    status = response.status;
    const text = await response.text();
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  } catch (cause) {
    error = cause.message;
  }

  const ok = status === expect;
  if (!ok) failures += 1;

  results.push({
    name,
    method,
    path: `${url.pathname}${url.search}`,
    input: compact(input),
    expect,
    status,
    ok,
    payload,
    error,
  });

  return { status, payload, ok };
}

const estimateBody = {
  cityId: 'cabadbaran',
  vehicleId: 'tricycle',
  distanceKm: 4.2,
  passengers: 2,
  pakyaw: false,
  discountCode: 'none',
  persist: true,
};

const tripBody = {
  cityId: 'cabadbaran',
  vehicleId: 'tricycle',
  origin: 'Commercial Center',
  destination: 'Barangay Luna',
  distanceKm: 4.2,
  durationSeconds: 900,
  passengers: 2,
  pakyaw: false,
  discountCode: 'none',
  recordedVia: 'live_trip_recording',
  routePoints: [
    { lat: 9.1157, lng: 125.5345 },
    { lat: 9.1201, lng: 125.5402 },
  ],
  runPrediction: true,
};

// 1. Health + a read-only trips list.
await call({
  name: 'Health',
  path: '/health',
});
await call({
  name: 'Trips page (option 1)',
  path: '/v1/trips',
  query: { limit: 50, offset: 0 },
});
await call({
  name: 'Trips, all filters',
  path: '/v1/trips',
  query: {
    cityId: 'cabadbaran',
    vehicleId: 'tricycle',
    status: 'completed',
    discountCode: 'none',
    recordedVia: 'live_trip_recording',
    from: '2020-01-01T00:00:00Z',
    to: '2030-12-31T23:59:59Z',
    search: 'FF-',
    limit: 50,
    offset: 0,
  },
});

// 2. Estimate -> quote.
const estimate = await call({
  name: 'Create estimate',
  method: 'POST',
  path: '/v1/fare/estimate',
  body: estimateBody,
  expect: 200,
});
const quoteId = estimate.payload?.quoteId;

if (quoteId) {
  await call({
    name: 'Fetch quote',
    path: `/v1/fare/quotes/${quoteId}`,
  });
}

// 3. Create a trip -> read it -> flag it -> read it again.
const created = await call({
  name: 'Record trip',
  method: 'POST',
  path: '/v1/trips',
  body: tripBody,
  expect: 201,
});
const tripId = created.payload?.id;

if (tripId) {
  await call({
    name: 'Trip detail',
    path: `/v1/trips/${tripId}`,
  });
  await call({
    name: 'Flag trip',
    method: 'PATCH',
    path: `/v1/trips/${tripId}/status`,
    body: {
      status: 'flagged',
      flagReason: 'Live status check',
      severity: 'low',
      actorName: 'api-status',
    },
    expect: 200,
  });
  await call({
    name: 'Trip detail after flag',
    path: `/v1/trips/${tripId}`,
  });
}

// 4. CSV + analytics + anomalies + audit.
await call({
  name: 'Trips CSV',
  path: '/v1/trips.csv',
  query: { cityId: 'cabadbaran' },
});
await call({
  name: 'Analytics overview',
  path: '/v1/analytics/overview',
  query: { days: 30 },
});
await call({
  name: 'Fare analytics',
  path: '/v1/analytics/fares',
  query: { cityId: 'cabadbaran', days: 30 },
});
await call({
  name: 'Open anomalies',
  path: '/v1/anomalies',
  query: { resolved: false, limit: 5 },
});
await call({
  name: 'Audit trail',
  path: '/v1/audit',
  query: { limit: 10 },
});

// 5. Docs.
await call({ name: 'OpenAPI spec', path: '/openapi.json' });
await call({ name: 'Swagger UI', path: '/docs' });

// --- report ---------------------------------------------------------------
const headers = ['#', 'ENDPOINT', 'INPUT', 'EXPECT', 'ACTUAL', 'RESULT'];
const rows = results.map((result, index) => [
  String(index + 1),
  `${result.method} ${result.path}`,
  result.input,
  String(result.expect),
  String(result.status),
  result.ok ? 'PASS' : 'FAIL',
]);

const widths = headers.map((header, column) =>
  Math.max(
    header.length,
    ...rows.map((row) => row[column].length),
  ),
);

const line = (cells) =>
  cells
    .map((cell, column) => cell.padEnd(widths[column]))
    .join('  ')
    .trimEnd();

console.log(`\nLive API status check — ${base}\n`);
console.log(line(headers));
console.log(line(widths.map((width) => '-'.repeat(width))));
for (const row of rows) console.log(line(row));

const failed = results.filter((result) => !result.ok);
if (failed.length) {
  console.log(`\n${failed.length} request(s) did not return the expected status:`);
  for (const result of failed) {
    console.log(
      `- ${result.method} ${result.path} -> ${result.status} (expected ${result.expect})${result.error ? `: ${result.error}` : ''}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(`\nAll ${results.length} requests returned their actual expected status.`);
}
