// Ordinance ingestion: turn an uploaded DOCX/PDF into rows, compare them with
// the active matrix, and apply them to that matrix in one attributed action.
//
// The extraction is deliberately dumb and honest: DOCX tables are read exactly,
// a scanned PDF is reported as a scan instead of guessed at, and nothing is
// applied without an admin naming the action.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { ApiError } from '../lib/errors.js';
import { recordAudit } from '../lib/auth.js';
import { loadSeedContext, validateSeed } from './seed-service.js';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

function pythonBinary() {
  if (process.env.FAREFAIR_PYTHON) return process.env.FAREFAIR_PYTHON;
  const candidates = [
    path.join(repoRoot, 'ml', '.venv', 'Scripts', 'python.exe'),
    path.join(repoRoot, 'ml', '.venv', 'bin', 'python'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

async function extract(filePath) {
  const { stdout } = await run(pythonBinary(), [
    path.join(repoRoot, 'backend', 'tools', 'ordinance_extract.py'),
    filePath,
  ]);
  return JSON.parse(stdout);
}

function money(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function sameRow(a, b) {
  return (
    a.to_label === b.to_label &&
    Math.abs(Number(a.regular) - Number(b.regular)) < 0.011
  );
}

export async function diffAgainstMatrix(db, { cityId, vehicleId, rows }) {
  const context = await loadSeedContext(db, cityId, vehicleId);
  const matrix = new Map(
    (context?.routes ?? []).map((row) => [row.row_number, row]),
  );
  const uploaded = new Map(rows.map((row) => [row.row, row]));

  const changed = [];
  const missingInMatrix = [];
  const missingInOrdinance = [];
  let matched = 0;

  for (const [number, row] of uploaded) {
    const current = matrix.get(number);
    if (!current) {
      missingInMatrix.push({
        row: number,
        to: row.to,
        regular: money(row.regular),
      });
      continue;
    }
    const before = {
      row: number,
      to: current.to_label,
      regular: money(current.regular_fare),
      discounted: money(current.discounted_fare),
    };
    const after = {
      row: number,
      to: row.to,
      regular: money(row.regular),
      discounted: money(row.discounted),
    };
    if (sameRow({ to_label: current.to_label, regular: current.regular_fare }, {
      to_label: row.to,
      regular: row.regular,
    })) {
      matched += 1;
    } else {
      changed.push({ ...after, before });
    }
  }
  for (const number of matrix.keys()) {
    if (!uploaded.has(number)) missingInOrdinance.push(number);
  }

  return {
    matched,
    changed,
    missingInMatrix,
    missingInOrdinance,
    differs: changed.length > 0 || missingInMatrix.length > 0,
  };
}

export async function createOrdinanceUpload(
  db,
  { cityId, vehicleId, filename, buffer, actor },
) {
  if (!buffer || !buffer.length) {
    throw new ApiError(400, 'EMPTY_FILE', 'The uploaded file is empty.');
  }
  const extension = path.extname(filename || '').toLowerCase();
  if (extension !== '.docx' && extension !== '.pdf') {
    throw new ApiError(
      415,
      'UNSUPPORTED_FILE',
      'Upload the ordinance as .docx or .pdf.',
    );
  }

  const folder = await mkdtemp(path.join(tmpdir(), 'farefair-ordinance-'));
  const filePath = path.join(folder, `upload${extension}`);
  let parsed;
  try {
    await writeFile(filePath, buffer);
    parsed = await extract(filePath);
  } catch (error) {
    parsed = { kind: 'error', rows: [], warning: String(error?.message ?? error) };
  } finally {
    await rm(folder, { recursive: true, force: true }).catch(() => {});
  }

  const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
  const status =
    parsed.kind === 'pdf_ocr'
      ? 'ocr'
      : parsed.kind === 'scan'
        ? 'scan'
        : parsed.kind === 'error' || rows.length === 0
          ? 'error'
          : 'parsed';

  const diff = rows.length
    ? await diffAgainstMatrix(db, { cityId, vehicleId, rows })
    : { matched: 0, changed: [], missingInMatrix: [], missingInOrdinance: [], differs: false };

  const hash = createHash('sha256').update(buffer).digest('hex');
  const ocrPages = Array.isArray(parsed.ocr_pages) ? parsed.ocr_pages : [];

  return db.transaction(async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO ordinance_uploads
         (city_id, vehicle_type_id, filename, kind, sha256, bytes, pages,
          status, row_count, diff, ocr_text, warning, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13)
       RETURNING id, city_id, vehicle_type_id, filename, kind, sha256, bytes,
                 pages, status, row_count, diff, warning, uploaded_at`,
      [
        cityId,
        vehicleId,
        filename || '',
        parsed.kind || '',
        hash,
        buffer.length,
        parsed.pages ?? null,
        status,
        rows.length,
        JSON.stringify(diff),
        JSON.stringify(ocrPages),
        parsed.warning || '',
        actor?.id ?? null,
      ],
    );
    const upload = inserted.rows[0];

    for (const row of rows) {
      await tx.query(
        `INSERT INTO ordinance_rows
           (upload_id, row_number, from_label, to_label, regular, discounted, remark, page, confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          upload.id,
          row.row,
          row.from ?? '',
          row.to ?? '',
          money(row.regular) ?? 0,
          money(row.discounted),
          row.remark ?? '',
          row.page ?? null,
          row.confidence ?? null,
        ],
      );
    }

    await recordAudit(tx, {
      actorId: actor?.id,
      actorName: actor?.displayName,
      role: actor?.role,
      action: 'ordinance.upload',
      entityType: 'ordinance_upload',
      entityId: upload.id,
      cityId,
      detail: {
        summary:
          `Uploaded ${filename} (${parsed.kind}, ${rows.length} rows); ` +
          `${diff.changed.length} row(s) differ from the active matrix.`,
      },
      after: {
        status,
        rows: rows.length,
        changed: diff.changed.length,
        missingInMatrix: diff.missingInMatrix.length,
        sha256: hash,
      },
    });

    return { upload, rows, diff, ocrPages };
  });
}

export async function loadUpload(db, uploadId) {
  const upload = await db.query(
    `SELECT * FROM ordinance_uploads WHERE id = $1`,
    [uploadId],
  );
  if (!upload.rows.length) {
    throw new ApiError(404, 'UPLOAD_NOT_FOUND', 'That upload does not exist.');
  }
  const rows = await db.query(
    `SELECT row_number, from_label, to_label, regular, discounted, remark,
            page, confidence
       FROM ordinance_rows WHERE upload_id = $1 ORDER BY row_number`,
    [uploadId],
  );
  return { upload: upload.rows[0], rows: rows.rows };
}

export async function listUploads(db, { cityId, vehicleId }) {
  const { rows } = await db.query(
    `SELECT u.id, u.filename, u.kind, u.status, u.row_count, u.diff, u.warning,
            u.pages, u.uploaded_at, u.applied_at, a.display_name AS uploaded_by_name,
            jsonb_array_length(u.ocr_text) AS ocr_page_count
       FROM ordinance_uploads u
       LEFT JOIN admin_users a ON a.id = u.uploaded_by
      WHERE u.city_id = $1
        AND ($2::text IS NULL OR u.vehicle_type_id = $2)
      ORDER BY u.uploaded_at DESC
      LIMIT 25`,
    [cityId, vehicleId ?? null],
  );
  return rows;
}

export async function applyUpload(db, { uploadId, actor, reason, reviewedRows }) {
  const { upload, rows: storedRows } = await loadUpload(db, uploadId);
  if (upload.status === 'scan') {
    throw new ApiError(
      409,
      'UPLOAD_IS_A_SCAN',
      'This upload is a scan with no text layer, so it has no rows to apply.',
    );
  }

  let rows = storedRows.map((row) => ({
    row_number: row.row_number,
    from_label: row.from_label,
    to_label: row.to_label,
    regular: row.regular,
    discounted: row.discounted,
    remark: row.remark,
  }));

  if (upload.status === 'ocr') {
    // A scanned table is only applied from rows the admin has looked at.
    if (!Array.isArray(reviewedRows) || !reviewedRows.length) {
      throw new ApiError(
        409,
        'REVIEW_REQUIRED',
        'Confirm the OCR rows before applying them to the matrix.',
      );
    }
    rows = reviewedRows.map((row) => ({
      row_number: Number(row.row ?? row.row_number),
      from_label: String(row.from ?? row.from_label ?? ''),
      to_label: String(row.to ?? row.to_label ?? ''),
      regular: money(row.regular) ?? 0,
      discounted: money(row.discounted),
      remark: String(row.remark ?? ''),
    }));
  } else if (upload.status !== 'parsed') {
    throw new ApiError(
      409,
      'UPLOAD_NOT_APPLICABLE',
      'Only a parsed upload can be applied to the matrix.',
    );
  }

  if (rows.some((row) => !Number.isInteger(row.row_number) || row.row_number < 1)) {
    throw new ApiError(400, 'INVALID_ROWS', 'Every row needs a positive row number.');
  }

  const context = await loadSeedContext(db, upload.city_id, upload.vehicle_type_id);
  if (!context) {
    throw new ApiError(409, 'NO_ACTIVE_MATRIX', 'There is no active matrix to update.');
  }
  const matrixId = context.matrix.matrix_id;
  const matrixRows = new Map(
    context.routes.map((row) => [row.row_number, row]),
  );

  const before = [];
  const after = [];
  let updated = 0;
  let inserted = 0;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const current = matrixRows.get(row.row_number);
      if (current) {
        if (
          current.to_label === row.to_label &&
          Number(current.regular_fare) === Number(row.regular)
        ) {
          continue;
        }
        before.push({
          row: row.row_number,
          to: current.to_label,
          regular: money(current.regular_fare),
          discounted: money(current.discounted_fare),
        });
        after.push({
          row: row.row_number,
          to: row.to_label,
          regular: money(row.regular),
          discounted: money(row.discounted),
        });
        await tx.query(
          `UPDATE fare_matrix_routes
              SET from_label = $3, to_label = $4, regular_fare = $5,
                  discounted_fare = $6, remark = $7
            WHERE matrix_version_id = $1 AND vehicle_type_id = $2
              AND row_number = $8`,
          [
            matrixId,
            upload.vehicle_type_id,
            row.from_label,
            row.to_label,
            row.regular,
            row.discounted ?? Math.round(Number(row.regular) * 80) / 100,
            row.remark,
            row.row_number,
          ],
        );
        updated += 1;
      } else {
        await tx.query(
          `INSERT INTO fare_matrix_routes
             (matrix_version_id, vehicle_type_id, row_number, from_label,
              to_label, via, regular_fare, discounted_fare, remark, bidirectional)
           VALUES ($1,$2,$3,$4,$5,'',$6,$7,$8,TRUE)`,
          [
            matrixId,
            upload.vehicle_type_id,
            row.row_number,
            row.from_label,
            row.to_label,
            row.regular,
            row.discounted ?? Math.round(Number(row.regular) * 80) / 100,
            row.remark,
          ],
        );
        after.push({
          row: row.row_number,
          to: row.to_label,
          regular: money(row.regular),
          inserted: true,
        });
        inserted += 1;
      }
    }

    await tx.query(
      `UPDATE ordinance_uploads
          SET status = 'applied', applied_at = now(), applied_by = $2
        WHERE id = $1`,
      [uploadId, actor?.id ?? null],
    );

    await recordAudit(tx, {
      actorId: actor?.id,
      actorName: actor?.displayName,
      role: actor?.role,
      action: 'ordinance.apply',
      entityType: 'ordinance_upload',
      entityId: uploadId,
      cityId: upload.city_id,
      reason,
      before: before.slice(0, 200),
      after: after.slice(0, 200),
      detail: {
        summary:
          `Applied ${upload.filename} to the active matrix: ` +
          `${updated} row(s) updated, ${inserted} inserted.`,
        updated,
        inserted,
      },
    });
  });

  const validation = await validateSeed(db, {
    cityId: upload.city_id,
    vehicleId: upload.vehicle_type_id,
  });

  return { updated, inserted, before, after, validation };
}
