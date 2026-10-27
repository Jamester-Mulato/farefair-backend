import 'dotenv/config';

import { createDatabase } from '../db.js';
import { trainFareModel } from '../services/model-service.js';

const db = await createDatabase();

try {
  const version = await trainFareModel(db, {
    modelKey: process.env.MODEL_KEY ?? 'fare-fair-linear',
    activate: true,
    actorName: 'CLI',
    role: 'system',
  });
  console.log(
    JSON.stringify(
      {
        id: version.id,
        modelKey: version.modelKey,
        version: version.version,
        status: version.status,
        trainingRows: version.trainingRows,
        residualStddev: version.residualStddev,
        metrics: version.metrics,
        coefficients: version.coefficients,
      },
      null,
      2,
    ),
  );
} finally {
  await db.close();
}
