# FareFair Backend — PostgreSQL + REST API

A standalone PostgreSQL database, seed pipeline, fare engine, ML model registry and REST API
for FareFair, plus the admin web console at `/admin/`. The console, the API and PostgreSQL are
wired end to end: the console reads city data, official fare routes, trips and the audit trail
from `/v1` and writes fare edits straight into the database. **The Flutter app is still not wired
to this backend** — it keeps reading its bundled JSON datasets. This backend is the server-side
source of truth the app can move to later.

The admin console itself lives in the FareFair app's `web/admin` folder. When this backend is
checked out inside that project, `src/app.js` serves it at `/admin/`; a standalone API-only
checkout simply skips that static route.

The seeded catalog is **Cabadbaran City only**. It ships the official 68-row tricycle fare matrix
effective 24 September 2026 as a checked-in dataset, so the API, the console and the database all
expose the same published fares.

The schema targets **PostgreSQL 15+**. For zero-setup development and tests it runs on
**PGlite**, the official PostgreSQL 17 build compiled to WASM, using the exact same SQL.

> **IT 110 Activity 10 evidence:** the health check, 40-feature endpoint inventory and
> tested responses are in [`docs/evidence/`](docs/evidence/README.md), including the
> filled report `FastAPI_Evidence_Report_40.docx`.
>
> **IT 108 Activity 7 security evidence:** roles, GRANT/REVOKE tests, the RLS
> decision and the SQL-injection review are in [`docs/SECURITY.md`](docs/SECURITY.md).

---

## Quick start (zero setup)

Requires Node 20+.

```bash
cd backend
npm install
npm run db:reset     # create schema + seed Cabadbaran from the official dataset
npm start            # http://localhost:4000
```

Open <http://localhost:4000/admin/> for the admin console, <http://localhost:4000/docs> for
Swagger UI, or <http://localhost:4000/health>.

The console is served by the API itself, so its fetches are same-origin and write endpoints run
exactly as deployed. Sign in with a seeded account (password `farefair` for all three unless `SEED_DEMO_PASSWORD` was set before `npm run db:reset`):

| Login | Role | City scope |
| --- | --- | --- |
| `admin@farefair.local` | `admin` → console super admin | all seeded cities (Cabadbaran) |
| `lgu@farefair.local` | `lgu_editor` → console city admin | `cabadbaran` only |
| `analyst@farefair.local` | `analyst` | read-only, Cabadbaran |

By default PGlite persists to `backend/.pglite` (gitignored), so seeded data survives restarts.
`npm run db:reset` is idempotent: it drops/recreates only the `farefair` schema and re-seeds.
Stop a running API with Ctrl+C before resetting, because PGlite holds a lock on its data
directory. A hard kill (for example `Stop-Process -Force`) can leave that directory unopenable —
PGlite then aborts on startup. Recover by renaming `backend/.pglite` and running
`npm run db:reset` again; the seed pipeline rebuilds everything.

### Real PostgreSQL

```bash
cd backend
docker compose up -d
cp .env.example .env
# edit .env:
#   DB_DRIVER=pg
#   DATABASE_URL=postgres://farefair:your-local-password@localhost:5432/farefair
npm run db:reset:pg
npm start
```

The API creates and uses a dedicated `farefair` schema; it never drops `public`.

### pgAdmin (single SQL file)

`db/farefair_pgadmin.sql` is a self-contained script that creates every table, view, function,
trigger and foreign key in the ERD inside the `farefair` schema. It is generated from
`db/001_schema.sql`, so the two never drift:

```bash
npm run db:sql     # regenerate db/farefair_pgadmin.sql from db/001_schema.sql
```

To use it:

1. In pgAdmin 4, connect to the target database and open **Tools → Query Tool**.
2. Open `db/farefair_pgadmin.sql` and press **F5**.
3. Refresh **Schemas → farefair** to see the 22 tables and 6 views.
4. For the diagram, right-click the database → **ERD for Database** (or open
   **Tools → ERD Tool**) and add the `farefair` tables.

The script starts with `DROP SCHEMA IF EXISTS farefair CASCADE`, so it is safe to re-run:
it only replaces the `farefair` schema and never touches `public`. It ends with a self-check
that raises an error if any ERD table or view is missing. It creates the schema only, not seed
rows; use `npm run db:reset:pg` when you want the sample data as well.

---

## API surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness + database check |
| `GET` | `/v1/meta` | API metadata, focus city, row counts, endpoint index |
| `GET` | `/v1/cities` | City catalog (focus city first) |
| `GET` | `/v1/cities/:cityId` | Full city dataset: policy, matrix, ordinances, corridor |
| `GET` | `/v1/cities/:cityId/fare-policy` | Active policy (+ optional history) |
| `GET` | `/v1/cities/:cityId/fare-matrix` | Active or versioned per-kilometre fare matrix |
| `GET` | `/v1/cities/:cityId/fare-routes` | Official point-to-point fare rows (68 for Cabadbaran) |
| `GET` | `/v1/fare/routes` | City-scoped alias; defaults to the focus city |
| `GET` | `/v1/vehicles` | Global vehicle catalog |
| `GET` | `/v1/vehicles/:vehicleId` | Vehicle detail + per-city tariffs |
| `GET` | `/v1/ordinances` | Ordinances filtered by city, status or vehicle |
| `GET` | `/v1/ordinances/:slug` | Ordinance detail |
| `POST` | `/v1/fare/estimate` | Fare engine: published route first, distance formula fallback |
| `GET` | `/v1/fare/quotes/:quoteId` | Persisted quote |
| `POST` | `/v1/fare/predict` | Prediction from the active ML model |
| `GET` | `/v1/fare/predictions` | Prediction history |
| `GET` | `/v1/fare/models` | Model registry with all versions |
| `POST` | `/v1/fare/models/train` | Train a new model version from trip history |
| `GET` | `/v1/fare/models/:idOrKey` | Model detail |
| `GET` | `/v1/fare/models/versions/:versionId` | Version detail + prediction stats |
| `POST` | `/v1/fare/models/versions/:versionId/activate` | Activate a model version |
| `GET` | `/v1/trips` | Filtered, paginated trip records |
| `POST` | `/v1/trips` | Record a trip (fare computed server-side) |
| `GET` | `/v1/trips/:tripId` | Trip + GPS points + quote + predictions + anomalies |
| `PATCH` | `/v1/trips/:tripId/status` | Flag/dispute/complete a trip |
| `GET` | `/v1/trips.csv` | CSV export |
| `GET` | `/v1/analytics/overview` | Totals, daily series, vehicle/discount/status mix, top routes |
| `GET` | `/v1/analytics/fares` | Matrix vs observed fares per city/vehicle |
| `GET` | `/v1/anomalies` | Fare anomalies (open/resolved) |
| `PATCH` | `/v1/anomalies/:anomalyId/resolve` | Resolve an anomaly |
| `GET` | `/v1/audit` | Audit trail |
| `POST` | `/v1/auth/login` | Sign in; issues an 8-hour bearer token |
| `GET` | `/v1/auth/me` | Resolve the signed-in account |
| `POST` | `/v1/auth/logout` | Revoke the current session |
| `GET` | `/v1/auth/accounts` | Admin accounts (administrators only) |
| `PATCH` | `/v1/admin/cities/:cityId/fare-matrix/:vehicleId` | Update a vehicle tariff |
| `PUT` | `/v1/admin/cities/:cityId/fare-matrix/:vehicleId` | Idempotent full tariff replacement |
| `PUT` | `/v1/admin/cities/:cityId/fare-routes/:rowNumber` | Replace one published fare row |
| `POST` | `/v1/admin/cities/:cityId/activate` | Move the live (`is_focus`) city |
| `POST` | `/v1/admin/audit` | Append a console event |
| `GET` | `/admin/` | Admin web console (same origin) |
| `GET` | `/openapi.json` | OpenAPI 3.1 spec |
| `GET` | `/docs` | Swagger UI |

Reads stay public so the existing app/Swagger contract keeps working. Every `/v1/admin/*` and
`/v1/auth/accounts` call requires `Authorization: Bearer <token>`, and each write is recorded in
`audit_events` by the API rather than by the browser.

### Synthetic API inputs

Every operation has a success-path input fixture from `GET /health` through analytics:

| File | Purpose |
| --- | --- |
| `docs/api-inputs.json` | Machine-readable inputs: path params, query, body and expected status |
| `docs/api-inputs.resolved.json` | Last execution: resolved dynamic IDs and actual status codes |
| `docs/API_INPUTS.md` | Human-readable field-by-field table for every operation |
| `docs/openapi.json` | Swagger examples generated from the fixture |

```bash
npm run api:inputs      # execute all 42 operations against the running API
npm run docs:examples   # apply the latest values to Swagger
npm run docs:inputs     # regenerate the Markdown input table
```

Dynamic values (`tripId`, `quoteId`, `versionId`, `anomalyId`) are resolved from earlier
responses, so the matrix still works after `npm run db:reset`. The matrix also signs in with
`admin@farefair.local`, reuses that bearer token for the `/v1/auth/*` and `/v1/admin/*`
operations, and signs out at the end. Create operations return `201`
(`POST /v1/trips`, `POST /v1/fare/models/train`, `POST /v1/admin/audit`); every other
documented operation returns `200`.

### Response contract

- **Blank optional inputs are ignored.** Empty query values (`?cityId=&search=&limit=`)
  and empty request bodies fall back to the documented defaults, so the call still
  returns `200`/`201`.
- **Empty results still succeed.** Filters that match nothing return `200` with
  `data: []` and zeroed counts/pagination; analytics returns zeroed totals rather
  than `404`.
- **Every documented field is present.** Unknown values are serialized as `null`
  (for example an open-ended `effectiveTo` or an unverified date) instead of being
  omitted.
- **Only invalid input fails.** Unknown enum values, malformed UUIDs, malformed JSON
  and out-of-range numbers return `400` (`VALIDATION_ERROR`, `INVALID_ID` or
  `INVALID_JSON`); bodies above 2 MB return `413`.
- **Swagger mirrors real responses.** `npm run docs:examples` copies the response
  sample captured by the last `npm run api:inputs` run into the `200`/`201` schema
  and example of every operation.

### Examples

```bash
# Official published fare: Poblacion → Bayabas, 2 passengers, no discount
curl -s -X POST http://localhost:4000/v1/fare/estimate \
  -H "content-type: application/json" \
  -d '{"cityId":"cabadbaran","vehicleId":"tricycle","origin":"Poblacion","destination":"Bayabas","passengers":2}'
```

```json
{
  "origin": "Poblacion",
  "destination": "Bayabas",
  "distanceKm": 19.5,
  "distanceKmSource": "derived_from_published_fare",
  "fareSource": "official_matrix",
  "routeRowNumber": 4,
  "route": {
    "rowNumber": 4, "from": "Poblacion or Terminal", "to": "Bayabas",
    "regularFare": 50, "discountedFare": 40, "reversed": false
  },
  "fare": { "currency": "PHP", "exact": 100, "min": 100, "max": 100 },
  "provisional": false
}
```

```bash
# Distance fallback for a pair outside the published table: 3.4 km, 2 passengers, student
curl -s -X POST http://localhost:4000/v1/fare/estimate \
  -H "content-type: application/json" \
  -d '{"cityId":"cabadbaran","vehicleId":"tricycle","distanceKm":3.4,"passengers":2,"discountCode":"student"}'
```

```json
{
  "fareSource": "distance_matrix",
  "fare": { "currency": "PHP", "exact": 28.48, "min": 28, "max": 33 },
  "breakdown": {
    "baseFare": 13, "baseDistanceKm": 1, "perKmRate": 2,
    "distanceComponent": 4.8, "baseRate": 17.8,
    "seatUnits": 2, "subtotal": 35.6,
    "discountRate": 0.2, "discountAmount": 7.12
  },
  "provisional": false
}
```

```bash
# ML prediction
curl -s -X POST http://localhost:4000/v1/fare/predict \
  -H "content-type: application/json" \
  -d '{"cityId":"cabadbaran","vehicleId":"tricycle","distanceKm":3.4,"passengers":2,"discountCode":"student"}'

# Record a trip on an official route; the distance is derived from the published fare
curl -s -X POST http://localhost:4000/v1/trips \
  -H "content-type: application/json" \
  -d '{
    "cityId":"cabadbaran","vehicleId":"tricycle",
    "origin":"Poblacion","destination":"Bayabas",
    "durationSeconds":780,"passengers":2,
    "recordedVia":"live_trip_recording",
    "routePoints":[{"lat":9.1157,"lng":125.5427},{"lat":9.1171,"lng":125.5443}]
  }'

# Retrain + activate a new model version
curl -s -X POST http://localhost:4000/v1/fare/models/train \
  -H "content-type: application/json" \
  -d '{"activate":true}'
```

---

## Entities

### City / regulatory catalog

| Table | What it holds |
| --- | --- |
| `cities` | Identity, province/region, centre coordinates, focus flag, status |
| `city_provenance` | `provisional`, source, last verified date, verifier |
| `vehicle_types` | Global vehicle catalog (tricycle, habal-habal, jeepney, …) and compiled defaults |
| `discount_programs` | Student / senior / PWD statutory discounts + legal basis |
| `ordinances` | Ordinance number, title, status, dates, rate summary, discount terms |
| `ordinance_vehicle_applicability` | Many-to-many ordinance ↔ vehicle type |
| `fare_policy_versions` | Versioned discount rate, customary leeway, passenger bounds, pakyaw seat cap |
| `fare_matrix_versions` | Versioned per-city matrix (draft/active/retired), provenance, effective dates |
| `fare_matrix_entries` | Per-kilometre fallback: base fare, covered distance, per-km rate, minimum, customary cap, capacity per vehicle |
| `fare_matrix_routes` | Official per-passenger point-to-point rows (origin, destination, via, regular/discounted fare, remark) |
| `fare_place_aliases` | Place-name aliases used by `fn_lookup_fare_route` to match official labels |
| `city_demo_routes` | Showcase origin/destination/distance |
| `city_corridor_points` | Ordered GPS corridor for the simulator |

Exactly **one active fare policy** and **one active fare matrix** are allowed per city
(partial unique indexes). Historical versions are retained, so old trips keep pointing at
the rates that produced them.

### Trips / quotes / anomalies

| Table | What it holds |
| --- | --- |
| `trips` | Reference (`FF-4820`), city, vehicle, matrix/policy version, distance, duration, passengers, pakyaw, discount, exact/min/max fare, status, GPS summary |
| `trip_points` | Ordered WGS84 breadcrumbs with timestamps |
| `fare_quotes` | Every persisted estimate, linked to trip and versions |
| `fare_anomalies` | Flags (above customary cap, GPS gap, speed outlier, manual flag), severity, resolution |

### Machine learning

| Table | What it holds |
| --- | --- |
| `ml_models` | Registry entry (`fare-fair-linear`), task, target, description |
| `ml_model_versions` | Immutable version: algorithm, feature names, coefficients JSONB, hyperparameters, metrics JSONB, residual σ, checksum, status |
| `ml_training_samples` | Feature store derived from trips, split `train` / `validation` / `test` |
| `ml_predictions` | Prediction, interval, confidence, latency, model version, linked trip/quote |

### Identity / audit

| Table | What it holds |
| --- | --- |
| `admin_users` | Role (`viewer`, `analyst`, `admin`, `lgu_editor`), scrypt password hash, `city_scope` array |
| `admin_sessions` | Opaque session-token hashes with expiry/revocation |
| `audit_events` | Actor, role, action, entity, city, JSONB detail |

Authentication runs on the server:

- `POST /v1/auth/login` looks the account up by full email or by the part before `@`, verifies the
  password against `admin_users.password_hash` (`scrypt$<salt>$<hex>`) with `timingSafeEqual`, and
  issues a random `ff_…` token. Only its SHA-256 digest is stored in `admin_sessions`, with an
  8-hour expiry.
- Five consecutive failures on one login lock it for 15 minutes (`429 TOO_MANY_ATTEMPTS`). Unknown
  accounts take the same time as a wrong password and always return `401 INVALID_CREDENTIALS`.
- `city_scope TEXT[]` bounds `lgu_editor` accounts; an empty array means every city.
- Console roles map onto database roles: `admin` → `super_admin`, `lgu_editor` → `city_admin`,
  `analyst` → `analyst`.
- Fare edits require `admin`/`lgu_editor` with the city in scope, city activation requires `admin`.
  Both write an audit row in the same request; the console's other events are appended through
  `POST /v1/admin/audit`. The audit trail is append-only — the console cannot clear it in API mode.

### Views

`v_city_catalog`, `v_active_fare_matrix`, `v_official_fare_routes`, `v_ordinance_catalog`,
`v_trip_enriched`, `v_fare_compliance`, `v_model_leaderboard`.

### Relationship sketch

```mermaid
erDiagram
  cities ||--|| city_provenance : has
  cities ||--o{ fare_policy_versions : versions
  cities ||--o{ fare_matrix_versions : versions
  cities ||--o{ ordinances : publishes
  cities ||--o{ city_demo_routes : demos
  cities ||--o{ city_corridor_points : corridor
  fare_policy_versions ||--o{ fare_matrix_versions : governs
  fare_matrix_versions ||--o{ fare_matrix_entries : contains
  fare_matrix_versions ||--o{ fare_matrix_routes : publishes
  fare_matrix_routes ||--o{ fare_place_aliases : resolves
  vehicle_types ||--o{ fare_matrix_entries : priced_by
  vehicle_types ||--o{ ordinance_vehicle_applicability : applies_to
  ordinances ||--o{ ordinance_vehicle_applicability : covers
  cities ||--o{ trips : records
  vehicle_types ||--o{ trips : uses
  fare_matrix_versions ||--o{ trips : priced_by
  fare_policy_versions ||--o{ trips : discounted_by
  trips ||--o{ trip_points : breadcrumbs
  trips ||--o{ fare_quotes : quotes
  trips ||--o{ fare_anomalies : flags
  trips ||--o{ ml_training_samples : features
  ml_models ||--o{ ml_model_versions : versions
  ml_model_versions ||--o{ ml_predictions : produces
  ml_model_versions ||--o{ fare_quotes : model_ref
  admin_users ||--o{ audit_events : acts
```

---

## Fare engine

**Published fares win.** `fn_lookup_fare_route(city, vehicle, origin, destination)` resolves the
official point-to-point row, including the `"Poblacion or Terminal"` rows, reverse trips, and place
aliases. When it matches, the exact fare is the published per-passenger fare (or the published
discounted fare) × seat units, and `fare_min = fare_max = exact`. The distance shown for that trip
is derived from the published fare:

```text
distanceKm = baseDistanceKm + (regularFare − baseFare) / perKmRate
```

Trips and quotes record `fare_source = 'official_matrix'` and the matched `route_row_number`.
`POST /v1/trips` accepts an official pair without `distanceKm`; an unpublished pair still requires
one (`400 DISTANCE_REQUIRED`).

`fn_calculate_fare(city, vehicle, distanceKm, passengers, pakyaw, discountCode)` is the fallback
for places outside the published table and mirrors `TripState.calculateFareRange` in the Flutter
app:

```text
billableKm   = max(0, distanceKm - baseDistanceKm)
baseRate     = baseFare + billableKm × perKmRate
seatUnits    = pakyaw ? min(typicalCapacity, pakyawSeatCap) : passengers
subtotal     = baseRate × seatUnits
discountRate = discountCode == "none" ? 0 : policy.discountRate
exact        = subtotal × (1 - discountRate)
fareMin      = max(round(exact × customaryLeewayMin), minFare)
fareMax      = max(round(exact × customaryLeewayMax), fareMin + 5)
```

`POST /v1/trips` and seeded trips use the published row first and the same SQL function as the
fallback, so stored fares, quotes, training labels and API estimates cannot drift.

---

## Machine learning model

**Model key:** `fare-fair-linear` — ridge linear regression over engineered fare features.

The feature set is deliberately chosen so the statutory formula is representable as a linear
combination (plus noise), which makes the model interpretable:

```text
distance_km, passengers, seat_units, base_fare, per_km_rate,
billable_distance_km, base_fare_x_seat, per_km_x_distance_x_seat,
discount, discount_x_base_x_seat, discount_x_per_km_distance_x_seat
```

- Training is real: `POST /v1/fare/models/train` (or `npm run train`) loads
  `ml_training_samples`, fits ridge OLS, evaluates on the train/validation/test splits,
  stores coefficients + metrics + residual σ, and activates the new version.
- Predictions include a 95% interval (`predicted ± 1.96σ`) and a confidence score.
- Prediction latency, features and model version are persisted in `ml_predictions`.
- The seed produces 226 trips and 226 feature rows (~80/10/10 split), trains model version 1,
  and stores 80 predictions.

Current seeded metrics are exposed at `GET /v1/fare/models/fare-fair-linear`.

---

## Seed data

`npm run db:reset` reads the official checked-in dataset:

```
db/data/cabadbaran-tricycle-fare-matrix.json
```

and imports **Cabadbaran City only**: 1 city, 1 fare policy, 1 active tricycle matrix entry,
**68 official fare routes**, 64 places with aliases, 1 ordinance, 9 global vehicle classes,
demo route/corridor, 21 days of deterministic trips priced from the published rows, GPS
breadcrumbs, anomalies, quotes, 226 ML samples and 80 predictions.

The matrix is official and **not** provisional: it is the Cabadbaran City Tricycle Fare Matrix
effective 24 September 2026, with ₱13 regular / ₱11 discounted minimum fares, a 20% student,
senior and PWD discount, and ₱2.00 per kilometre beyond the Poblacion. The Flutter app's
`assets/data` JSON is deliberately left untouched.

---

## Tests

```bash
npm test
```

37 API integration tests run against a fresh in-memory PGlite database seeded from the official
Cabadbaran dataset. They cover health/meta, the single-city catalog, official fare routes,
published-route and distance-fallback pricing, validation and 404s, persisted quotes, ML
prediction, model registry, retraining/activation, trip filters, GPS points, official trip
creation, status changes, analytics, ordinance filtering, anomalies, audit, CSV and OpenAPI —
plus the success contract (blank inputs fall back to defaults, empty filters return 200 with
empty payloads, calendar dates keep their day, and only invalid values return 400).

13 more tests in `test/auth-admin.test.js` cover the console wiring: scrypt sign-in, wrong
password/unknown account 401s, the 5-attempt lockout, `/v1/auth/me` and logout revocation, the
admin-only account list, scoped fare-matrix and fare-route writes (`401`/`403`/`200`), payload
and target validation, idempotent focus-city activation, append-only audit events and `/admin/`
being served by the API.

---

## Layout

```
backend/
  db/001_schema.sql          PostgreSQL DDL + fare engine + ML SQL + views
  db/data/cabadbaran-tricycle-fare-matrix.json  official 68-row dataset
  src/
    db.js                    pg / PGlite adapter
    seed.js                  official dataset → PostgreSQL seed pipeline
    app.js                   Express app
    server.js                bootstrap + auto-migrate/auto-seed
    data/vehicle-catalog.js  global vehicle catalog
    lib/auth.js              scrypt verify, bearer sessions, roles, audit
    lib/fare.js              official-route lookup + published-fare pricing
    lib/ml.js                ridge OLS, metrics, feature engineering
    lib/serialize.js         snake_case → camelCase API serializers
    routes/                  catalog, fares, trips, analytics, auth, admin
    services/                model training/activation
    scripts/                 reset-db, train, build-pgadmin-sql
  test/api.test.js            37 API integration tests
  test/auth-admin.test.js     13 auth + admin console tests
  docs/openapi.json
  docker-compose.yml
```

---

## What is deliberately not done

- No changes to the Flutter app or its assets. The app still reads bundled JSON; only the admin
  console talks to PostgreSQL.
- No Mapbox/geospatial geometry types; breadcrumbs are stored as indexed lat/lng pairs so the
  API can run on stock PostgreSQL and PGlite.
- Cabadbaran is the only seeded city until another LGU dataset is published. The schema and
  vehicle catalog remain multi-city; adding a dataset is a data update, not a schema change.
- No account creation or password-reset UI: the three accounts come from `npm run db:reset`, and a
  password change means writing a new `scrypt$<salt>$<hex>` hash into `admin_users`.
