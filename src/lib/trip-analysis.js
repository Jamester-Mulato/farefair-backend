/**
 * Deterministic trip analysis.
 *
 * The analysis answers one question per recorded trip: is this record
 * internally consistent, and does its stored fare sit inside the band the
 * published matrix produced? It never computes a fare. `fare.estimate` and the
 * band come from the stored trip row, which was written by fn_calculate_fare.
 *
 * Everything here is pure and reproducible: same trip in, same packet out. The
 * optional language-model layer may only rephrase and rank these findings; it
 * cannot add a number that is not already in the packet (see
 * `validateNarrative`).
 */

export const FINDING_CODES = {
  gps_missing: 'No GPS breadcrumbs',
  gps_sparse: 'Too few GPS breadcrumbs',
  gps_gap: 'GPS gap in the trail',
  gps_speed: 'Implausible travel speed',
  path_short: 'Recorded path is shorter than the route',
  path_detour: 'Recorded path is much longer than the route',
  fare_out_of_band: 'Fare outside the published band',
  unpublished_pair: 'No published row for this pair',
  prediction_drift: 'Model prediction disagrees with the matrix',
  duration_zero: 'Zero recorded duration',
  open_anomaly: 'Anomaly still open',
  discount_applied: 'Statutory discount applied',
};

export const RISK_ORDER = ['clear', 'watch', 'review', 'serious'];

export const ACTIONS = [
  'none',
  'monitor',
  'verify_record',
  'contact_operator',
  'escalate',
];

const GAP_METERS = 400;
const SPARSE_POINTS = 4;

/**
 * Build the analysis packet from a serialized trip detail.
 * Pure function: no database, no clock, no randomness.
 */
export function analyzeFacts(detail) {
  const points = Array.isArray(detail.points) ? detail.points : [];
  const fare = detail.fare || {};
  const anomalies = Array.isArray(detail.anomalies) ? detail.anomalies : [];
  const predictions = Array.isArray(detail.predictions) ? detail.predictions : [];

  const estimate = number(fare.exact);
  const rangeMin = number(fare.min);
  const rangeMax = number(fare.max);

  const gps = gpsFacts(points, detail.distanceKm, detail.durationMinutes);
  const prediction = predictions[0]
    ? {
        modelKey: predictions[0].modelKey,
        predictedFare: number(predictions[0].predictedFare),
        lowerBound: number(predictions[0].lowerBound),
        upperBound: number(predictions[0].upperBound),
        confidence: number(predictions[0].confidence),
      }
    : null;

  return {
    trip: {
      reference: detail.reference,
      cityId: detail.cityId,
      cityName: detail.cityName,
      vehicleId: detail.vehicleId,
      vehicleName: detail.vehicleName,
      origin: detail.origin,
      destination: detail.destination,
      distanceKm: number(detail.distanceKm),
      durationMinutes: number(detail.durationMinutes),
      passengers: number(detail.passengers),
      pakyaw: Boolean(detail.pakyaw),
      discountCode: detail.discountCode || 'none',
      status: detail.status,
      flagReason: detail.flagReason || '',
      recordedVia: detail.recordedVia,
      recordedAt: detail.recordedAt,
    },
    fare: {
      currency: fare.currency || 'PHP',
      estimate,
      rangeMin,
      rangeMax,
      bandWidth: round(rangeMax - rangeMin, 2),
      source: detail.fareSource || 'distance_matrix',
      routeRow: detail.routeRowNumber ?? null,
      published: detail.fareSource === 'official_matrix',
      aboveBand: estimate > rangeMax + 0.005,
      belowBand: estimate < rangeMin - 0.005,
    },
    gps,
    anomalies: anomalies.map((row) => ({
      kind: row.kind,
      severity: row.severity,
      detail: row.detail,
      resolvedAt: row.resolvedAt || null,
    })),
    prediction,
  };
}

/**
 * Rule-based findings. These are authoritative: a language model may rank them
 * but cannot remove them.
 */
export function baselineFindings(facts) {
  const findings = [];
  const { gps, fare, trip, anomalies, prediction } = facts;

  if (!gps.hasBreadcrumbs) {
    findings.push(
      finding(
        'gps_missing',
        'low',
        'This trip was priced without a breadcrumb trail, so the distance cannot be checked against a recorded path.',
        [['gps.points', gps.points]],
      ),
    );
  } else {
    if (gps.points < SPARSE_POINTS) {
      findings.push(
        finding(
          'gps_sparse',
          'low',
          `Only ${gps.points} breadcrumb${gps.points === 1 ? '' : 's'} were stored; a usable trail needs at least ${SPARSE_POINTS}.`,
          [['gps.points', gps.points]],
        ),
      );
    }
    if (gps.maxGapMeters >= GAP_METERS) {
      const severity = gps.maxGapMeters >= 2000 ? 'high' : 'medium';
      findings.push(
        finding(
          'gps_gap',
          severity,
          `Largest jump between consecutive breadcrumbs is ${Math.round(gps.maxGapMeters)} m, above the ${GAP_METERS} m threshold.`,
          [
            ['gps.maxGapMeters', gps.maxGapMeters],
            ['gps.gapsOver400m', gps.gapsOver400m],
          ],
        ),
      );
    }
    if (gps.maxSpeedKph !== null && gps.maxSpeedKph > 90) {
      const severity = gps.maxSpeedKph > 120 ? 'high' : 'medium';
      findings.push(
        finding(
          'gps_speed',
          severity,
          `Fastest bracketed speed is ${round(gps.maxSpeedKph, 1)} km/h, which an informal transit trip inside a city does not reach.`,
          [['gps.maxSpeedKph', gps.maxSpeedKph]],
        ),
      );
    } else if (gps.avgSpeedKph !== null && gps.avgSpeedKph > 60) {
      findings.push(
        finding(
          'gps_speed',
          'medium',
          `Average speed is ${round(gps.avgSpeedKph, 1)} km/h, above the 60 km/h ceiling used by the anomaly rules.`,
          [['gps.avgSpeedKph', gps.avgSpeedKph]],
        ),
      );
    }
    if (trip.distanceKm >= 1 && gps.pathKm > 0 && gps.pathKm < trip.distanceKm * 0.4) {
      findings.push(
        finding(
          'path_short',
          'medium',
          `The stored trail covers ${round(gps.pathKm, 2)} km against a declared ${round(trip.distanceKm, 2)} km route, so the breadcrumbs do not support the distance that was priced.`,
          [
            ['gps.pathKm', gps.pathKm],
            ['trip.distanceKm', trip.distanceKm],
          ],
        ),
      );
    }
    if (gps.detourRatio !== null && gps.detourRatio > 2.5) {
      findings.push(
        finding(
          'path_detour',
          'medium',
          `The trail is ${round(gps.detourRatio, 2)} times the straight-line distance, which suggests a detour or GPS drift.`,
          [
            ['gps.detourRatio', gps.detourRatio],
            ['gps.pathKm', gps.pathKm],
            ['gps.straightKm', gps.straightKm],
          ],
        ),
      );
    }
  }

  if (trip.durationMinutes === 0) {
    findings.push(
      finding(
        'duration_zero',
        'low',
        'The trip records a zero duration, so speed and travel-time checks cannot run.',
        [['trip.durationMinutes', 0]],
      ),
    );
  }

  if (fare.aboveBand) {
    findings.push(
      finding(
        'fare_out_of_band',
        'high',
        `The stored estimate of ${money(fare.estimate)} is above the published ceiling of ${money(fare.rangeMax)}.`,
        [
          ['fare.estimate', fare.estimate],
          ['fare.rangeMax', fare.rangeMax],
        ],
      ),
    );
  } else if (fare.belowBand) {
    findings.push(
      finding(
        'fare_out_of_band',
        'high',
        `The stored estimate of ${money(fare.estimate)} is below the published floor of ${money(fare.rangeMin)}.`,
        [
          ['fare.estimate', fare.estimate],
          ['fare.rangeMin', fare.rangeMin],
        ],
      ),
    );
  }

  if (!fare.published) {
    findings.push(
      finding(
        'unpublished_pair',
        'low',
        'No published fare row covers this origin and destination, so the amount came from the distance engine rather than the official table.',
        [['fare.source', fare.source]],
      ),
    );
  }

  if (prediction && fare.estimate > 0) {
    const drift = Math.abs(prediction.predictedFare - fare.estimate) / fare.estimate;
    if (drift > 0.1) {
      findings.push(
        finding(
          'prediction_drift',
          'low',
          `The analytics baseline predicts ${money(prediction.predictedFare)} against the matrix amount of ${money(fare.estimate)}.`,
          [
            ['prediction.predictedFare', prediction.predictedFare],
            ['fare.estimate', fare.estimate],
          ],
        ),
      );
    }
  }

  for (const anomaly of anomalies) {
    if (anomaly.resolvedAt) continue;
    findings.push(
      finding(
        'open_anomaly',
        anomaly.severity === 'high' ? 'high' : anomaly.severity || 'medium',
        anomaly.detail || `Open ${String(anomaly.kind).replace(/_/g, ' ')} anomaly.`,
        [['anomalies', anomalies.length]],
      ),
    );
  }

  if (trip.discountCode !== 'none') {
    findings.push(
      finding(
        'discount_applied',
        'low',
        `A statutory 20% discount (${trip.discountCode}) is applied in the stored amount.`,
        [['trip.discountCode', trip.discountCode]],
      ),
    );
  }

  return findings;
}

export function riskFromFindings(findings) {
  const acted = findings.filter((row) => !row.informational);
  if (acted.some((row) => row.severity === 'high')) return 'serious';
  const medium = acted.filter((row) => row.severity === 'medium').length;
  if (medium >= 1) return 'review';
  if (acted.length) return 'watch';
  return 'clear';
}

export function maxRisk(a, b) {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

export function actionForRisk(risk) {
  return {
    serious: 'escalate',
    review: 'verify_record',
    watch: 'monitor',
    clear: 'none',
  }[risk] || 'monitor';
}

/**
 * How much of this verdict rests on complete data. Deterministic, so the UI can
 * show the same number whether or not a language model is configured.
 */
export function confidenceFromFacts(facts) {
  let value = 0.55;
  if (facts.gps.points >= 8) value += 0.15;
  if (facts.gps.hasBreadcrumbs) value += 0.05;
  if (facts.fare.published) value += 0.1;
  if (!facts.anomalies.some((row) => !row.resolvedAt)) value += 0.05;
  return Math.min(0.9, round(value, 2));
}

export function baselineNarrative(facts, findings, risk) {
  const acted = findings.filter((row) => row.code !== 'discount_applied');
  const fareLine = facts.fare.published
    ? `The amount of ${money(facts.fare.estimate)} matches published row ${facts.fare.routeRow}.`
    : `The amount of ${money(facts.fare.estimate)} came from the distance engine; no published row covers this pair.`;
  const headline = acted.length
    ? acted[0].detail
    : 'The record is consistent: the amount sits inside the published band and the breadcrumb trail is continuous.';
  const summary = acted.length
    ? `${acted.length} finding${acted.length === 1 ? '' : 's'} on this record. ${acted[0].detail}`
    : `No rule fired. ${fareLine}`;
  return {
    headline,
    summary,
    risk,
    priorities: acted.slice(0, 3).map((row) => row.code),
    recommendedAction: actionForRisk(risk),
    checks: acted.slice(0, 3).map((row) => `Verify ${row.label.toLowerCase()}.`),
  };
}

/**
 * Accept a model narrative only if it is structurally valid and every number it
 * writes already exists in the deterministic packet or its findings. Anything
 * else is rejected, and the caller keeps the rule-based narrative.
 */
export function validateNarrative(raw, facts, findings) {
  const problems = [];
  const value = raw && typeof raw === 'object' ? raw : {};

  const headline = clampText(value.headline, 240);
  const summary = clampText(value.summary, 700);
  if (!headline) problems.push('headline is missing');
  if (!summary) problems.push('summary is missing');

  const risk = String(value.risk || '');
  if (!RISK_ORDER.includes(risk)) problems.push(`unknown risk "${risk}"`);

  const action = String(value.recommendedAction || '');
  if (!ACTIONS.includes(action)) problems.push(`unknown action "${action}"`);

  const codes = new Set(findings.map((row) => row.code));
  const priorities = Array.isArray(value.priorities)
    ? value.priorities.filter((code) => codes.has(code)).slice(0, 5)
    : [];

  const checks = Array.isArray(value.checks)
    ? value.checks
        .map((item) => clampText(item, 140))
        .filter(Boolean)
        .slice(0, 4)
    : [];

  const allowed = allowedNumbers(facts, findings);
  for (const text of [headline, summary, ...checks]) {
    for (const token of numbersIn(text)) {
      if (!allowed.some((candidate) => Math.abs(candidate - token) <= 0.51)) {
        problems.push(`number ${token} is not in the trip record`);
      }
    }
  }

  if (problems.length) {
    return { ok: false, reason: problems.slice(0, 3).join('; '), value: null };
  }
  return {
    ok: true,
    reason: null,
    value: { headline, summary, risk, priorities, recommendedAction: action, checks },
  };
}

/** Every numeric leaf in the packet plus every number in the rule findings. */
export function allowedNumbers(facts, findings) {
  const numbers = [];
  walk(facts, (leaf) => {
    if (typeof leaf === 'number' && Number.isFinite(leaf)) numbers.push(leaf);
  });
  for (const row of findings) {
    for (const token of numbersIn(row.detail)) numbers.push(token);
    for (const evidence of row.evidence || []) {
      if (typeof evidence.value === 'number') numbers.push(evidence.value);
    }
  }
  return numbers;
}

function walk(value, visit) {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (typeof value === 'object') {
    for (const key of Object.keys(value)) walk(value[key], visit);
    return;
  }
  visit(value);
}

function numbersIn(text) {
  const found = String(text || '').match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
  return found
    .map((token) => Number(token.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
}

function clampText(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function finding(code, severity, detail, evidence) {
  return {
    code,
    label: FINDING_CODES[code] || code,
    severity,
    detail,
    // A statutory discount is a note, not a problem: it is displayed but never
    // raises the risk level (the Dart engine mirrors this).
    informational: code === 'discount_applied',
    evidence: evidence.map(([path, value]) => ({ path, value })),
  };
}

function gpsFacts(points, distanceKm, durationMinutes) {
  const usable = points.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lng),
  );
  if (usable.length < 2) {
    return {
      points: usable.length,
      hasBreadcrumbs: usable.length > 0,
      pathKm: 0,
      straightKm: 0,
      detourRatio: null,
      maxGapMeters: 0,
      gapsOver400m: 0,
      avgSpeedKph: null,
      maxSpeedKph: null,
      spanMinutes: 0,
    };
  }

  let pathMeters = 0;
  let maxGap = 0;
  let gaps = 0;
  let maxSpeed = 0;
  let totalSeconds = 0;

  for (let index = 1; index < usable.length; index += 1) {
    const previous = usable[index - 1];
    const current = usable[index];
    const meters = haversine(previous, current);
    pathMeters += meters;
    if (meters > maxGap) maxGap = meters;
    if (meters > GAP_METERS) gaps += 1;

    const seconds = secondsBetween(previous.recordedAt, current.recordedAt);
    if (seconds !== null) {
      totalSeconds += seconds;
      if (seconds >= 3) {
        const kph = (meters / 1000) / (seconds / 3600);
        if (kph > maxSpeed) maxSpeed = kph;
      }
    }
  }

  const straightMeters = haversine(usable[0], usable[usable.length - 1]);
  const spanMinutes =
    totalSeconds > 0
      ? totalSeconds / 60
      : Number.isFinite(durationMinutes)
        ? durationMinutes
        : 0;

  return {
    points: usable.length,
    hasBreadcrumbs: true,
    pathKm: round(pathMeters / 1000, 2),
    straightKm: round(straightMeters / 1000, 2),
    detourRatio:
      straightMeters > 100 ? round(pathMeters / straightMeters, 2) : null,
    maxGapMeters: Math.round(maxGap),
    gapsOver400m: gaps,
    avgSpeedKph:
      spanMinutes > 0 && pathMeters > 0
        ? round(pathMeters / 1000 / (spanMinutes / 60), 1)
        : null,
    maxSpeedKph: maxSpeed > 0 ? round(maxSpeed, 1) : null,
    spanMinutes: round(spanMinutes, 1),
    declaredDistanceKm: number(distanceKm),
  };
}

function haversine(a, b) {
  const radius = 6371000;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function secondsBetween(from, to) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const seconds = (end - start) / 1000;
  return seconds >= 0 ? seconds : null;
}

function money(value) {
  return `${number(value).toFixed(2)} PHP`;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
