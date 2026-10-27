/**
 * Tiny, dependency-free linear regression used by the fare model trainer.
 *
 * Features are engineered so the statutory fare formula is representable as
 * a linear combination:
 *
 *   fare = (base_fare + billable_km * per_km_rate) * seat_units * (1 - d * r)
 *
 * Expanded:
 *   fare = base_fare_x_seat
 *        + per_km_x_distance_x_seat
 *        - r * discount_x_base_x_seat
 *        - r * discount_x_per_km_distance_x_seat
 *
 * Ridge regularisation keeps collinear/noisy coefficients stable.
 */

export const FEATURE_NAMES = [
  'distance_km',
  'passengers',
  'seat_units',
  'base_fare',
  'per_km_rate',
  'billable_distance_km',
  'base_fare_x_seat',
  'per_km_x_distance_x_seat',
  'discount',
  'discount_x_base_x_seat',
  'discount_x_per_km_distance_x_seat',
];

export function buildFeatures({
  distanceKm,
  passengers,
  seatUnits,
  baseFare,
  perKmRate,
  distanceComponent,
  discountCode,
}) {
  const discount = discountCode && discountCode !== 'none' ? 1 : 0;
  const billableDistanceKm = perKmRate === 0 ? 0 : distanceComponent / perKmRate;
  return {
    distance_km: Number(distanceKm),
    passengers: Number(passengers),
    seat_units: Number(seatUnits),
    base_fare: Number(baseFare),
    per_km_rate: Number(perKmRate),
    billable_distance_km: Number(billableDistanceKm),
    base_fare_x_seat: Number(baseFare) * Number(seatUnits),
    per_km_x_distance_x_seat: Number(distanceComponent) * Number(seatUnits),
    discount,
    discount_x_base_x_seat: discount * Number(baseFare) * Number(seatUnits),
    discount_x_per_km_distance_x_seat:
      discount * Number(distanceComponent) * Number(seatUnits),
  };
}

export function featuresToVector(features) {
  return FEATURE_NAMES.map((name) => {
    const value = Number(features?.[name] ?? 0);
    return Number.isFinite(value) ? value : 0;
  });
}

/**
 * Fit y = intercept + sum(coef_i * x_i) with ridge regularisation.
 * Returns { coefficients: {intercept, ...}, residualStddev }.
 */
export function fitLinearRegression(samples, { ridge = 1e-6 } = {}) {
  if (!samples.length) {
    throw new Error('Cannot fit a model with zero samples');
  }

  const width = FEATURE_NAMES.length + 1; // + intercept
  const xtx = Array.from({ length: width }, () => new Array(width).fill(0));
  const xty = new Array(width).fill(0);

  for (const sample of samples) {
    const x = [1, ...featuresToVector(sample.features)];
    const y = Number(sample.label);
    for (let i = 0; i < width; i += 1) {
      xty[i] += x[i] * y;
      for (let j = 0; j < width; j += 1) {
        xtx[i][j] += x[i] * x[j];
      }
    }
  }

  // Do not regularise the intercept.
  for (let i = 1; i < width; i += 1) {
    xtx[i][i] += ridge;
  }

  const beta = solveLinearSystem(xtx, xty);
  const coefficients = { intercept: beta[0] };
  FEATURE_NAMES.forEach((name, index) => {
    coefficients[name] = beta[index + 1];
  });

  let squaredError = 0;
  for (const sample of samples) {
    const predicted = predictWithCoefficients(coefficients, sample.features);
    squaredError += (Number(sample.label) - predicted) ** 2;
  }
  const residualStddev = Math.sqrt(squaredError / samples.length);

  return {
    coefficients,
    residualStddev,
    featureNames: [...FEATURE_NAMES],
    algorithm: 'ordinary_least_squares_ridge',
  };
}

export function predictWithCoefficients(coefficients, features) {
  let value = Number(coefficients?.intercept ?? 0);
  const vector = featuresToVector(features);
  FEATURE_NAMES.forEach((name, index) => {
    value += Number(coefficients?.[name] ?? 0) * vector[index];
  });
  return value;
}

export function computeMetrics(samples, coefficients) {
  if (!samples.length) {
    return { rows: 0, mae: null, rmse: null, r2: null };
  }
  let absoluteError = 0;
  let squaredError = 0;
  let sum = 0;
  const labels = samples.map((sample) => Number(sample.label));
  labels.forEach((label) => {
    sum += label;
  });
  const mean = sum / labels.length;
  let totalSumSquares = 0;

  samples.forEach((sample, index) => {
    const predicted = predictWithCoefficients(coefficients, sample.features);
    const residual = labels[index] - predicted;
    absoluteError += Math.abs(residual);
    squaredError += residual ** 2;
    totalSumSquares += (labels[index] - mean) ** 2;
  });

  return {
    rows: samples.length,
    mae: round(absoluteError / samples.length),
    rmse: round(Math.sqrt(squaredError / samples.length)),
    r2: totalSumSquares === 0 ? 1 : round(1 - squaredError / totalSumSquares),
  };
}

export function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);

  for (let column = 0; column < n; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < n; row += 1) {
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    }
    if (Math.abs(a[pivot][column]) < 1e-12) {
      continue;
    }
    [a[column], a[pivot]] = [a[pivot], a[column]];

    const divisor = a[column][column];
    for (let j = column; j <= n; j += 1) {
      a[column][j] /= divisor;
    }
    for (let row = 0; row < n; row += 1) {
      if (row === column) continue;
      const factor = a[row][column];
      if (factor === 0) continue;
      for (let j = column; j <= n; j += 1) {
        a[row][j] -= factor * a[column][j];
      }
    }
  }

  return a.map((row) => row[n]);
}
