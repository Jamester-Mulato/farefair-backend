/**
 * Overcharge analysis orchestration.
 *
 * Reads the trip, rebuilds the amount the published matrix requires, compares it
 * with what the passenger actually paid, and (optionally) asks a language model
 * to explain the gap in detail.
 *
 * The model never sees a blank canvas: it receives the computed verdict, the
 * ranked hypotheses and the printed rows. It may only choose among those
 * hypotheses and describe them. Anything else is rejected and the deterministic
 * explanation is returned instead.
 */

import { buildOfficialFare, lookupOfficialFare } from '../lib/fare.js';
import { dateOnly, money } from '../lib/serialize.js';
import {
  HYPOTHESES,
  STATUS,
  assessOvercharge,
  baselineExplanation,
  validateExplanation,
} from '../lib/overcharge.js';
import { completeJson, disabledReason, llmSettings } from './llm.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

const SYSTEM_PROMPT = [
  'You are a fare-compliance analyst for FareFair, a Philippine public-transport fare reference.',
  'You receive one JSON packet describing a recorded trip, the fare the published matrix requires, the amount the passenger actually paid, and a ranked list of hypotheses explaining the gap.',
  '',
  'Hard rules:',
  '- The packet is the only source of truth. Never add fares, laws, places, operators or people.',
  '- Never re-price the trip. The expected amount is already computed from the published row; do not recalculate it.',
  '- Never state a number that is not already present in the packet.',
  '- Explain only the listed hypotheses. You may rank and combine them; you may not invent a new cause code.',
  '- Do not decide whether a driver broke a law, and do not speculate about intent.',
  '- If the status is "not_covered" or "contract", say plainly that no printed row applies and that the amount cannot be judged from the matrix.',
  '- Write for a Filipino commuter: short sentences, no jargon, no legalese.',
  '- Reply with a single JSON object and nothing else.',
].join('\n');

/**
 * @param {object} db
 * @param {object} detail  serialized trip detail (see serializeTrip)
 * @param {object} options { paid, settings, env, fetchImpl, disableLlm }
 */
export async function analyzeOvercharge(db, detail, options = {}) {
  const paid = Number(options.paid);
  if (!Number.isFinite(paid) || paid < 0) {
    throw new Error('paid must be a non-negative amount');
  }

  const context = await loadContext(db, detail);
  const rows = await loadRows(db, context, detail.vehicleId);

  // A direct hire is a contract trip. The ordinance prints per-passenger rows
  // and no pakyaw ceiling, so there is no printed amount to compare with.
  const expected =
    context.official && !detail.pakyaw
      ? expectedFromOfficial(context.official, detail)
      : null;

  const policy = context.policy
    ? {
        discountRate: Number(context.policy.discount_rate),
        leeway: Number(context.policy.customary_leeway_max) || 0,
        pakyawSeatCap: Number(context.policy.pakyaw_seat_cap),
      }
    : {};

  const result = assessOvercharge({
    trip: {
      origin: detail.origin,
      destination: detail.destination,
      passengers: detail.passengers,
      pakyaw: detail.pakyaw,
      discountCode: detail.discountCode,
      distanceKm: detail.distanceKm,
      durationMinutes: detail.durationMinutes,
    },
    paid,
    expected,
    rows,
    policy,
    instrument: context.instrument,
  });

  const packet = {
    trip: {
      reference: detail.reference,
      cityId: detail.cityId,
      cityName: detail.cityName,
      vehicleId: detail.vehicleId,
      vehicleName: detail.vehicleName,
      origin: detail.origin,
      destination: detail.destination,
      passengers: Number(detail.passengers) || 1,
      pakyaw: Boolean(detail.pakyaw),
      discountCode: detail.discountCode || 'none',
      distanceKm: Number(detail.distanceKm) || 0,
      durationMinutes: Number(detail.durationMinutes) || 0,
      recordedVia: detail.recordedVia,
      recordedAt: detail.recordedAt,
      breadcrumbs: Array.isArray(detail.points) ? detail.points.length : 0,
    },
    assessment: result.assessment,
    hypotheses: result.hypotheses,
    matches: result.matches,
    allowedNumbers: result.allowedNumbers,
  };

  const engine = {
    mode: 'rules',
    model: null,
    latencyMs: 0,
    note: null,
    rejected: null,
  };

  let explanation = baselineExplanation(packet);

  const settings = options.settings || llmSettings(options.env);
  if (settings.enabled && !options.disableLlm) {
    const key = cacheKey(detail, paid, settings);
    const cached = options.refresh ? null : cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.payload;
    }

    try {
      const completion = await completeJson({
        settings,
        system: SYSTEM_PROMPT,
        user: buildPrompt(packet),
        fetchImpl: options.fetchImpl,
      });
      const validated = validateExplanation(completion.value, packet);
      if (validated.ok) {
        explanation = validated.value;
        engine.mode = 'llm';
        engine.model = completion.model;
        engine.latencyMs = completion.latencyMs;
      } else {
        engine.note = 'model explanation rejected; showing the rule-based reading';
        engine.rejected = validated.reason;
      }
    } catch (error) {
      engine.note = `provider unavailable; showing the rule-based reading (${short(error)})`;
    }

    const payload = buildPayload(detail, packet, explanation, engine);
    if (engine.mode === 'llm') cache.set(key, { at: Date.now(), payload });
    return payload;
  }

  if (!settings.enabled) engine.note = disabledReason(settings);
  return buildPayload(detail, packet, explanation, engine);
}

export function resetOverchargeCache() {
  cache.clear();
}

// ---------------------------------------------------------------------------

function buildPayload(detail, packet, explanation, engine) {
  const { assessment, hypotheses, matches } = packet;
  return {
    tripId: detail.id,
    reference: detail.reference,
    generatedAt: new Date().toISOString(),
    engine,
    assessment,
    hypotheses,
    matches,
    explanation,
    basis: basisFor(packet),
    disclaimer:
      'The expected amount is transcribed from the published matrix. The explanation describes likely causes; it is not a finding of law.',
  };
}

function basisFor(packet) {
  const { assessment } = packet;
  const lines = [];
  if (assessment.expected) {
    lines.push(
      `published row ${assessment.expected.rowNumber}: ${assessment.expected.from} \u2192 ${assessment.expected.to} at \u20b1${assessment.expected.unitFare.toFixed(2)} per passenger \u00d7 ${assessment.expected.seatUnits}`,
    );
  } else {
    lines.push('no published row covers this origin and destination');
  }
  if (assessment.instrument) {
    const instrument = assessment.instrument;
    const label =
      instrument.ordinanceNumber || instrument.id || instrument.title || null;
    const parts = label ? [label] : [];
    if (instrument.title && instrument.title !== label) {
      parts.push(instrument.title);
    }
    if (instrument.effectiveFrom) {
      parts.push(`effective ${instrument.effectiveFrom}`);
    }
    if (instrument.provisional) parts.push('provisional posting');
    lines.push(parts.join(', '));
  }
  lines.push(`paid \u20b1${assessment.paid.amount.toFixed(2)}`);
  if (assessment.delta) {
    lines.push(
      `difference \u20b1${assessment.delta.amount.toFixed(2)} (${(assessment.delta.ratio * 100).toFixed(1)}%)`,
    );
  }
  lines.push(
    `tolerance \u20b1${assessment.tolerance.amount.toFixed(2)} (${assessment.tolerance.basis})`,
  );
  return lines;
}

function buildPrompt(packet) {
  const shape = {
    headline: 'one sentence, at most 180 characters',
    explanation:
      'three to six sentences naming the most plausible causes and how each one would show up in the fare table',
    mostLikely: packet.hypotheses.map((row) => row.code),
    reasoning: ['up to five short bullet points, each citing one packet fact'],
    whatToCheck: ['up to four verifiable steps a rider or officer can take'],
  };
  return [
    'How to read this:',
    `- status "${packet.assessment.status}" was computed by comparing the payment with the published row.`,
    '- A "matched_other_row" hypothesis means the paid amount equals a different printed fare; that is the strongest kind of evidence.',
    '- Use the hypotheses in order of confidence. You may combine two that share evidence, but do not invent a third.',
    `- Cause codes available: ${Object.keys(HYPOTHESES).join(', ')}`,
    '',
    'Packet:',
    JSON.stringify(
      {
        trip: packet.trip,
        assessment: packet.assessment,
        hypotheses: packet.hypotheses,
        matches: packet.matches,
      },
      null,
      2,
    ),
    '',
    'Reply with exactly this shape:',
    JSON.stringify(shape, null, 2),
  ].join('\n');
}

// ---------------------------------------------------------------------------

async function loadContext(db, detail) {
  const policyResult = await db.query(
    `SELECT * FROM fare_policy_versions
     WHERE city_id = $1 AND status = 'active'
     LIMIT 1`,
    [detail.cityId],
  );

  const entryResult = await db.query(
    `SELECT e.ordinance_id, e.typical_capacity, e.per_km_rate,
            e.base_fare, e.base_distance_km,
            mv.id AS matrix_version_id, mv.source, mv.provisional,
            mv.effective_from, mv.notes
     FROM fare_matrix_entries e
     JOIN fare_matrix_versions mv
       ON mv.id = e.matrix_version_id AND mv.status = 'active'
     WHERE mv.city_id = $1 AND e.vehicle_type_id = $2 AND e.active
     LIMIT 1`,
    [detail.cityId, detail.vehicleId],
  );

  const matrix = entryResult.rows[0] || null;
  let ordinance = null;
  if (matrix?.ordinance_id) {
    const ordinanceResult = await db.query(
      `SELECT * FROM ordinances WHERE id = $1`,
      [matrix.ordinance_id],
    );
    ordinance = ordinanceResult.rows[0] || null;
  }

  const official = await lookupOfficialFare(
    db,
    detail.cityId,
    detail.vehicleId,
    detail.origin,
    detail.destination,
  );

  return {
    policy: policyResult.rows[0] || null,
    matrix,
    ordinance,
    official,
    instrument: {
      id: ordinance?.external_id ?? matrix?.source ?? null,
      title: ordinance?.title ?? matrix?.source ?? null,
      ordinanceNumber: ordinance?.ordinance_number ?? null,
      effectiveFrom: dateOnly(matrix?.effective_from),
      provisional: Boolean(matrix?.provisional),
      matrixSource: matrix?.source ?? null,
    },
  };
}

async function loadRows(db, context, vehicleId) {
  if (!context.matrix?.matrix_version_id) return [];
  const result = await db.query(
    `SELECT row_number, from_label, to_label, via,
            regular_fare, discounted_fare, bidirectional
     FROM fare_matrix_routes
     WHERE matrix_version_id = $1 AND vehicle_type_id = $2
     ORDER BY row_number`,
    [context.matrix.matrix_version_id, vehicleId],
  );
  return result.rows;
}

function expectedFromOfficial(official, detail) {
  const built = buildOfficialFare(
    {
      cityId: detail.cityId,
      vehicleId: detail.vehicleId,
      passengers: Number(detail.passengers) || 1,
      pakyaw: Boolean(detail.pakyaw),
      discountCode: detail.discountCode || 'none',
    },
    official,
    Number(detail.distanceKm) || 0,
  );

  const route = official.route;
  return {
    amount: money(built.exact_fare),
    unitFare: money(route.regular_fare),
    unitRegularFare: money(route.regular_fare),
    unitDiscountedFare: money(route.discounted_fare),
    seatUnits: Number(built.seat_units) || 1,
    rowNumber: Number(route.row_number),
    from: route.from_label,
    to: route.to_label,
    discounted: (detail.discountCode || 'none') !== 'none',
  };
}

function cacheKey(detail, paid, settings) {
  return [
    detail.id,
    paid,
    detail.passengers,
    detail.discountCode,
    detail.pakyaw ? 'pakyaw' : 'seat',
    settings.model,
  ].join(':');
}

function short(error) {
  const message = String(error?.message || error || 'unknown error');
  return message.length > 120 ? `${message.slice(0, 119)}\u2026` : message;
}

export { STATUS };
