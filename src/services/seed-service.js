// Fare seed governance: validate a city matrix against the ordinance that
// backs it, compile it into a hashed artifact, publish it, and roll it back.
//
// Doctrine:
//   * Nothing is published until every validation check passes.
//   * A published seed is immutable. Rolling back publishes an older artifact
//     again; it never rewrites or deletes one.
//   * Every state change writes a seed_event and an audit row naming the
//     account that made it.
import { createHash } from 'node:crypto';

import { ApiError } from '../lib/errors.js';
import { recordAudit } from '../lib/auth.js';

const DEFAULT_DISCOUNT_RATE = 0.2;
const MONEY_EPSILON = 0.011;

/**
 * Stable JSON: object keys sorted, so the same matrix always hashes the same.
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(value).sort();
  return (
    '{' +
    keys
      .filter((key) => value[key] !== undefined)
      .map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key]))
      .join(',') +
    '}'
  );
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function check(code, ok, message, blocking = true) {
  return { code, ok, message, blocking };
}

function money(value) {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * The matrix, its vehicle entry and its ordinance, or nulls where missing.
 */
export async function loadSeedContext(db, cityId, vehicleId) {
  const { rows } = await db.query(
    `SELECT mv.id                AS matrix_id,
            mv.version           AS matrix_version,
            mv.status            AS matrix_status,
            mv.ordinance_id,
            mv.effective_from,
            mv.provisional,
            o.ordinance_number,
            o.title              AS ordinance_title,
            o.status             AS ordinance_status,
            o.effective_from     AS ordinance_effective_from,
            o.succeeding_km_rate,
            o.base_fare          AS ordinance_base_fare,
            o.discount_terms,
            e.active             AS vehicle_active,
            e.base_fare,
            e.base_distance_km,
            e.per_km_rate,
            e.min_fare,
            e.max_customary,
            e.typical_capacity,
            e.regulation_matrix
       FROM fare_matrix_versions mv
       LEFT JOIN ordinances o ON o.id = mv.ordinance_id
       LEFT JOIN fare_matrix_entries e
              ON e.matrix_version_id = mv.id AND e.vehicle_type_id = $2
      WHERE mv.city_id = $1 AND mv.status = 'active'
      LIMIT 1`,
    [cityId, vehicleId],
  );
  if (!rows.length) return null;

  const matrix = rows[0];
  const routes = await db.query(
    `SELECT row_number, from_label, to_label, via, regular_fare,
            discounted_fare, remark, bidirectional
       FROM fare_matrix_routes
      WHERE matrix_version_id = $1 AND vehicle_type_id = $2
      ORDER BY row_number`,
    [matrix.matrix_id, vehicleId],
  );
  return { matrix, routes: routes.rows };
}

/**
 * Every rule that must hold before a matrix may become a seed.
 * Returns { ok, checks, context }.
 */
export async function validateSeed(db, { cityId, vehicleId }) {
  const checks = [];
  const context = await loadSeedContext(db, cityId, vehicleId);

  if (!context) {
    return {
      ok: false,
      checks: [
        check(
          'matrix.active',
          false,
          `No active fare matrix is published for ${cityId}.`,
        ),
      ],
      context: null,
    };
  }

  const { matrix, routes } = context;

  checks.push(
    check(
      'matrix.active',
      matrix.matrix_status === 'active',
      `Matrix version ${matrix.matrix_version} is ${matrix.matrix_status}.`,
    ),
  );

  checks.push(
    check(
      'vehicle.active',
      matrix.vehicle_active === true,
      matrix.vehicle_active
        ? `${vehicleId} is active in this matrix.`
        : `${vehicleId} has no active entry in this matrix.`,
    ),
  );

  checks.push(
    check(
      'ordinance.linked',
      Boolean(matrix.ordinance_id),
      matrix.ordinance_id
        ? `Backed by ${matrix.ordinance_number || 'the linked ordinance'}.`
        : 'The matrix names no ordinance, so no change can be justified.',
    ),
  );

  const ordinanceStatus = matrix.ordinance_status;
  checks.push(
    check(
      'ordinance.in_force',
      ordinanceStatus === 'enacted' || ordinanceStatus === 'amended',
      ordinanceStatus
        ? `Ordinance status is "${ordinanceStatus}".`
        : 'The linked ordinance is missing or has no status.',
    ),
  );

  const effective = matrix.effective_from || matrix.ordinance_effective_from;
  const effectiveOk =
    !effective || new Date(effective).getTime() <= Date.now() + 86_400_000;
  checks.push(
    check(
      'ordinance.effective',
      effectiveOk,
      effective
        ? `Effective from ${String(effective).slice(0, 10)}.`
        : 'No effective date is recorded.',
    ),
  );

  checks.push(
    check(
      'routes.present',
      routes.length > 0,
      `${routes.length} printed row${routes.length === 1 ? '' : 's'} in this matrix.`,
    ),
  );

  const seen = new Set();
  let duplicates = 0;
  for (const row of routes) {
    if (seen.has(row.row_number)) duplicates += 1;
    seen.add(row.row_number);
  }
  checks.push(
    check(
      'routes.unique',
      duplicates === 0,
      duplicates === 0
        ? 'Every row number appears once.'
        : `${duplicates} duplicate row number(s).`,
    ),
  );

  let badAmount = null;
  for (const row of routes) {
    const regular = Number(row.regular_fare);
    const discounted = Number(row.discounted_fare);
    if (!Number.isFinite(regular) || !Number.isFinite(discounted)) {
      badAmount = row.row_number;
      break;
    }
    if (regular < 0 || discounted < 0 || discounted > regular + MONEY_EPSILON) {
      badAmount = row.row_number;
      break;
    }
  }
  checks.push(
    check(
      'routes.amounts',
      badAmount === null,
      badAmount === null
        ? 'Every row prints a non-negative fare, discounted at or below regular.'
        : `Row ${badAmount} prints an impossible fare.`,
    ),
  );

  let discountMismatch = null;
  for (const row of routes) {
    const regular = Number(row.regular_fare);
    const discounted = Number(row.discounted_fare);
    const expected = Math.round(regular * (1 - DEFAULT_DISCOUNT_RATE) * 100) / 100;
    if (Math.abs(discounted - expected) > MONEY_EPSILON) {
      discountMismatch = row.row_number;
      break;
    }
  }
  checks.push(
    check(
      'discount.statutory',
      discountMismatch === null,
      discountMismatch === null
        ? 'Every discounted fare is exactly 20 % below its regular fare.'
        : `Row ${discountMismatch} does not apply the 20 % statutory discount.`,
    ),
  );

  // A closed table has no per-kilometre mechanism. If the ordinance publishes
  // zero, nothing may quietly introduce one.
  const rate = matrix.succeeding_km_rate;
  checks.push(
    check(
      'instrument.km_rate',
      rate === null ||
        rate === undefined ||
        Math.abs(Number(rate)) < MONEY_EPSILON,
      rate === null || rate === undefined
        ? 'The instrument publishes no per-kilometre rate.'
        : `Instrument per-km rate is ${Number(rate).toFixed(2)}.`,
    ),
  );

  // The active matrix must still match the newest ordinance that was actually
  // read from a document. An upload that has not been applied blocks compiling,
  // so a newer ordinance cannot be ignored quietly.
  const latestUpload = await db.query(
    `SELECT id, filename FROM ordinance_uploads
      WHERE city_id = $1 AND vehicle_type_id = $2
        AND status IN ('parsed', 'applied')
      ORDER BY uploaded_at DESC
      LIMIT 1`,
    [cityId, vehicleId],
  );
  if (latestUpload.rows.length) {
    const uploadedRows = await db.query(
      `SELECT row_number, to_label, regular FROM ordinance_rows WHERE upload_id = $1`,
      [latestUpload.rows[0].id],
    );
    const matrixByRow = new Map(routes.map((row) => [row.row_number, row]));
    let drift = 0;
    for (const row of uploadedRows.rows) {
      const current = matrixByRow.get(row.row_number);
      if (
        !current ||
        current.to_label !== row.to_label ||
        Math.abs(Number(current.regular_fare) - Number(row.regular)) > 0.011
      ) {
        drift += 1;
      }
    }
    checks.push(
      check(
        'ordinance.latest',
        drift === 0,
        drift === 0
          ? `The matrix matches the newest ordinance (${latestUpload.rows[0].filename}).`
          : `${drift} row(s) differ from ${latestUpload.rows[0].filename}; apply it before compiling.`,
      ),
    );
  }

  // Rows may not silently disappear between versions.
  const previous = await db.query(
    `SELECT id, version, payload
       FROM seed_artifacts
      WHERE city_id = $1 AND vehicle_type_id = $2
        AND status IN ('published', 'superseded')
      ORDER BY version DESC
      LIMIT 1`,
    [cityId, vehicleId],
  );

  // Is the published seed still the matrix on screen? Any edit since the last
  // compile shows up here, so a changed matrix can never look "already live".
  const published = await db.query(
    `SELECT id, version, payload
       FROM seed_artifacts
      WHERE city_id = $1 AND vehicle_type_id = $2 AND status = 'published'
      LIMIT 1`,
    [cityId, vehicleId],
  );
  if (published.rows.length) {
    const strip = (payload) => {
      const copy = { ...payload };
      delete copy.generatedAt;
      delete copy.sha256;
      delete copy.version;
      return copy;
    };
    const current = strip(
      buildPayload({
        cityId,
        vehicleId,
        version: published.rows[0].version,
        matrix,
        routes,
      }),
    );
    const live = strip(published.rows[0].payload);
    checks.push(
      check(
        'seed.up_to_date',
        canonicalJson(current) === canonicalJson(live),
        canonicalJson(current) === canonicalJson(live)
          ? `The matrix still matches published seed v${published.rows[0].version}.`
          : `The matrix has changed since seed v${published.rows[0].version}; compile and publish a new one.`,
        false,
      ),
    );
  }

  if (previous.rows.length) {
    const before = new Set(
      (previous.rows[0].payload.routes || []).map((row) => row.row),
    );
    const missing = [...before].filter((row) => !seen.has(row));
    checks.push(
      check(
        'routes.no_silent_drop',
        missing.length === 0,
        missing.length === 0
          ? `All ${before.size} rows from seed v${previous.rows[0].version} are still present.`
          : `Rows ${missing.join(', ')} disappeared since seed v${previous.rows[0].version}.`,
      ),
    );
  }

  return {
    ok: checks.every((item) => item.ok || item.blocking === false),
    checks,
    context,
  };
}

function buildPayload({ cityId, vehicleId, version, matrix, routes }) {
  return {
    schema: 'farefair.seed',
    schemaVersion: 1,
    cityId,
    vehicleId,
    version,
    matrixVersion: matrix.matrix_version,
    effectiveFrom: matrix.effective_from
      ? String(matrix.effective_from).slice(0, 10)
      : null,
    provisional: matrix.provisional === true,
    discountRate: DEFAULT_DISCOUNT_RATE,
    ordinance: {
      number: matrix.ordinance_number || '',
      title: matrix.ordinance_title || '',
      status: matrix.ordinance_status || '',
      effectiveFrom: matrix.ordinance_effective_from
        ? String(matrix.ordinance_effective_from).slice(0, 10)
        : null,
      baseFare: money(matrix.ordinance_base_fare),
      succeedingKmRate: money(matrix.succeeding_km_rate),
      discountTerms: matrix.discount_terms || '',
    },
    vehicle: {
      baseFare: money(matrix.base_fare),
      baseDistanceKm: money(matrix.base_distance_km),
      perKmRate: money(matrix.per_km_rate),
      minFare: money(matrix.min_fare),
      maxCustomary: money(matrix.max_customary),
      typicalCapacity: matrix.typical_capacity,
      regulationMatrix: matrix.regulation_matrix || '',
    },
    routes: routes.map((row) => ({
      row: row.row_number,
      from: row.from_label,
      to: row.to_label,
      via: row.via || '',
      regular: money(row.regular_fare),
      discounted: money(row.discounted_fare),
      remark: row.remark || '',
      bidirectional: row.bidirectional !== false,
    })),
    generatedAt: new Date().toISOString(),
  };
}

export async function compileSeed(db, { cityId, vehicleId, actor, reason }) {
  const validation = await validateSeed(db, { cityId, vehicleId });
  if (!validation.ok) {
    throw new ApiError(
      422,
      'SEED_INVALID',
      'The matrix does not satisfy the ordinance checks, so no seed was compiled.',
      { checks: validation.checks },
    );
  }

  return db.transaction(async (tx) => {
    const next = await tx.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS version
         FROM seed_artifacts WHERE city_id = $1 AND vehicle_type_id = $2`,
      [cityId, vehicleId],
    );
    const version = Number(next.rows[0].version);
    const payload = buildPayload({
      cityId,
      vehicleId,
      version,
      matrix: validation.context.matrix,
      routes: validation.context.routes,
    });
    const hash = sha256Hex(canonicalJson(payload));
    payload.sha256 = hash;

    const inserted = await tx.query(
      `INSERT INTO seed_artifacts
         (city_id, vehicle_type_id, matrix_version_id, ordinance_id, version,
          status, sha256, payload, validation, created_by)
       VALUES ($1,$2,$3,$4,$5,'draft',$6,$7::jsonb,$8::jsonb,$9)
       RETURNING id, city_id, vehicle_type_id, version, status, sha256,
                 created_at, published_at, validation`,
      [
        cityId,
        vehicleId,
        validation.context.matrix.matrix_id,
        validation.context.matrix.ordinance_id,
        version,
        hash,
        JSON.stringify(payload),
        JSON.stringify(validation.checks),
        actor?.id ?? null,
      ],
    );
    const artifact = inserted.rows[0];

    await tx.query(
      `INSERT INTO seed_events
         (artifact_id, action, actor_id, actor_name, reason)
       VALUES ($1, 'compile', $2, $3, $4)`,
      [artifact.id, actor?.id ?? null, actor?.displayName ?? 'System', reason],
    );

    await recordAudit(tx, {
      actorId: actor?.id,
      actorName: actor?.displayName,
      role: actor?.role,
      action: 'seed.compile',
      entityType: 'seed_artifact',
      entityId: artifact.id,
      cityId,
      reason,
      detail: {
        summary: `Compiled seed v${version} for ${cityId}/${vehicleId} (${hash.slice(0, 12)}…).`,
      },
      after: {
        id: artifact.id,
        version,
        sha256: hash,
        rows: payload.routes.length,
        matrixVersion: payload.matrixVersion,
      },
    });

    return { artifact, payload, checks: validation.checks };
  });
}

async function requireArtifact(db, seedId) {
  const { rows } = await db.query(
    `SELECT * FROM seed_artifacts WHERE id = $1`,
    [seedId],
  );
  if (!rows.length) {
    throw new ApiError(404, 'SEED_NOT_FOUND', 'That seed artifact does not exist.');
  }
  return rows[0];
}

async function repointPublished(tx, artifact, actor, reason, action) {
  const current = await tx.query(
    `SELECT id, version FROM seed_artifacts
      WHERE city_id = $1 AND vehicle_type_id = $2 AND status = 'published'
      LIMIT 1`,
    [artifact.city_id, artifact.vehicle_type_id],
  );
  const previousId = current.rows.length ? current.rows[0].id : null;

  if (previousId) {
    await tx.query(
      `UPDATE seed_artifacts SET status = 'superseded' WHERE id = $1`,
      [previousId],
    );
  }
  await tx.query(
    `UPDATE seed_artifacts
        SET status = 'published', published_at = now()
      WHERE id = $1`,
    [artifact.id],
  );
  await tx.query(
    `INSERT INTO seed_events
       (artifact_id, action, previous_artifact_id, actor_id, actor_name, reason)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      artifact.id,
      action,
      previousId,
      actor?.id ?? null,
      actor?.displayName ?? 'System',
      reason,
    ],
  );
  await recordAudit(tx, {
    actorId: actor?.id,
    actorName: actor?.displayName,
    role: actor?.role,
    action: action === 'rollback' ? 'seed.rollback' : 'seed.publish',
    entityType: 'seed_artifact',
    entityId: artifact.id,
    cityId: artifact.city_id,
    reason,
    before: previousId ? { publishedArtifactId: previousId } : null,
    after: {
      publishedArtifactId: artifact.id,
      version: artifact.version,
      sha256: artifact.sha256,
    },
    detail: {
      summary:
        action === 'rollback'
          ? `Rolled ${artifact.city_id}/${artifact.vehicle_type_id} back to seed v${artifact.version}.`
          : `Published ${artifact.city_id}/${artifact.vehicle_type_id} seed v${artifact.version}.`,
    },
  });
  return previousId;
}

export async function publishSeed(db, { seedId, actor, reason }) {
  return db.transaction(async (tx) => {
    const artifact = await requireArtifact(tx, seedId);
    if (artifact.status === 'published') {
      throw new ApiError(409, 'ALREADY_PUBLISHED', 'That seed is already published.');
    }
    if (artifact.status === 'revoked') {
      throw new ApiError(409, 'SEED_REVOKED', 'A revoked seed cannot be published.');
    }
    // Two-person rule, opt-in for LGU deployments: the account that compiled a
    // seed may not be the account that publishes it.
    if (
      process.env.SEED_REQUIRE_SECOND_APPROVER === '1' &&
      artifact.created_by &&
      actor?.id &&
      artifact.created_by === actor.id
    ) {
      throw new ApiError(
        409,
        'SELF_APPROVAL',
        'A different administrator must publish a seed this account compiled.',
      );
    }
    const previousId = await repointPublished(tx, artifact, actor, reason, 'publish');
    return { artifact: { ...artifact, status: 'published' }, previousArtifactId: previousId };
  });
}

export async function rollbackSeed(db, { seedId, actor, reason }) {
  return db.transaction(async (tx) => {
    const artifact = await requireArtifact(tx, seedId);
    if (artifact.status === 'published') {
      throw new ApiError(
        409,
        'ALREADY_PUBLISHED',
        'That seed is already the published one.',
      );
    }
    if (artifact.status === 'draft') {
      throw new ApiError(
        409,
        'NEVER_PUBLISHED',
        'Only a seed that was published before can be rolled back to.',
      );
    }
    const previousId = await repointPublished(tx, artifact, actor, reason, 'rollback');
    return { artifact: { ...artifact, status: 'published' }, previousArtifactId: previousId };
  });
}

export async function listSeeds(db, { cityId, vehicleId }) {
  const { rows } = await db.query(
    `SELECT a.id, a.city_id, a.vehicle_type_id, a.version, a.status, a.sha256,
            a.matrix_version_id, a.created_at, a.published_at,
            a.validation, a.created_by,
            u.display_name AS created_by_name,
            (SELECT COUNT(*)::int FROM seed_events e WHERE e.artifact_id = a.id)
              AS event_count
       FROM seed_artifacts a
       LEFT JOIN admin_users u ON u.id = a.created_by
      WHERE a.city_id = $1
        AND ($2::text IS NULL OR a.vehicle_type_id = $2)
      ORDER BY a.vehicle_type_id, a.version DESC`,
    [cityId, vehicleId ?? null],
  );
  const events = await db.query(
    `SELECT e.id, e.artifact_id, e.action, e.previous_artifact_id,
            e.actor_name, e.reason, e.occurred_at
       FROM seed_events e
       JOIN seed_artifacts a ON a.id = e.artifact_id
      WHERE a.city_id = $1
        AND ($2::text IS NULL OR a.vehicle_type_id = $2)
      ORDER BY e.occurred_at DESC
      LIMIT 100`,
    [cityId, vehicleId ?? null],
  );
  return { artifacts: rows, events: events.rows };
}
