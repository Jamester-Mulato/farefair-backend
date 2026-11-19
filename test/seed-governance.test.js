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
let token;

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
    const login = await api('/v1/auth/login', {
      method: 'POST',
      body: { login: 'jamestermulato@csucc.eu.ph', password: 'farefair' },
    });
    assert.equal(login.status, 200, login.text);
    token = login.body.token;
  },
  { timeout: 180_000 },
);

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) await db.close();
});

async function api(pathname, { body, method = 'GET' } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed, text };
}

test('a clean matrix validates against its ordinance', async () => {
  const result = await api('/v1/admin/cities/cabadbaran/seeds/validate', {
    method: 'POST',
    body: { vehicleId: 'tricycle' },
  });
  assert.equal(result.status, 200, result.text);
  assert.equal(result.body.ok, true);
  assert.ok(result.body.checks.length >= 6);
  for (const check of result.body.checks) {
    assert.equal(check.ok, true, `${check.code}: ${check.message}`);
  }
});

test('compile produces a hashed draft seed and audits the actor', async () => {
  const result = await api('/v1/admin/cities/cabadbaran/seeds/compile', {
    method: 'POST',
    body: { vehicleId: 'tricycle', reason: 'Initial seed for the governance test' },
  });
  assert.equal(result.status, 201, result.text);
  assert.equal(result.body.artifact.version, 1);
  assert.equal(result.body.artifact.status, 'draft');
  assert.equal(result.body.sha256.length, 64);
  assert.ok(result.body.rows > 30);

  const audit = await db.query(
    `SELECT action, actor_name, reason, after_data
       FROM audit_events
      WHERE action = 'seed.compile'
      ORDER BY occurred_at DESC LIMIT 1`,
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].actor_name, 'Jamester Mulato');
  assert.match(audit.rows[0].reason, /governance test/);
  assert.equal(audit.rows[0].after_data.version, 1);

  const events = await db.query(
    `SELECT action, reason FROM seed_events ORDER BY occurred_at DESC LIMIT 1`,
  );
  assert.equal(events.rows[0].action, 'compile');
});

test('publishing supersedes the previous seed', async () => {
  const list = await api('/v1/admin/cities/cabadbaran/seeds?vehicleId=tricycle');
  assert.equal(list.status, 200, list.text);
  const draft = list.body.artifacts.find((row) => row.status === 'draft');
  assert.ok(draft, 'a draft artifact exists');

  const published = await api(`/v1/admin/seeds/${draft.id}/publish`, {
    method: 'POST',
    body: { reason: 'Publish the initial seed' },
  });
  assert.equal(published.status, 200, published.text);
  assert.equal(published.body.artifact.status, 'published');

  const after = await api('/v1/admin/cities/cabadbaran/seeds?vehicleId=tricycle');
  const current = after.body.artifacts.filter((row) => row.status === 'published');
  assert.equal(current.length, 1);
  assert.equal(current[0].id, draft.id);
});

test('a matrix that breaks the discount rule cannot be compiled', async () => {
  const edit = await api('/v1/admin/cities/cabadbaran/fare-routes/6', {
    method: 'PUT',
    body: {
      regularFare: 40,
      discountedFare: 40,
      reason: 'Deliberately wrong discount for the governance test',
    },
  });
  assert.equal(edit.status, 200, edit.text);

  const validation = await api('/v1/admin/cities/cabadbaran/seeds/validate', {
    method: 'POST',
    body: { vehicleId: 'tricycle' },
  });
  assert.equal(validation.status, 200, validation.text);
  assert.equal(validation.body.ok, false);
  const failed = validation.body.checks.filter((row) => !row.ok);
  assert.ok(failed.some((row) => row.code === 'discount.statutory'));

  const compile = await api('/v1/admin/cities/cabadbaran/seeds/compile', {
    method: 'POST',
    body: { vehicleId: 'tricycle', reason: 'This should be refused' },
  });
  assert.equal(compile.status, 422, compile.text);
  assert.equal(compile.body.error.code, 'SEED_INVALID');

  // Restore the printed row.
  const restore = await api('/v1/admin/cities/cabadbaran/fare-routes/6', {
    method: 'PUT',
    body: {
      regularFare: 40,
      discountedFare: 32,
      reason: 'Restore the statutory discount',
    },
  });
  assert.equal(restore.status, 200, restore.text);
});

test('rollback republishes an older artifact and keeps both', async () => {
  const second = await api('/v1/admin/cities/cabadbaran/seeds/compile', {
    method: 'POST',
    body: { vehicleId: 'tricycle', reason: 'Second seed after the restore' },
  });
  assert.equal(second.status, 201, second.text);
  assert.equal(second.body.artifact.version, 2);

  const publishSecond = await api(
    `/v1/admin/seeds/${second.body.artifact.id}/publish`,
    { method: 'POST', body: { reason: 'Publish the second seed' } },
  );
  assert.equal(publishSecond.status, 200, publishSecond.text);

  const list = await api('/v1/admin/cities/cabadbaran/seeds?vehicleId=tricycle');
  const first = list.body.artifacts.find((row) => row.version === 1);
  assert.equal(first.status, 'superseded');

  const rollback = await api(`/v1/admin/seeds/${first.id}/rollback`, {
    method: 'POST',
    body: { reason: 'Second seed was wrong; return to the first' },
  });
  assert.equal(rollback.status, 200, rollback.text);

  const after = await api('/v1/admin/cities/cabadbaran/seeds?vehicleId=tricycle');
  const published = after.body.artifacts.filter((row) => row.status === 'published');
  assert.equal(published.length, 1);
  assert.equal(published[0].version, 1);
  assert.ok(after.body.artifacts.some((row) => row.version === 2));

  const events = await db.query(
    `SELECT action, reason FROM seed_events
      WHERE action = 'rollback' ORDER BY occurred_at DESC LIMIT 1`,
  );
  assert.equal(events.rows[0].action, 'rollback');
  assert.match(events.rows[0].reason, /return to the first/);
});

test('the audit log is append-only', async () => {
  await assert.rejects(
    db.query(`UPDATE audit_events SET reason = 'tampered'`),
    /append-only/,
  );
});

test('the published seed is downloadable and carries the matrix', async () => {
  const result = await api('/v1/cities/cabadbaran/seed?vehicleId=tricycle');
  assert.equal(result.status, 200, result.text);
  assert.equal(result.body.version, 1);
  assert.equal(result.body.sha256.length, 64);
  assert.equal(result.body.payload.routes.length, 66);
  assert.equal(result.body.payload.ordinance.number, 'Special City Ordinance No. 2020-012');
});

test('sync accepts a trip once and ignores the retry', async () => {
  const trip = {
    clientTripId: 'device-trip-0001',
    origin: 'Poblacion',
    destination: 'Bugho, Bay-Ang',
    distanceKm: 5.81,
    durationSeconds: 540,
    passengers: 1,
    discounted: false,
    fareMin: 40,
    fareMax: 40,
    farePaid: 50,
    fareRows: [6],
    recordedAt: '2026-11-02T20:30:00.000Z',
    points: [
      [9.1233, 125.5322, 0],
      [9.1200, 125.5400, 60000],
      [9.1033, 125.5779, 720000],
    ],
  };

  const first = await api('/v1/sync', {
    method: 'POST',
    body: { deviceId: 'device-test-1', seedVersion: 0, trips: [trip] },
  });
  assert.equal(first.status, 200, first.text);
  assert.equal(first.body.accepted, 1);
  assert.equal(first.body.duplicates, 0);
  assert.equal(first.body.seed.version, 1);
  assert.ok(first.body.seed.payload, 'a stale client receives the seed payload');

  const second = await api('/v1/sync', {
    method: 'POST',
    body: { deviceId: 'device-test-1', seedVersion: 1, trips: [trip] },
  });
  assert.equal(second.status, 200, second.text);
  assert.equal(second.body.accepted, 0);
  assert.equal(second.body.duplicates, 1);
  assert.equal(second.body.seed.payload, null, 'an up-to-date client gets no payload');

  const stored = await db.query(
    `SELECT t.id, t.fare_paid, t.client_trip_id, COUNT(p.seq)::int AS points
       FROM trips t LEFT JOIN trip_points p ON p.trip_id = t.id
      WHERE t.client_trip_id = 'device-trip-0001'
      GROUP BY t.id`,
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(Number(stored.rows[0].fare_paid), 50);
  assert.equal(stored.rows[0].points, 3);
});

test('the two-person rule blocks self-approval when enabled', async () => {
  const compiled = await api('/v1/admin/cities/cabadbaran/seeds/compile', {
    method: 'POST',
    body: { vehicleId: 'tricycle', reason: 'Seed for the approval-rule test' },
  });
  assert.equal(compiled.status, 201, compiled.text);

  const previous = process.env.SEED_REQUIRE_SECOND_APPROVER;
  process.env.SEED_REQUIRE_SECOND_APPROVER = '1';
  try {
    const publish = await api(
      `/v1/admin/seeds/${compiled.body.artifact.id}/publish`,
      { method: 'POST', body: { reason: 'Attempt to self-approve' } },
    );
    assert.equal(publish.status, 409, publish.text);
    assert.equal(publish.body.error.code, 'SELF_APPROVAL');
  } finally {
    if (previous === undefined) delete process.env.SEED_REQUIRE_SECOND_APPROVER;
    else process.env.SEED_REQUIRE_SECOND_APPROVER = previous;
  }
});

test('an uploaded ordinance is parsed, diffed and applied in one action', async () => {
  const { readFile } = await import('node:fs/promises');
  const docx = await readFile(
    path.resolve(here, '..', '..', 'ml', 'data', 'fares',
      'cabadbaran_city_tricycle_fare_matrix_2026-09-24.docx'),
  );

  const uploaded = await fetch(
    `${base}/v1/admin/cities/cabadbaran/ordinances?vehicleId=tricycle&filename=board.docx`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${token}`,
      },
      body: docx,
    },
  );
  const parsed = JSON.parse(await uploaded.text());
  assert.equal(uploaded.status, 201, JSON.stringify(parsed).slice(0, 300));
  assert.equal(parsed.upload.status, 'parsed');
  assert.equal(parsed.upload.row_count, 68);
  assert.ok(parsed.diff.changed.length > 0, 'the board matrix differs from the active one');
  assert.equal(parsed.notice.kind, 'stale');

  const blocked = await api('/v1/admin/cities/cabadbaran/seeds/compile', {
    method: 'POST',
    body: { vehicleId: 'tricycle', reason: 'Blocked by the newest uploaded ordinance' },
  });
  assert.equal(blocked.status, 422, blocked.text);
  assert.ok(
    blocked.body.error.details.checks.some(
      (row) => row.code === 'ordinance.latest' && !row.ok,
    ),
  );

  const applied = await api(
    `/v1/admin/ordinance-uploads/${parsed.upload.id}/apply`,
    { method: 'POST', body: { reason: 'Apply the uploaded ordinance table' } },
  );
  assert.equal(applied.status, 200, applied.text);
  assert.ok(applied.body.updated > 0 || applied.body.inserted > 0);
  assert.ok(Array.isArray(applied.body.validation.checks));

  const audit = await db.query(
    `SELECT action, reason FROM audit_events
      WHERE action = 'ordinance.apply' ORDER BY occurred_at DESC LIMIT 1`,
  );
  assert.equal(audit.rows[0].action, 'ordinance.apply');
  assert.match(audit.rows[0].reason, /uploaded ordinance/);
});

test('a scanned ordinance is reported as a scan, not guessed at', async () => {
  const { readFile } = await import('node:fs/promises');
  const pdf = await readFile(
    path.resolve(here, '..', '..', 'ml', 'data', 'fares', 'cabadbaran_sco2020-012.pdf'),
  );
  const response = await fetch(
    `${base}/v1/admin/cities/cabadbaran/ordinances?vehicleId=tricycle&filename=sco-2020-012.pdf`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${token}`,
      },
      body: pdf,
    },
  );
  const parsed = JSON.parse(await response.text());
  assert.equal(response.status, 201, JSON.stringify(parsed).slice(0, 300));
  assert.ok(['ocr', 'scan'].includes(parsed.upload.status), parsed.upload.status);
  if (parsed.upload.status === 'ocr') {
    assert.equal(parsed.ocrPages.length, 8);
    assert.equal(parsed.notice.kind, 'ocr');
    assert.ok(parsed.ocrPages[0].text.length > 20);
    assert.ok(parsed.upload.row_count > 0, 'OCR produces candidate rows');
  }
});



