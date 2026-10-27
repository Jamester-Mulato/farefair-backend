import 'dotenv/config';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applySchema,
  createDatabase,
  readSchemaSql,
} from '../db.js';
import { seed } from '../seed.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultAssets = path.resolve(here, '..', '..', '..', 'assets', 'data');
const args = process.argv.slice(2);
const usePg = args.includes('--pg');
const nowArg = args.find((arg) => arg.startsWith('--now='));

const db = await createDatabase({
  driver: usePg ? 'pg' : process.env.DB_DRIVER,
});

try {
  console.log(`[farefair] resetting schema (driver: ${db.driver})...`);
  await applySchema(db, await readSchemaSql());
  console.log('[farefair] seeding...');
  const summary = await seed(db, {
    assetsDir: process.env.ASSETS_DIR
      ? path.resolve(process.cwd(), process.env.ASSETS_DIR)
      : defaultAssets,
    now: nowArg ? new Date(nowArg.slice('--now='.length)) : new Date(),
    log: (message) => console.log(`[farefair] ${message}`),
  });

  const counts = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM cities)::int AS cities,
       (SELECT COUNT(*) FROM ordinances)::int AS ordinances,
       (SELECT COUNT(*) FROM fare_matrix_entries)::int AS matrix_entries,
       (SELECT COUNT(*) FROM trips)::int AS trips,
       (SELECT COUNT(*) FROM trip_points)::int AS trip_points,
       (SELECT COUNT(*) FROM ml_training_samples)::int AS training_samples,
       (SELECT COUNT(*) FROM ml_predictions)::int AS predictions,
       (SELECT COUNT(*) FROM fare_anomalies)::int AS anomalies`,
  );
  console.log('[farefair] ready:', counts.rows[0]);
  console.log('[farefair] model version:', summary.modelVersionId);
} finally {
  await db.close();
}
