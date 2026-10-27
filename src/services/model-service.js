import { createHash } from 'node:crypto';

import { ApiError } from '../lib/errors.js';
import {
  FEATURE_NAMES,
  computeMetrics,
  fitLinearRegression,
  predictWithCoefficients,
} from '../lib/ml.js';
import { asJson, serializeModelVersion } from '../lib/serialize.js';

export const DEFAULT_MODEL_KEY = 'fare-fair-linear';

export async function trainFareModel(
  db,
  { modelKey = DEFAULT_MODEL_KEY, activate = true, actorName = 'API', role = 'system' } = {},
) {
  const modelResult = await db.query(
    `SELECT * FROM ml_models WHERE model_key = $1`,
    [modelKey],
  );
  const model =
    modelResult.rows[0] ??
    (
      await db.query(
        `INSERT INTO ml_models (model_key, name, task, target, description)
         VALUES ($1,$2,'fare_regression'::model_task,'exact_fare',$3)
         RETURNING *`,
        [
          modelKey,
          'FareFair Fare Regressor',
          'Ridge linear regression over engineered fare-matrix features.',
        ],
      )
    ).rows[0];

  const sampleResult = await db.query(
    `SELECT features, label_fare, split
     FROM ml_training_samples
     ORDER BY created_at`,
  );
  const samples = sampleResult.rows.map((row) => ({
    features: asJson(row.features) ?? {},
    label: Number(row.label_fare),
    split: row.split,
  }));

  const trainSamples = samples.filter((sample) => sample.split === 'train');
  const validationSamples = samples.filter(
    (sample) => sample.split === 'validation',
  );
  const testSamples = samples.filter((sample) => sample.split === 'test');

  if (trainSamples.length < 10) {
    throw new ApiError(
      422,
      'INSUFFICIENT_TRAINING_DATA',
      `At least 10 training samples are required; found ${trainSamples.length}.`,
    );
  }

  const fitted = fitLinearRegression(trainSamples);
  const metrics = {
    train: computeMetrics(trainSamples, fitted.coefficients),
    validation: computeMetrics(validationSamples, fitted.coefficients),
    test: computeMetrics(testSamples, fitted.coefficients),
  };

  const nextVersionResult = await db.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
     FROM ml_model_versions WHERE model_id = $1`,
    [model.id],
  );
  const nextVersion = Number(nextVersionResult.rows[0].next_version);
  const checksum = createHash('sha256')
    .update(JSON.stringify(fitted.coefficients))
    .digest('hex');

  const outcome = await db.transaction(async (tx) => {
    if (activate) {
      await tx.query(
        `UPDATE ml_model_versions
         SET status = 'retired'
         WHERE model_id = $1 AND status = 'active'`,
        [model.id],
      );
    }

    const insert = await tx.query(
      `INSERT INTO ml_model_versions
        (model_id, version, status, algorithm, feature_names, coefficients,
         hyperparameters, metrics, residual_stddev, training_rows,
         trained_at, activated_at, artifact_uri, checksum)
       VALUES ($1,$2,$3::model_status,$4,$5::text[],$6::jsonb,$7::jsonb,
               $8::jsonb,$9,$10,now(),$11,'inline://coefficients',$12)
       RETURNING *`,
      [
        model.id,
        nextVersion,
        activate ? 'active' : 'candidate',
        fitted.algorithm,
        `{${FEATURE_NAMES.join(',')}}`,
        JSON.stringify(fitted.coefficients),
        JSON.stringify({
          ridge: 1e-6,
          featureSet: 'fare-fair-v1',
          trainRows: trainSamples.length,
          validationRows: validationSamples.length,
          testRows: testSamples.length,
        }),
        JSON.stringify(metrics),
        fitted.residualStddev,
        trainSamples.length,
        activate ? new Date().toISOString() : null,
        checksum,
      ],
    );

    await tx.query(
      `INSERT INTO audit_events
        (actor_name, role, action, entity_type, entity_id, detail)
       VALUES ($1,$2,'ml_model.trained','ml_model_version',$3,$4::jsonb)`,
      [
        actorName,
        role,
        insert.rows[0].id,
        JSON.stringify({
          modelKey,
          version: nextVersion,
          rows: trainSamples.length,
          metrics,
          activated: activate,
        }),
      ],
    );

    return insert.rows[0];
  });

  return serializeModelVersion({
    ...outcome,
    model_key: model.model_key,
    name: model.name,
    task: model.task,
    target: model.target,
  });
}

export async function activateModelVersion(
  db,
  versionId,
  { actorName = 'API', role = 'system' } = {},
) {
  const result = await db.query(
    `SELECT v.*, m.model_key, m.name, m.task, m.target
     FROM ml_model_versions v
     JOIN ml_models m ON m.id = v.model_id
     WHERE v.id = $1`,
    [versionId],
  );
  const version = result.rows[0];
  if (!version) {
    throw new ApiError(404, 'NOT_FOUND', 'Model version not found.');
  }

  await db.transaction(async (tx) => {
    await tx.query(
      `UPDATE ml_model_versions
       SET status = 'retired'
       WHERE model_id = $1 AND status = 'active' AND id <> $2`,
      [version.model_id, versionId],
    );
    await tx.query(
      `UPDATE ml_model_versions
       SET status = 'active', activated_at = now()
       WHERE id = $1`,
      [versionId],
    );
    await tx.query(
      `INSERT INTO audit_events
        (actor_name, role, action, entity_type, entity_id, detail)
       VALUES ($1,$2,'ml_model.activated','ml_model_version',$3,$4::jsonb)`,
      [
        actorName,
        role,
        versionId,
        JSON.stringify({
          modelKey: version.model_key,
          version: version.version,
        }),
      ],
    );
  });

  return serializeModelVersion({
    ...version,
    status: 'active',
    activated_at: new Date().toISOString(),
  });
}

export function predictWithModel(coefficients, features) {
  return predictWithCoefficients(coefficients, features);
}
