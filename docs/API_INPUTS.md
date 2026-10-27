# FareFair API input matrix

Success-path inputs for every FareFair API operation, from `GET /health` and
`GET /v1/meta` through analytics. The machine-readable source is
[`api-inputs.json`](./api-inputs.json); execution results are written to
`api-inputs.resolved.json`.

## How to run

```bash
cd backend
npm run api:inputs      # execute all operations against http://localhost:4000
npm run docs:examples   # apply the latest examples to Swagger/OpenAPI
```

- `GET` operations return **200**.
- `POST /v1/trips`, `POST /v1/fare/models/train` and `POST /v1/admin/audit` return **201**
  because they create a resource; every other operation returns **200**.
- Dynamic values (`tripId`, `quoteId`, `versionId`, `anomalyId`) are resolved from earlier
  responses by the runner, so the matrix still works after `npm run db:reset`.
- The matrix signs in with `admin@farefair.local`, sends that bearer token to the
  `/v1/auth/*` and `/v1/admin/*` operations, and signs out at the end.
- Base URL: `http://localhost:4000`.
- Current focus dataset: `cityId=cabadbaran`, `vehicleId=tricycle`, `modelKey=fare-fair-linear`.

## Response contract

Every operation keeps the same success contract:

- **Blank optional inputs are treated as absent.** An empty query value
  (`?cityId=&search=&limit=`) or an empty request body falls back to the documented
  default and still returns `200`/`201`.
- **Empty result sets still succeed.** Filters that match nothing return `200` with
  `data: []`, `count: 0` and `pagination.total: 0` (or zeroed analytics totals)
  instead of `404`.
- **Every documented field is present.** Serializers emit `null` for genuinely
  unknown values (for example an open-ended `effectiveTo` or an unobserved fare)
  rather than dropping the key.
- **Only invalid input fails.** An unknown enum value, malformed UUID, malformed
  JSON or an out-of-range number returns `400` (`VALIDATION_ERROR`, `INVALID_ID`
  or `INVALID_JSON`); a body over 2 MB returns `413`.
- **Swagger shows real responses.** `npm run docs:examples` copies the response sample
  captured by the last `api:inputs` run into the `200`/`201` schema and example
  for every operation.

## Status summary

| # | Method | Path | Success | Last actual | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | GET | `/health` | 200 | 200 | PASS |
| 2 | POST | `/v1/auth/login` | 200 | 200 | PASS |
| 3 | GET | `/v1/auth/me` | 200 | 200 | PASS |
| 4 | GET | `/v1/auth/accounts` | 200 | 200 | PASS |
| 5 | PUT | `/v1/admin/cities/{cityId}/fare-matrix/{vehicleId}` | 200 | 200 | PASS |
| 6 | PATCH | `/v1/admin/cities/{cityId}/fare-matrix/{vehicleId}` | 200 | 200 | PASS |
| 7 | PUT | `/v1/admin/cities/{cityId}/fare-routes/{rowNumber}` | 200 | 200 | PASS |
| 8 | POST | `/v1/admin/cities/{cityId}/activate` | 200 | 200 | PASS |
| 9 | POST | `/v1/admin/audit` | 201 | 201 | PASS |
| 10 | GET | `/v1/meta` | 200 | 200 | PASS |
| 11 | GET | `/v1/cities` | 200 | 200 | PASS |
| 12 | GET | `/v1/cities/{cityId}` | 200 | 200 | PASS |
| 13 | GET | `/v1/cities/{cityId}/fare-matrix` | 200 | 200 | PASS |
| 14 | GET | `/v1/cities/{cityId}/fare-routes` | 200 | 200 | PASS |
| 15 | GET | `/v1/cities/{cityId}/fare-policy` | 200 | 200 | PASS |
| 16 | GET | `/v1/vehicles` | 200 | 200 | PASS |
| 17 | GET | `/v1/fare/routes` | 200 | 200 | PASS |
| 18 | GET | `/v1/vehicles/{vehicleId}` | 200 | 200 | PASS |
| 19 | GET | `/v1/ordinances` | 200 | 200 | PASS |
| 20 | GET | `/v1/ordinances/{slug}` | 200 | 200 | PASS |
| 21 | POST | `/v1/fare/estimate` | 200 | 200 | PASS |
| 22 | GET | `/v1/fare/quotes/{quoteId}` | 200 | 200 | PASS |
| 23 | POST | `/v1/fare/predict` | 200 | 200 | PASS |
| 24 | GET | `/v1/fare/predictions` | 200 | 200 | PASS |
| 25 | GET | `/v1/fare/models` | 200 | 200 | PASS |
| 26 | GET | `/v1/fare/models/{idOrKey}` | 200 | 200 | PASS |
| 27 | GET | `/v1/fare/models/versions/{versionId}` | 200 | 200 | PASS |
| 28 | POST | `/v1/fare/models/train` | 201 | 201 | PASS |
| 29 | POST | `/v1/fare/models/versions/{versionId}/activate` | 200 | 200 | PASS |
| 30 | GET | `/v1/trips` | 200 | 200 | PASS |
| 31 | POST | `/v1/trips` | 201 | 201 | PASS |
| 32 | GET | `/v1/trips/{tripId}` | 200 | 200 | PASS |
| 33 | PATCH | `/v1/trips/{tripId}/status` | 200 | 200 | PASS |
| 34 | GET | `/v1/trips.csv` | 200 | 200 | PASS |
| 35 | GET | `/v1/analytics/overview` | 200 | 200 | PASS |
| 36 | GET | `/v1/analytics/fares` | 200 | 200 | PASS |
| 37 | GET | `/v1/anomalies` | 200 | 200 | PASS |
| 38 | PATCH | `/v1/anomalies/{anomalyId}/resolve` | 200 | 200 | PASS |
| 39 | GET | `/v1/audit` | 200 | 200 | PASS |
| 40 | GET | `/openapi.json` | 200 | 200 | PASS |
| 41 | GET | `/docs` | 200 | 200 | PASS |
| 42 | POST | `/v1/auth/logout` | 200 | 200 | PASS |

## Inputs per operation

### 1. GET /health

**Success status:** `200`  
**Last actual status:** `200` (PASS)

_No inputs._


### 2. POST /v1/auth/login

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `body.login` | `admin@farefair.local` |
| `body.password` | `farefair` |


### 3. GET /v1/auth/me

**Success status:** `200`  
**Last actual status:** `200` (PASS)

_No inputs._


### 4. GET /v1/auth/accounts

**Success status:** `200`  
**Last actual status:** `200` (PASS)

_No inputs._


### 5. PUT /v1/admin/cities/{cityId}/fare-matrix/{vehicleId}

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.cityId` | `cabadbaran` |
| `path.vehicleId` | `tricycle` |
| `body.baseFare` | `13` |
| `body.baseDistanceKm` | `1` |
| `body.perKmRate` | `2` |
| `body.minFare` | `13` |
| `body.maxCustomary` | `75` |
| `body.typicalCapacity` | `4` |
| `body.active` | `true` |


### 6. PATCH /v1/admin/cities/{cityId}/fare-matrix/{vehicleId}

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.cityId` | `cabadbaran` |
| `path.vehicleId` | `tricycle` |
| `body.baseFare` | `13` |
| `body.baseDistanceKm` | `1` |
| `body.perKmRate` | `2` |
| `body.minFare` | `13` |
| `body.maxCustomary` | `75` |
| `body.typicalCapacity` | `4` |
| `body.active` | `true` |


### 7. PUT /v1/admin/cities/{cityId}/fare-routes/{rowNumber}

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.cityId` | `cabadbaran` |
| `path.rowNumber` | `4` |
| `query.vehicleId` | `tricycle` |
| `body.regularFare` | `50` |
| `body.discountedFare` | `40` |
| `body.remark` | *(blank)* |
| `body.bidirectional` | `true` |


### 8. POST /v1/admin/cities/{cityId}/activate

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.cityId` | `cabadbaran` |


### 9. POST /v1/admin/audit

**Success status:** `201`  
**Last actual status:** `201` (PASS)

| Field | Value |
| --- | --- |
| `body.action` | `console.check` |
| `body.detail` | `Executed by the API input matrix` |
| `body.cityId` | `cabadbaran` |
| `body.entityType` | `console` |


### 10. GET /v1/meta

**Success status:** `200`  
**Last actual status:** `200` (PASS)

_No inputs._


### 11. GET /v1/cities

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `query.status` | `active` |
| `query.provisional` | `false` |


### 12. GET /v1/cities/{cityId}

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.cityId` | `cabadbaran` |


### 13. GET /v1/cities/{cityId}/fare-matrix

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.cityId` | `cabadbaran` |
| `query.version` | `1` |
| `query.includeInactive` | `true` |


### 14. GET /v1/cities/{cityId}/fare-routes

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.cityId` | `cabadbaran` |
| `query.vehicleId` | `tricycle` |


### 15. GET /v1/cities/{cityId}/fare-policy

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.cityId` | `cabadbaran` |
| `query.includeHistory` | `true` |


### 16. GET /v1/vehicles

**Success status:** `200`  
**Last actual status:** `200` (PASS)

_No inputs._


### 17. GET /v1/fare/routes

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `query.cityId` | `cabadbaran` |
| `query.vehicleId` | `tricycle` |
| `query.search` | `Poblacion` |


### 18. GET /v1/vehicles/{vehicleId}

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.vehicleId` | `tricycle` |


### 19. GET /v1/ordinances

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `query.cityId` | `cabadbaran` |
| `query.status` | `enacted` |
| `query.vehicleId` | `tricycle` |


### 20. GET /v1/ordinances/{slug}

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.slug` | `cabadbaran-cabadbaran-tricycle-fare-matrix-2026` |


### 21. POST /v1/fare/estimate

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `body.cityId` | `cabadbaran` |
| `body.vehicleId` | `tricycle` |
| `body.origin` | `Poblacion` |
| `body.destination` | `Bayabas` |
| `body.passengers` | `1` |
| `body.pakyaw` | `false` |
| `body.discountCode` | `none` |
| `body.persist` | `true` |


### 22. GET /v1/fare/quotes/{quoteId}

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.quoteId` | `15f4b27c-871c-4b05-b236-4e0eeeef7f01` |


### 23. POST /v1/fare/predict

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `body.cityId` | `cabadbaran` |
| `body.vehicleId` | `tricycle` |
| `body.distanceKm` | `4.2` |
| `body.passengers` | `2` |
| `body.pakyaw` | `false` |
| `body.discountCode` | `none` |
| `body.modelKey` | `fare-fair-linear` |
| `body.persist` | `true` |


### 24. GET /v1/fare/predictions

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `query.limit` | `50` |


### 25. GET /v1/fare/models

**Success status:** `200`  
**Last actual status:** `200` (PASS)

_No inputs._


### 26. GET /v1/fare/models/{idOrKey}

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.idOrKey` | `fare-fair-linear` |


### 27. GET /v1/fare/models/versions/{versionId}

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.versionId` | `5df9cefe-d433-4180-bc41-076421586cdd` |


### 28. POST /v1/fare/models/train

**Success status:** `201`  
**Last actual status:** `201` (PASS)

| Field | Value |
| --- | --- |
| `body.modelKey` | `fare-fair-linear` |
| `body.activate` | `true` |
| `body.actorName` | `api-inputs` |
| `body.role` | `system` |


### 29. POST /v1/fare/models/versions/{versionId}/activate

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.versionId` | `659e1eee-bd25-46e1-b31b-f2ffd1793eed` |
| `body.actorName` | `api-inputs` |
| `body.role` | `system` |


### 30. GET /v1/trips

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `query.cityId` | `cabadbaran` |
| `query.vehicleId` | `tricycle` |
| `query.status` | `completed` |
| `query.discountCode` | `none` |
| `query.recordedVia` | `live_trip_recording` |
| `query.from` | `2020-01-01T00:00:00Z` |
| `query.to` | `2030-12-31T23:59:59Z` |
| `query.search` | `FF-` |
| `query.limit` | `50` |
| `query.offset` | `0` |


### 31. POST /v1/trips

**Success status:** `201`  
**Last actual status:** `201` (PASS)

| Field | Value |
| --- | --- |
| `body.cityId` | `cabadbaran` |
| `body.vehicleId` | `tricycle` |
| `body.origin` | `Poblacion` |
| `body.destination` | `Bayabas` |
| `body.durationSeconds` | `900` |
| `body.passengers` | `2` |
| `body.pakyaw` | `false` |
| `body.discountCode` | `none` |
| `body.recordedVia` | `live_trip_recording` |
| `body.recordedAt` | `2026-10-26T08:00:00Z` |
| `body.routePoints[0].lat` | `9.1157` |
| `body.routePoints[0].lng` | `125.5345` |
| `body.routePoints[0].recordedAt` | `2026-10-26T08:00:00Z` |
| `body.routePoints[1].lat` | `9.1201` |
| `body.routePoints[1].lng` | `125.5402` |
| `body.routePoints[1].recordedAt` | `2026-10-26T08:10:00Z` |
| `body.runPrediction` | `true` |


### 32. GET /v1/trips/{tripId}

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.tripId` | `3e0b93e2-0ecb-491a-af65-2b32535b2ee8` |


### 33. PATCH /v1/trips/{tripId}/status

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.tripId` | `3e0b93e2-0ecb-491a-af65-2b32535b2ee8` |
| `body.status` | `flagged` |
| `body.flagReason` | `API input example` |
| `body.severity` | `low` |
| `body.actorName` | `api-inputs` |


### 34. GET /v1/trips.csv

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `query.cityId` | `cabadbaran` |
| `query.status` | `completed` |


### 35. GET /v1/analytics/overview

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `query.cityId` | `cabadbaran` |
| `query.days` | `30` |


### 36. GET /v1/analytics/fares

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `query.cityId` | `cabadbaran` |
| `query.days` | `30` |


### 37. GET /v1/anomalies

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `query.cityId` | `cabadbaran` |
| `query.resolved` | `false` |
| `query.severity` | `low` |
| `query.kind` | `manual_flag` |
| `query.limit` | `50` |
| `query.offset` | `0` |


### 38. PATCH /v1/anomalies/{anomalyId}/resolve

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `path.anomalyId` | `f9318e32-489b-478c-a067-113ca4089d74` |
| `body.resolutionNote` | `Verified by API input example` |
| `body.actorName` | `api-inputs` |


### 39. GET /v1/audit

**Success status:** `200`  
**Last actual status:** `200` (PASS)

| Field | Value |
| --- | --- |
| `query.cityId` | `cabadbaran` |
| `query.action` | `trip.status_changed` |
| `query.limit` | `50` |
| `query.offset` | `0` |


### 40. GET /openapi.json

**Success status:** `200`  
**Last actual status:** `200` (PASS)

_No inputs._


### 41. GET /docs

**Success status:** `200`  
**Last actual status:** `200` (PASS)

_No inputs._


### 42. POST /v1/auth/logout

**Success status:** `200`  
**Last actual status:** `200` (PASS)

_No inputs._

