# IT 110 Activity 10 — Backend Evidence

This folder stores the laboratory evidence report for **FareFair: Fare Overcharging
Detection Using Machine Learning Based on Trip Distance, Route, and Fare Patterns**
(Synova, IT 110 — Web Systems and Technologies).

| Artifact | Description |
| --- | --- |
| [`FastAPI_Evidence_Report_40.docx`](FastAPI_Evidence_Report_40.docx) | The filled evidence report: health check, Swagger UI inventory, per-endpoint results, error log, checkpoint and rubric. |

## Tested build

| Field | Value |
| --- | --- |
| API | `farefair-api` `1.0.0` (Node.js, Express 5) |
| Database | PGlite (embedded PostgreSQL 17, WASM) |
| Base URL | `http://localhost:4000` |
| Swagger UI | `http://localhost:4000/docs` (OpenAPI 3.1) |
| Run command | `npm start` |
| Test date | 2026-10-26 (UTC server timestamps), 2026-10-27 local |

Health check captured during testing:

```http
GET /health
200 OK
{"status":"ok","service":"farefair-api","version":"1.0.0","database":"pglite","at":"2026-10-26T16:19:22.308Z"}
```

## Coverage

The inventory in the report maps **40 features (F01–F40)** to the implemented routes:

- health and metadata (`/health`, `/v1/meta`)
- city catalog, fare matrix, fare policy, vehicles, ordinances, published fare routes
- statutory fare estimates, ML predictions, persisted quotes and prediction history
- model registry, training, version activation
- trip records, CSV export, status changes
- analytics, fare anomalies and their resolution
- audit trail
- admin authentication (sign-in, session read, logout, account list)
- admin writes: tariff PATCH/PUT, city activation, audit append, fare-route PUT

## Reproducing the test session

```bash
npm install
npm run db:reset      # schema + official Cabadbaran dataset + demo accounts
npm start             # serves the API, Swagger and the console on :4000
```

Then open `http://localhost:4000/health` and `http://localhost:4000/docs`.
Public endpoints (F01–F32) need no token; sign in through `POST /v1/auth/login`,
authorize the bearer token in Swagger, run F33 and F35–F40, and finish with F34 (logout).

The report's appendix lists the tested response bodies. No passwords, tokens or
private data are stored in this repository; seeded demo credentials live in the
backend README and are recreated by `npm run db:reset`.
