import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { errorHandler, notFoundHandler } from './lib/errors.js';
import { int } from './lib/serialize.js';
import { catalogRoutes } from './routes/catalog.js';
import { fareRoutes } from './routes/fares.js';
import { tripRoutes } from './routes/trips.js';
import { analyticsRoutes } from './routes/analytics.js';
import { authRoutes } from './routes/auth.js';
import { adminRoutes } from './routes/admin.js';

const SERVICE_NAME = 'farefair-api';
const SERVICE_VERSION = '1.0.0';
const here = path.dirname(fileURLToPath(import.meta.url));
const adminDir = path.resolve(here, '..', '..', 'web', 'admin');

export async function createApp(db, { openapiPath } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.get(
    '/health',
    asyncHandler(async (req, res) => {
      try {
        await db.query('SELECT 1');
        res.json({
          status: 'ok',
          service: SERVICE_NAME,
          version: SERVICE_VERSION,
          database: db.driver,
          at: new Date().toISOString(),
        });
      } catch (error) {
        res.status(503).json({
          status: 'unavailable',
          service: SERVICE_NAME,
          database: db.driver,
          error: error.message,
        });
      }
    }),
  );

  app.get(
    '/v1/meta',
    asyncHandler(async (req, res) => {
      const counts = await db.query(
        `SELECT
           (SELECT COUNT(*) FROM cities)::int AS cities,
           (SELECT COUNT(*) FROM vehicle_types)::int AS vehicles,
           (SELECT COUNT(*) FROM ordinances)::int AS ordinances,
           (SELECT COUNT(*) FROM fare_matrix_entries)::int AS fare_matrix_entries,
           (SELECT COUNT(*) FROM fare_matrix_routes)::int AS fare_routes,
           (SELECT COUNT(*) FROM fare_place_aliases)::int AS fare_place_aliases,
           (SELECT COUNT(*) FROM trips)::int AS trips,
           (SELECT COUNT(*) FROM fare_quotes)::int AS fare_quotes,
           (SELECT COUNT(*) FROM ml_model_versions WHERE status = 'active')::int AS active_models,
           (SELECT COUNT(*) FROM ml_training_samples)::int AS training_samples,
           (SELECT COUNT(*) FROM ml_predictions)::int AS predictions,
           (SELECT COUNT(*) FROM fare_anomalies WHERE resolved_at IS NULL)::int AS open_anomalies,
           (SELECT COUNT(*) FROM audit_events)::int AS audit_events`,
      );
      const focus = await db.query(
        `SELECT id, display_name FROM cities WHERE is_focus LIMIT 1`,
      );
      const row = counts.rows[0];
      res.json({
        name: 'FareFair API',
        version: SERVICE_VERSION,
        database: db.driver,
        activeCityId: focus.rows[0]?.id ?? null,
        activeCityName: focus.rows[0]?.display_name ?? null,
        counts: Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, int(value)]),
        ),
        endpoints: {
          health: '/health',
          meta: '/v1/meta',
          cities: '/v1/cities',
          cityDetail: '/v1/cities/:cityId',
          fareMatrix: '/v1/cities/:cityId/fare-matrix',
          farePolicy: '/v1/cities/:cityId/fare-policy',
          fareRoutes: '/v1/cities/:cityId/fare-routes',
          allFareRoutes: '/v1/fare/routes',
          vehicles: '/v1/vehicles',
          ordinances: '/v1/ordinances',
          estimate: 'POST /v1/fare/estimate',
          predict: 'POST /v1/fare/predict',
          models: '/v1/fare/models',
          train: 'POST /v1/fare/models/train',
          trips: '/v1/trips',
          tripCsv: '/v1/trips.csv',
          analytics: '/v1/analytics/overview',
          fareAnalytics: '/v1/analytics/fares',
          anomalies: '/v1/anomalies',
          audit: '/v1/audit',
          login: 'POST /v1/auth/login',
          me: '/v1/auth/me',
          logout: 'POST /v1/auth/logout',
          accounts: '/v1/auth/accounts',
          adminFareUpdate:
            'PATCH /v1/admin/cities/:cityId/fare-matrix/:vehicleId',
          adminFareRouteUpdate:
            'PUT /v1/admin/cities/:cityId/fare-routes/:rowNumber',
          adminActivateCity: 'POST /v1/admin/cities/:cityId/activate',
          adminAudit: 'POST /v1/admin/audit',
          adminConsole: '/admin/',
          openapi: '/openapi.json',
          docs: '/docs',
        },
        generatedAt: new Date().toISOString(),
      });
    }),
  );

  app.use('/v1', catalogRoutes(db));
  app.use('/v1', fareRoutes(db));
  app.use('/v1', tripRoutes(db));
  app.use('/v1', analyticsRoutes(db));
  app.use('/v1', authRoutes(db));
  app.use('/v1', adminRoutes(db));

  // Serve the admin console from the API origin so its fetches are same-origin
  // and the write endpoints are exercised exactly as deployed.
  if (existsSync(adminDir)) {
    // Express matches /admin and /admin/ to the same route, so compare the
    // path exactly instead of registering a route that would redirect to
    // itself.
    app.use((req, res, next) => {
      if (req.path === '/admin') {
        res.redirect(302, '/admin/');
        return;
      }
      next();
    });
    app.use(
      '/admin',
      express.static(adminDir, {
        index: 'index.html',
        extensions: ['html'],
        setHeaders(res) {
          res.setHeader('Cache-Control', 'no-store');
        },
      }),
    );
  }

  let openapiJson = null;
  let openapiMtime = 0;
  if (openapiPath) {
    try {
      openapiJson = JSON.parse(await readFile(openapiPath, 'utf8'));
      openapiMtime = (await stat(openapiPath)).mtimeMs;
    } catch (error) {
      console.warn(`[${SERVICE_NAME}] OpenAPI spec not loaded: ${error.message}`);
    }
  }

  // `npm run docs:examples` rewrites the spec in place. Re-read it when the file
  // changes so /docs and /openapi.json can never serve a stale schema or stale
  // example IDs while the process keeps running.
  async function currentSpec() {
    if (!openapiPath) return null;
    try {
      const info = await stat(openapiPath);
      if (info.mtimeMs !== openapiMtime) {
        openapiJson = JSON.parse(await readFile(openapiPath, 'utf8'));
        openapiMtime = info.mtimeMs;
      }
      return openapiJson;
    } catch (error) {
      console.warn(`[${SERVICE_NAME}] OpenAPI spec reload failed: ${error.message}`);
      return openapiJson;
    }
  }

  app.get(
    '/openapi.json',
    asyncHandler(async (req, res) => {
      const spec = await currentSpec();
      if (!spec) {
        res.status(404).json({
          error: { code: 'NOT_FOUND', message: 'OpenAPI spec is not available.' },
        });
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(spec);
    }),
  );
  app.get('/docs', (req, res) => {
    res.type('html').send(swaggerHtml());
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function swaggerHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FareFair API docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
    <style>
      body { margin: 0; background: #f7f8fa; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        displayRequestDuration: true,
      });
    </script>
  </body>
</html>`;
}
