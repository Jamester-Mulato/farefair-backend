# FareFair database security and access control

This document is the repository-side evidence for **IT 108 — Advanced Database
Management System, Laboratory Activity No. 7**: roles, privileges, RLS decision,
credential protection and SQL-injection review for the FareFair backend.

| Artifact | Location |
| --- | --- |
| Least-privilege role script | [`db/002_security.sql`](../db/002_security.sql) |
| Executable privilege test | [`src/scripts/security-check.js`](../src/scripts/security-check.js) |
| Schema | [`db/001_schema.sql`](../db/001_schema.sql) |
| Login/session code | [`src/lib/auth.js`](../src/lib/auth.js), [`src/routes/auth.js`](../src/routes/auth.js) |
| Connection handling | [`src/db.js`](../src/db.js) |

---

## 1. Application roles

FareFair has three signed-in staff roles plus an unauthenticated passenger
client. They are stored in `admin_users.role` (enum `viewer`, `analyst`,
`admin`, `lgu_editor`) and enforced by `requireAuth()`, `requireRole()` and
`canEditFares()` before any SQL runs.

| Role | Responsibilities | Data/actions that require access | Security concern |
| --- | --- | --- | --- |
| `admin` (transport administrator) | Publishes fare matrices, activates the live city, reviews accounts and the audit trail | Read/write fares for every city, `GET /v1/auth/accounts`, append audit events, change trip status | Highest privilege; a stolen session could silently rewrite published fares or hide tampering |
| `lgu_editor` (city data steward) | Maintains the Cabadbaran City fare matrix and applies LGU corrections | SELECT/UPDATE fares and fare routes for its `city_scope` only; read scoped trips/audit | Cross-city edits; every write must pass the `canEditFares()` scope check |
| `analyst` (fare data analyst) | Studies compliance, anomalies and model output | Read-only trips, fares, analytics and audit | Re-identification of passengers from GPS/fare data; accidental dataset changes |
| Public passenger client | Requests estimates, browses published fares, records a trip | `POST /v1/trips`, published GET endpoints | Forged trips and enumeration; no credential to protect, so validation and rate limiting matter |

The database itself is reached through one runtime principal (`farefair_app`),
so PostgreSQL privileges and API role checks form two layers:

```
passenger / console  ->  Express + requireAuth/requireRole/canEditFares  ->  farefair_app  ->  farefair schema
```

## 2. Protected tables

| Table | Purpose / important data | Roles that use it | Why access must be controlled |
| --- | --- | --- | --- |
| `admin_users` | Staff identities, scrypt password hashes, role, `city_scope`, active flag | API authentication; `admin` reads the account list | Credential material; disclosure enables offline cracking and privilege escalation |
| `admin_sessions` | Opaque bearer-token digests, expiry and revocation | Auth middleware; each signed-in user sees only their own session | A leaked digest or long-lived session allows impersonation |
| `fare_matrix_entries` | Versioned per-vehicle tariffs used by every estimate | `admin`, `lgu_editor`, public read | Unauthorized edits directly cause over/undercharging and destroy legal evidence |
| `trips` | Passenger trips with distance, fare window, discount, status | Public create; staff read; `admin` status updates | Movement data is personal; tampering invalidates anomaly detection |
| `audit_events` | Append-only trail of sign-ins, fare edits and resolutions | Staff read; the API appends | If mutable, an attacker can erase evidence; if over-exposed, staff details leak |

The full access-control matrix lives in the submitted IT 108 report
(`docs/evidence/IT108_Activity_7_Security_Report.docx`). Summary:

- `admin_users`: admin read-only through the API; no write endpoint; LGU and
  analyst have no access.
- `admin_sessions`: own session only (`SELECT`/`INSERT` on login, `UPDATE` on
  logout); no `DELETE`.
- `fare_matrix_entries`: admin and `lgu_editor` (own city) may `UPDATE`;
  analysts are read-only; rows are never deleted.
- `trips`: read-only for staff; status changes are the only update; no delete.
- `audit_events`: `INSERT` (append) and `SELECT`; `UPDATE`/`DELETE` revoked at
  the database layer for `farefair_app`.

## 3. GRANT / REVOKE and test evidence

`db/002_security.sql` creates two `NOLOGIN` group roles:

- `farefair_app` — runtime API: `SELECT, INSERT, UPDATE` on the schema,
  sequence usage, **no** `DELETE`, `TRUNCATE`, DDL or role management;
  `UPDATE`/`DELETE` on `audit_events` is revoked (append-only).
- `farefair_readonly` — reporting/BI: `SELECT` on curated tables and views,
  with `admin_users` and `admin_sessions` revoked.

Login accounts (for example `farefair_api_login`) are created by the DBA,
assigned one role, and receive their password from `DATABASE_URL`; they are not
stored in this repository.

Run the checks against a throwaway in-memory PostgreSQL 17 (PGlite):

```bash
npm run security:check
```

Last run (2026-10-27, `farefair-api` 1.0.0):

```
FareFair database privilege checks (in-memory PGlite)

ID   Role              Test                                         Expected  Actual  Result
---  ----------------  -------------------------------------------  --------  ------  ------
T01  farefair_app      SELECT trips                                 allowed   allowed  PASS
     0 rows
T02  farefair_app      INSERT audit_events (append)                 allowed   allowed  PASS
     statement completed
T03  farefair_app      UPDATE audit_events (rewrite trail)          denied    denied  PASS
     42501: permission denied for table audit_events
T04  farefair_app      DELETE audit_events (erase trail)            denied    denied  PASS
     42501: permission denied for table audit_events
T05  farefair_app      DELETE trips (destroy records)               denied    denied  PASS
     42501: permission denied for table trips
T06  farefair_app      CREATE TABLE in farefair schema              denied    denied  PASS
     42501: permission denied for schema farefair
T07  farefair_app      SELECT password_hash (auth query)            allowed   allowed  PASS
     0 rows
T08  farefair_readonly  SELECT v_active_fare_matrix (reporting)      allowed   allowed  PASS
     0 rows
T09  farefair_readonly  SELECT admin_users (credential table)        denied    denied  PASS
     42501: permission denied for table admin_users
T10  farefair_readonly  INSERT audit_events (reporting)              denied    denied  PASS
     42501: permission denied for table audit_events

10/10 checks passed.
```

The empty result sets in T01, T07 and T08 are expected: the script applies the
schema to an empty in-memory database and never seeds rows. A successful
`SELECT` (rather than `42501`) is the evidence that the privilege exists.

## 4. Row-Level Security decision

**Decision: NO RLS for the current architecture.**

- Only the Express API connects to PostgreSQL, through one `farefair_app`
  principal; no end user or LGU holds a database login.
- City scoping is already a row-level rule, but it is enforced in the API:
  `canEditFares()` checks `role` plus `city_scope` before fare writes, and every
  list query filters by `city_id` (for example `GET /v1/audit?cityId=...`).
- Enabling RLS would require per-request identity plumbing
  (`SET LOCAL farefair.city_id = $1` inside each transaction) that does not
  exist; policies keyed on a missing setting would either block the console or
  silently fail open.
- Revisit the decision if BI tools or LGU staff ever connect directly. The
  proposed design then is `city_id = current_setting('farefair.city_id', true)`
  on `fare_matrix_entries`, `trips` and `audit_events`, with `farefair_app`
  never owning `BYPASSRLS`.

## 5. Credential protection

- **No hard-coded database credentials.** `src/db.js` reads
  `process.env.DATABASE_URL` and passes it to `pg.Pool`; PGlite needs no
  password. `docker-compose.yml` requires `POSTGRES_PASSWORD` from the local
  environment and `.env.example` contains placeholders only.
- **Secrets excluded from Git.** `.gitignore` contains `.env` (also
  `node_modules/`, `.pglite/`, `coverage/`, `*.log`). `git ls-files` tracks only
  `.env.example`.
- **No tokens in the repository.** A scan for the session-token format
  `ff_[a-f0-9]{64}` returns no match; the OpenAPI examples use
  `ff_example_token_redacted`.
- **Least privilege.** The runtime role cannot delete rows, rewrite audit
  events, create tables or manage roles (tests T03–T06). Reporting uses a
  separate role with no access to credential tables (T09–T10).
- **Seeded demo accounts.** `npm run db:reset` creates three demo logins. Their
  password is fixture data, not a production credential: it can be changed with
  `SEED_DEMO_PASSWORD`, and seeding refuses to run with `NODE_ENV=production`
  unless that variable is set.

## 6. SQL-injection review

**Feature:** admin sign-in (`POST /v1/auth/login`), `src/routes/auth.js`.

```js
const found = await db.query(
  `SELECT *
   FROM admin_users
   WHERE is_active
     AND (
       lower(email) = lower($1)
       OR lower(split_part(email, '@', 1)) = lower($1)
     )
   LIMIT 1`,
  [input.login.trim()],
);
```

- Input: `login` (email or username) and `password`, validated by Zod
  (`max(200)`), never concatenated into SQL.
- The adapter forwards `params` to `pg` / PGlite as bound parameters, so the
  driver parses `$1` as data, not syntax.
- `password` never reaches SQL: it is checked with `scryptSync` and
  `timingSafeEqual` against `password_hash`, and unknown accounts run a dummy
  hash to keep timing constant.
- Writes follow the same pattern, for example
  `INSERT INTO audit_events ... VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)` with
  `JSON.stringify(detail)` bound to `$7`.

## 7. Reproduce

```bash
npm install
npm run db:reset          # schema + seed data (PGlite)
npm run security:check    # roles, grants and denial tests
npm test                  # 50 API/auth/admin tests
npm start                 # API on http://localhost:4000, Swagger at /docs
```
