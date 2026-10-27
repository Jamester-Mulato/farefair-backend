import { readFile } from 'node:fs/promises';

/**
 * Create a small database adapter that speaks the same interface for both:
 *   - pg       : a real PostgreSQL server (production path)
 *   - pglite   : embedded PostgreSQL compiled to WASM (zero-setup dev/tests)
 *
 * The adapter exposes:
 *   query(text, params) -> { rows, rowCount }
 *   exec(sql)           -> run one or more statements
 *   transaction(fn)     -> fn({ query, exec }) inside BEGIN/COMMIT
 *   close()
 */
export async function createDatabase(options = {}) {
  const driver =
    options.driver ??
    process.env.DB_DRIVER ??
    (process.env.DATABASE_URL ? 'pg' : 'pglite');

  if (driver === 'pg') {
    const { default: pg } = await import('pg');
    const pool = new pg.Pool({
      connectionString: options.databaseUrl ?? process.env.DATABASE_URL,
      max: options.max ?? 10,
      options: '-c search_path=farefair,public',
      ssl:
        process.env.PGSSL === 'true'
          ? { rejectUnauthorized: false }
          : undefined,
    });

    const query = async (text, params) => {
      const result = await pool.query(text, params);
      return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
    };

    return {
      driver: 'pg',
      query,
      async exec(sql) {
        await pool.query(sql);
      },
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const tx = {
            query: async (text, params) => {
              const result = await client.query(text, params);
              return {
                rows: result.rows,
                rowCount: result.rowCount ?? result.rows.length,
              };
            },
            exec: async (sql) => {
              await client.query(sql);
            },
          };
          const value = await fn(tx);
          await client.query('COMMIT');
          return value;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      async close() {
        await pool.end();
      },
    };
  }

  if (driver !== 'pglite') {
    throw new Error(`Unknown DB_DRIVER "${driver}". Use "pg" or "pglite".`);
  }

  const { PGlite } = await import('@electric-sql/pglite');
  // `dataDir: null` explicitly requests an in-memory database (used by tests).
  // Otherwise persist to PGLITE_DATA_DIR, defaulting to backend/.pglite.
  const dataDir =
    options.dataDir !== undefined
      ? options.dataDir
      : process.env.PGLITE_DATA_DIR ?? '.pglite';
  const pglite = dataDir ? new PGlite(dataDir) : new PGlite();
  await pglite.waitReady;
  // Safe even before the schema exists; PostgreSQL simply ignores a missing
  // schema in search_path until it is created.
  await pglite.exec('SET search_path TO farefair, public');

  const query = async (text, params) => {
    const result = await pglite.query(text, params);
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  };

  return {
    driver: 'pglite',
    query,
    async exec(sql) {
      await pglite.exec(sql);
    },
    async transaction(fn) {
      await pglite.exec('BEGIN');
      try {
        const tx = {
          query,
          exec: async (sql) => {
            await pglite.exec(sql);
          },
        };
        const value = await fn(tx);
        await pglite.exec('COMMIT');
        return value;
      } catch (error) {
        await pglite.exec('ROLLBACK');
        throw error;
      }
    },
    async close() {
      await pglite.close();
    },
  };
}

export async function readSchemaSql() {
  return readFile(new URL('../db/001_schema.sql', import.meta.url), 'utf8');
}

/**
 * Drop and recreate the dedicated `farefair` schema, then apply the DDL.
 * Safe: it never touches the `public` schema or other databases.
 */
export async function applySchema(db, sql) {
  await db.exec('DROP SCHEMA IF EXISTS farefair CASCADE; CREATE SCHEMA farefair;');
  await db.exec(sql);
}

export async function schemaExists(db) {
  try {
    await db.query('SELECT 1 FROM cities LIMIT 1');
    return true;
  } catch {
    return false;
  }
}
