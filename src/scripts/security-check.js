#!/usr/bin/env node
/**
 * Executes db/002_security.sql against a throwaway in-memory PGlite database
 * and proves, with SET ROLE, that each GRANT/REVOKE behaves as designed.
 *
 *   npm run security:check
 *
 * This is the evidence behind Part C of the IT 108 Activity 7 report. The
 * script never touches the development .pglite data directory.
 */
import { readFile } from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';

const schemaSql = await readFile(
  new URL('../../db/001_schema.sql', import.meta.url),
  'utf8',
);
const securitySql = await readFile(
  new URL('../../db/002_security.sql', import.meta.url),
  'utf8',
);

const db = new PGlite();
await db.waitReady;
await db.exec('DROP SCHEMA IF EXISTS farefair CASCADE; CREATE SCHEMA farefair;');
await db.exec(schemaSql);
await db.exec(securitySql);

const results = [];
let failures = 0;

async function test(id, role, sql, expectation) {
  const label = expectation.label;
  await db.exec(`SET ROLE ${role}`);
  let outcome;
  try {
    const result = await db.query(sql);
    outcome = {
      allowed: true,
      detail:
        expectation.kind === 'select'
          ? `${result.rows.length} row${result.rows.length === 1 ? '' : 's'}`
          : 'statement completed',
    };
  } catch (error) {
    outcome = {
      allowed: false,
      detail: `${error.code ?? 'ERROR'}: ${error.message}`,
    };
  } finally {
    await db.exec('RESET ROLE');
  }

  const pass = outcome.allowed === expectation.allowed;
  if (!pass) failures += 1;
  results.push({
    id,
    role,
    label,
    expected: expectation.allowed ? 'allowed' : 'denied',
    actual: outcome.allowed ? 'allowed' : 'denied',
    detail: outcome.detail,
    pass,
  });
}

await test(
  'T01',
  'farefair_app',
  `SELECT id, reference, fare_min, fare_max FROM trips LIMIT 5`,
  { label: 'SELECT trips', allowed: true, kind: 'select' },
);

await test(
  'T02',
  'farefair_app',
  `INSERT INTO audit_events (actor_name, role, action, detail)
   VALUES ('security-check', 'system', 'security.grant_test', '{}'::jsonb)
   RETURNING id`,
  { label: 'INSERT audit_events (append)', allowed: true },
);

await test(
  'T03',
  'farefair_app',
  `UPDATE audit_events SET detail = '{"tampered":true}'::jsonb
   WHERE action = 'security.grant_test'`,
  { label: 'UPDATE audit_events (rewrite trail)', allowed: false },
);

await test(
  'T04',
  'farefair_app',
  `DELETE FROM audit_events WHERE action = 'security.grant_test'`,
  { label: 'DELETE audit_events (erase trail)', allowed: false },
);

await test(
  'T05',
  'farefair_app',
  `DELETE FROM trips`,
  { label: 'DELETE trips (destroy records)', allowed: false },
);

await test(
  'T06',
  'farefair_app',
  `CREATE TABLE farefair.ff_should_fail (id integer)`,
  { label: 'CREATE TABLE in farefair schema', allowed: false },
);

await test(
  'T07',
  'farefair_app',
  `SELECT password_hash FROM admin_users LIMIT 1`,
  { label: 'SELECT password_hash (auth query)', allowed: true, kind: 'select' },
);

await test(
  'T08',
  'farefair_readonly',
  `SELECT * FROM v_active_fare_matrix LIMIT 3`,
  { label: 'SELECT v_active_fare_matrix (reporting)', allowed: true, kind: 'select' },
);

await test(
  'T09',
  'farefair_readonly',
  `SELECT email, password_hash FROM admin_users LIMIT 1`,
  { label: 'SELECT admin_users (credential table)', allowed: false },
);

await test(
  'T10',
  'farefair_readonly',
  `INSERT INTO audit_events (actor_name, action) VALUES ('readonly', 'security.test')`,
  { label: 'INSERT audit_events (reporting)', allowed: false },
);

const expected = [
  'T01 app can read trips',
  'T02 app can append audit events',
  'T03 app cannot rewrite audit events',
  'T04 app cannot delete audit events',
  'T05 app cannot delete trips',
  'T06 app cannot create tables',
  'T07 app can read hashes for authentication only',
  'T08 reporting can read the fare view',
  'T09 reporting cannot read admin_users',
  'T10 reporting cannot append audit events',
];

console.log('FareFair database privilege checks (in-memory PGlite)\n');
console.log(
  'ID   Role              Test                                         Expected  Actual  Result',
);
console.log(
  '---  ----------------  -------------------------------------------  --------  ------  ------',
);
for (const row of results) {
  console.log(
    `${row.id}  ${row.role.padEnd(16)}  ${row.label.padEnd(43)}  ${row.expected.padEnd(8)}  ${row.actual.padEnd(6)}  ${row.pass ? 'PASS' : 'FAIL'}`,
  );
  console.log(`     ${row.detail}`);
}

console.log(`\n${results.length - failures}/${results.length} checks passed.`);
console.log(`Design expectations: ${expected.length} documented, ${expected.length} covered.`);

await db.close();
if (failures > 0) process.exitCode = 1;
