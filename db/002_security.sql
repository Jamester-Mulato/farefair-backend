-- ===========================================================================
-- FareFair - least-privilege database roles
-- Run after db/001_schema.sql, as the schema owner (or a superuser):
--   psql "$DATABASE_URL" -f db/002_security.sql
--
-- Two NOLOGIN group roles are used. Login accounts (for example
-- farefair_api_login) are created by the DBA outside this repository,
-- assigned exactly one of these roles, and given their password through the
-- environment (DATABASE_URL), never through committed files.
--
--   farefair_app       runtime API: read/write operational data, append audit
--   farefair_readonly  reporting/BI: read-only, no credential tables
--
-- Deliberately NOT granted: DELETE anywhere, TRUNCATE, DDL (CREATE/ALTER/
-- DROP), role management, and UPDATE/DELETE on the audit trail.
-- ===========================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'farefair_app') THEN
    CREATE ROLE farefair_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'farefair_readonly') THEN
    CREATE ROLE farefair_readonly NOLOGIN;
  END IF;
END
$$;

-- The API and the reporting role may resolve objects in the farefair schema,
-- but only the owner may create objects there.
GRANT USAGE ON SCHEMA farefair TO farefair_app, farefair_readonly;
REVOKE CREATE ON SCHEMA farefair FROM farefair_app, farefair_readonly;

-- ---------------------------------------------------------------------------
-- Runtime API role
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA farefair TO farefair_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA farefair TO farefair_app;

-- No destructive statements from the application path.
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA farefair FROM farefair_app;

-- audit_events is append-only: sign-ins, fare edits and resolutions may add
-- rows, but the API can never rewrite or erase the trail.
REVOKE UPDATE, DELETE ON audit_events FROM farefair_app;

-- Session revocation is modelled as an UPDATE (revoked_at), so no DELETE is
-- needed on admin_sessions either. Password hashes remain readable only by
-- the authentication query in the API.

-- ---------------------------------------------------------------------------
-- Read-only reporting role
-- ---------------------------------------------------------------------------
REVOKE ALL ON admin_users, admin_sessions FROM farefair_readonly;

GRANT SELECT ON
  cities,
  city_provenance,
  vehicle_types,
  discount_programs,
  ordinances,
  ordinance_vehicle_applicability,
  fare_policy_versions,
  fare_matrix_versions,
  fare_matrix_entries,
  fare_matrix_routes,
  trips,
  fare_quotes,
  fare_anomalies,
  audit_events
TO farefair_readonly;

GRANT SELECT ON
  v_city_catalog,
  v_active_fare_matrix,
  v_official_fare_routes,
  v_ordinance_catalog,
  v_trip_enriched,
  v_fare_compliance,
  v_model_leaderboard
TO farefair_readonly;

-- Tables added later by the migration owner follow the reporting rule.
ALTER DEFAULT PRIVILEGES IN SCHEMA farefair
  GRANT SELECT ON TABLES TO farefair_readonly;

COMMIT;
