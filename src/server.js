import 'dotenv/config';

import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applySchema,
  createDatabase,
  readSchemaSql,
  schemaExists,
} from './db.js';
import { seed } from './seed.js';
import { createApp } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultAssets = path.resolve(here, '..', '..', 'assets', 'data');
const openapiPath = path.resolve(here, '..', 'docs', 'openapi.json');
const port = Number(process.env.PORT ?? 4000);

/**
 * PGlite is a single-process PostgreSQL: two servers opening backend/.pglite at
 * the same time corrupt the data directory. The HTTP port is the natural mutex,
 * so claim it BEFORE touching the database. Without this, a second `npm start`
 * opens the data directory, corrupts it, and only then discovers EADDRINUSE.
 */
async function assertPortFree() {
  const host = await new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        resolve(null);
        return;
      }
      // No IPv6 stack: fall back to IPv4 for the real check below.
      resolve(error.code === 'EAFNOSUPPORT' ? '0.0.0.0' : null);
    });
    probe.once('listening', () => probe.close(() => resolve('::')));
    probe.listen({ port, host: '::', exclusive: true });
  });

  if (host === '0.0.0.0') {
    await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', (error) =>
        error.code === 'EADDRINUSE'
          ? reject(portInUseError())
          : reject(error),
      );
      probe.once('listening', () => probe.close(resolve));
      probe.listen({ port, host: '0.0.0.0', exclusive: true });
    });
  } else if (host === null) {
    throw portInUseError();
  }
}

function portInUseError() {
  return new Error(
    `Port ${port} is already in use, so another FareFair API is running.\n` +
      'Stop it before starting a second one: two processes must never open ' +
      'backend/.pglite at the same time, because that corrupts the database.\n' +
      'If no server is running, the port is held by another program; set PORT ' +
      'or free the port, then try again.',
  );
}

await assertPortFree();

let db;
try {
  db = await createDatabase();
} catch (error) {
  console.error(
    `[farefair-api] could not open the database: ${error.message}\n` +
      '[farefair-api] if another server crashed while holding backend/.pglite, ' +
      'rebuild it with: npm run db:reset',
  );
  throw error;
}

if (process.env.AUTO_MIGRATE !== 'false') {
  if (!(await schemaExists(db))) {
    console.log('[farefair-api] applying schema...');
    await applySchema(db, await readSchemaSql());
  }
}

if (process.env.AUTO_SEED !== 'false') {
  const count = await db.query('SELECT COUNT(*)::int AS count FROM cities');
  if (Number(count.rows[0].count) === 0) {
    console.log('[farefair-api] seeding database from city datasets...');
    await seed(db, {
      assetsDir: process.env.ASSETS_DIR
        ? path.resolve(process.cwd(), process.env.ASSETS_DIR)
        : defaultAssets,
      log: (message) => console.log(`[farefair-api] ${message}`),
    });
  }
}

const app = await createApp(db, { openapiPath });

const server = app.listen(port, () => {
  console.log(
    `[farefair-api] listening on http://localhost:${port} (driver: ${db.driver})`,
  );
  console.log(`[farefair-api] docs: http://localhost:${port}/docs`);
});

server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[farefair-api] ${portInUseError().message}`);
  } else {
    console.error(`[farefair-api] server error: ${error.message}`);
  }
  await db.close().catch(() => {});
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`[farefair-api] ${signal} received, shutting down...`);
  server.close(async () => {
    await db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
