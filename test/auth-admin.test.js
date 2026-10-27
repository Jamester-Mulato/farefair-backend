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
  if (server) await new Promise((resolve) => server.close(resolve));
  if (db) await db.close();
});

async function api(pathname, { token, body, method = 'GET', headers = {} } = {}) {
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
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

async function login(loginValue, password = 'farefair') {
  return api('/v1/auth/login', {
    method: 'POST',
    body: { login: loginValue, password },
  });
}

let adminToken;
let lguToken;

test('seeded accounts sign in with scrypt-verified passwords', async () => {
  const admin = await login('admin@farefair.local');
  assert.equal(admin.status, 200);
  assert.match(admin.body.token, /^ff_[a-f0-9]{64}$/);
  assert.equal(admin.body.tokenType, 'Bearer');
  assert.equal(admin.body.user.role, 'admin');
  assert.equal(admin.body.user.username, 'admin');
  assert.deepEqual(admin.body.user.cityScope, []);
  adminToken = admin.body.token;

  const lgu = await login('lgu@farefair.local');
  assert.equal(lgu.status, 200);
  assert.equal(lgu.body.user.role, 'lgu_editor');
  assert.deepEqual(lgu.body.user.cityScope, ['cabadbaran']);
  lguToken = lgu.body.token;

  // The username part of the email also works as a login.
  const byUsername = await login('analyst');
  assert.equal(byUsername.status, 200);
  assert.equal(byUsername.body.user.role, 'analyst');
});

test('sign-in rejects wrong passwords and unknown accounts', async () => {
  assert.equal((await login('admin@farefair.local', 'wrong')).status, 401);
  const unknown = await login('nobody@farefair.local');
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error.code, 'INVALID_CREDENTIALS');

  // Missing fields are a validation error, not a credential error.
  const empty = await api('/v1/auth/login', { method: 'POST', body: {} });
  assert.equal(empty.status, 400);
});

test('repeated failures lock the login until the window expires', async () => {
  const loginValue = 'lockout-probe@farefair.local';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await login(loginValue, 'nope')).status, 401);
  }
  const locked = await login(loginValue, 'nope');
  assert.equal(locked.status, 429);
  assert.equal(locked.body.error.code, 'TOO_MANY_ATTEMPTS');
});

test('sessions resolve through /v1/auth/me and are revoked on logout', async () => {
  assert.equal((await api('/v1/auth/me')).status, 401);

  const before = await api('/v1/auth/me', { token: adminToken });
  assert.equal(before.status, 200);
  assert.equal(before.body.user.email, 'admin@farefair.local');
  assert.equal(before.body.user.title, 'Transport Administrator');

  const scratch = await login('admin@farefair.local');
  const revocation = await api('/v1/auth/logout', {
    method: 'POST',
    token: scratch.body.token,
    body: {},
  });
  assert.equal(revocation.status, 200);
  assert.equal((await api('/v1/auth/me', { token: scratch.body.token })).status, 401);

  // The long-lived token used by the rest of the suite still works.
  assert.equal((await api('/v1/auth/me', { token: adminToken })).status, 200);
});

test('account listing is restricted to administrators', async () => {
  const accounts = await api('/v1/auth/accounts', { token: adminToken });
  assert.equal(accounts.status, 200);
  const usernames = accounts.body.data.map((row) => row.username).sort();
  assert.deepEqual(usernames, ['admin', 'analyst', 'lgu']);
  const lgu = accounts.body.data.find((row) => row.username === 'lgu');
  assert.deepEqual(lgu.cityScope, ['cabadbaran']);
  assert.equal(accounts.body.data.some((row) => 'passwordHash' in row), false);

  assert.equal((await api('/v1/auth/accounts', { token: lguToken })).status, 403);
  assert.equal((await api('/v1/auth/accounts')).status, 401);
});

test('fare matrix writes require a session, a role and city scope', async () => {
  const patch = {
    baseFare: 16,
    baseDistanceKm: 1.5,
    perKmRate: 2.75,
    minFare: 13,
    maxCustomary: 70,
    typicalCapacity: 5,
    active: true,
  };
  const pathname = '/v1/admin/cities/cabadbaran/fare-matrix/tricycle';

  assert.equal(
    (await api(pathname, { method: 'PATCH', body: patch })).status,
    401,
  );

  // lgu_editor is scoped to Cabadbaran, so another city is forbidden.
  const outOfScope = await api(
    '/v1/admin/cities/out-of-scope/fare-matrix/tricycle',
    { method: 'PATCH', token: lguToken, body: patch },
  );
  assert.equal(outOfScope.status, 403);

  // The analyst role can read but never write fares.
  const analyst = await login('analyst@farefair.local');
  const analystWrite = await api(pathname, {
    method: 'PATCH',
    token: analyst.body.token,
    body: patch,
  });
  assert.equal(analystWrite.status, 403);

  const saved = await api(pathname, {
    method: 'PATCH',
    token: adminToken,
    body: patch,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.baseFare, 16);
  assert.equal(saved.body.typicalCapacity, 5);

  const matrix = await api('/v1/cities/cabadbaran/fare-matrix');
  const entry = matrix.body.entries.find((row) => row.vehicleId === 'tricycle');
  assert.equal(entry.baseFare, 16);
  assert.equal(entry.perKmRate, 2.75);

  const audit = await api('/v1/audit?action=fare.update&limit=5');
  assert.equal(audit.status, 200);
  assert.ok(audit.body.data.some((row) => row.cityId === 'cabadbaran'));
});

test('fare matrix writes validate the payload and the target', async () => {
  const pathname = '/v1/admin/cities/cabadbaran/fare-matrix/tricycle';
  assert.equal(
    (
      await api(pathname, {
        method: 'PATCH',
        token: adminToken,
        body: { baseFare: -1 },
      })
    ).status,
    400,
  );

  assert.equal(
    (
      await api('/v1/admin/cities/atlantis/fare-matrix/tricycle', {
        method: 'PATCH',
        token: adminToken,
        body: {
          baseFare: 15,
          baseDistanceKm: 1,
          perKmRate: 2.5,
          minFare: 12,
          maxCustomary: 65,
          typicalCapacity: 4,
          active: true,
        },
      })
    ).status,
    404,
  );

  assert.equal(
    (
      await api('/v1/admin/cities/cabadbaran/fare-matrix/hovercraft', {
        method: 'PATCH',
        token: adminToken,
        body: {
          baseFare: 15,
          baseDistanceKm: 1,
          perKmRate: 2.5,
          minFare: 12,
          maxCustomary: 65,
          typicalCapacity: 4,
          active: true,
        },
      })
    ).status,
    404,
  );
});

test('fare route writes require a session, a role and city scope', async () => {
  const pathname = '/v1/admin/cities/cabadbaran/fare-routes/4?vehicleId=tricycle';
  const patch = {
    regularFare: 52,
    discountedFare: 42,
    remark: 'Updated by integration test',
    bidirectional: true,
  };

  assert.equal(
    (await api(pathname, { method: 'PUT', body: patch })).status,
    401,
  );

  const outOfScope = await api(
    '/v1/admin/cities/out-of-scope/fare-routes/4?vehicleId=tricycle',
    { method: 'PUT', token: lguToken, body: patch },
  );
  assert.equal(outOfScope.status, 403);

  const analyst = await login('analyst@farefair.local');
  assert.equal(
    (
      await api(pathname, {
        method: 'PUT',
        token: analyst.body.token,
        body: patch,
      })
    ).status,
    403,
  );

  // The Cabadbaran-scoped editor can update its own matrix.
  const saved = await api(pathname, {
    method: 'PUT',
    token: lguToken,
    body: patch,
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.rowNumber, 4);
  assert.equal(saved.body.regularFare, 52);
  assert.equal(saved.body.discountedFare, 42);
  assert.equal(saved.body.remark, 'Updated by integration test');
  assert.equal(saved.body.updatedBy, 'Cabadbaran LGU Editor');

  const routes = await api('/v1/cities/cabadbaran/fare-routes?search=Bayabas');
  assert.equal(routes.status, 200);
  assert.equal(routes.body.count, 1);
  assert.equal(routes.body.data[0].regularFare, 52);

  const audit = await api('/v1/audit?action=fare_route.update&limit=5');
  assert.equal(audit.status, 200);
  assert.ok(audit.body.data.some((row) => row.entityId?.endsWith(':4')));

  // Restore the published value so later assertions stay stable.
  const restored = await api(pathname, {
    method: 'PUT',
    token: adminToken,
    body: {
      regularFare: 50,
      discountedFare: 40,
      remark: '',
      bidirectional: true,
    },
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.regularFare, 50);
  assert.equal(restored.body.discountedFare, 40);
});

test('fare route writes validate the row, city and discounted fare', async () => {
  const base = {
    regularFare: 50,
    discountedFare: 40,
    bidirectional: true,
  };

  assert.equal(
    (
      await api('/v1/admin/cities/cabadbaran/fare-routes/4?vehicleId=tricycle', {
        method: 'PUT',
        token: adminToken,
        body: { ...base, discountedFare: 55 },
      })
    ).status,
    400,
  );

  assert.equal(
    (
      await api('/v1/admin/cities/cabadbaran/fare-routes/999?vehicleId=tricycle', {
        method: 'PUT',
        token: adminToken,
        body: base,
      })
    ).status,
    404,
  );

  assert.equal(
    (
      await api('/v1/admin/cities/cabadbaran/fare-routes/4?vehicleId=hovercraft', {
        method: 'PUT',
        token: adminToken,
        body: base,
      })
    ).status,
    404,
  );

  assert.equal(
    (
      await api('/v1/admin/cities/atlantis/fare-routes/4?vehicleId=tricycle', {
        method: 'PUT',
        token: adminToken,
        body: base,
      })
    ).status,
    404,
  );

  assert.equal(
    (
      await api('/v1/admin/cities/cabadbaran/fare-routes/not-a-number', {
        method: 'PUT',
        token: adminToken,
        body: base,
      })
    ).status,
    400,
  );
});

test('activating the focus city is idempotent and audited', async () => {
  // Only administrators can move the focus flag.
  assert.equal(
    (
      await api('/v1/admin/cities/cabadbaran/activate', {
        method: 'POST',
        token: lguToken,
        body: {},
      })
    ).status,
    403,
  );

  const activated = await api('/v1/admin/cities/cabadbaran/activate', {
    method: 'POST',
    token: adminToken,
    body: {},
  });
  assert.equal(activated.status, 200);
  assert.equal(activated.body.activeCityId, 'cabadbaran');

  const cities = await api('/v1/cities');
  assert.equal(cities.body.activeCityId, 'cabadbaran');
  assert.equal(cities.body.count, 1);
  assert.equal(
    cities.body.data.filter((city) => city.isFocus).length,
    1,
  );

  const audit = await api('/v1/audit?action=city.activate&limit=5');
  assert.ok(audit.body.data.some((row) => row.entityId === 'cabadbaran'));
});

test('manual audit events are append-only server records', async () => {
  const created = await api('/v1/admin/audit', {
    method: 'POST',
    token: lguToken,
    body: {
      action: 'report.export',
      detail: 'Exported the Cabadbaran trips CSV',
      cityId: 'cabadbaran',
    },
  });
  assert.equal(created.status, 201);

  const audit = await api('/v1/audit?action=report.export&limit=5');
  const row = audit.body.data.find(
    (entry) => entry.detail?.summary === 'Exported the Cabadbaran trips CSV',
  );
  assert.ok(row);
  assert.equal(row.actorName, 'Cabadbaran LGU Editor');
});

test('the admin console is served from the API origin', async () => {
  const page = await api('/admin/');
  assert.equal(page.status, 200);
  assert.match(page.text, /FareFair Admin Console/);
  assert.match(page.text, /js\/api\.js/);

  const client = await api('/admin/js/api.js');
  assert.equal(client.status, 200);
  assert.match(client.text, /FareFairApi/);
});

test('the meta endpoint advertises the admin surface', async () => {
  const meta = await api('/v1/meta');
  assert.equal(meta.status, 200);
  const endpoints = meta.body.endpoints;
  assert.equal(endpoints.login, 'POST /v1/auth/login');
  assert.equal(endpoints.me, '/v1/auth/me');
  assert.equal(endpoints.adminActivateCity, 'POST /v1/admin/cities/:cityId/activate');
  assert.equal(endpoints.adminFareRouteUpdate, 'PUT /v1/admin/cities/:cityId/fare-routes/:rowNumber');
  assert.equal(endpoints.fareRoutes, '/v1/cities/:cityId/fare-routes');
  assert.equal(endpoints.adminConsole, '/admin/');
});
