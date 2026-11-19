/**
 * Deterministic overcharge assessment.
 *
 * The study question is narrow on purpose: given a recorded trip and the amount
 * the passenger actually handed over, does that amount match the fare the
 * published matrix prints for the same origin and destination?
 *
 * Three rules keep the answer defensible.
 *
 * 1. The expected amount is never the app's own estimate. It is rebuilt from the
 *    published row (`expected.amount`), so the comparison cannot be circular.
 * 2. Arithmetic and classification happen here, in pure functions. Same trip and
 *    same payment always produce the same verdict.
 * 3. A language model may only *explain*. `validateExplanation` rejects any
 *    narrative that introduces a number which is not already in the packet, so
 *    the prose can never re-price the trip.
 *
 * The interesting output is not "yes/no". It is `hypotheses`: ranked, evidenced
 * explanations of *why* the amount came out higher, each one testable against
 * the printed table (for example, "₱50 is the fare printed for Calamba Proper,
 * not the ₱40 printed for Bugho").
 */

export const STATUS = {
  COMPLIANT: 'compliant',
  OVERCHARGED: 'overcharged',
  UNDERCHARGED: 'undercharged',
  NOT_COVERED: 'not_covered',
  CONTRACT: 'contract',
};

export const STATUS_VALUES = Object.values(STATUS);

export const SEVERITY_VALUES = ['none', 'minor', 'moderate', 'serious'];

export const HYPOTHESES = {
  matched_other_row: 'Paid the fare printed for another destination',
  matched_adjacent_sitio: 'Paid the fare printed for a neighbouring sitio',
  matched_unit_row: 'Paid another row\u2019s per-passenger fare for each head',
  hub_link_added: 'Added the Poblacion/terminal link fare',
  composed_as_single_hire: 'Two printed legs charged as one direct hire',
  discount_missed: 'Statutory discount not applied',
  per_passenger_double: 'Group total multiplied by the passenger count',
  solo_double: 'Solo hire charged as two passenger fares',
  rounded_up: 'Rounded up to the next coin or five pesos',
  surcharge_added: 'Added an amount the matrix does not print',
  unlisted_place: 'No printed row for this pair',
  contract_hire: 'Direct hire outside the matrix',
  unexplained: 'No rule matched the amount',
};

export const HYPOTHESIS_CODES = Object.keys(HYPOTHESES);

const MONEY_EPSILON = 0.011;
const DEFAULT_TOLERANCE = 1;
const MAX_HYPOTHESES = 6;

/**
 * Expand the published table into both travel directions so a lookup never has
 * to remember which way the ordinance printed the row.
 */
export function expandRows(rows = []) {
  const expanded = [];
  for (const row of rows) {
    const entry = {
      rowNumber: int(row.rowNumber ?? row.row_number),
      origin: text(row.from ?? row.from_label),
      destination: text(row.to ?? row.to_label),
      regular: money(row.regularFare ?? row.regular_fare),
      discounted: money(row.discountedFare ?? row.discounted_fare),
      via: text(row.via),
    };
    if (!entry.origin || !entry.destination) continue;
    expanded.push(entry);
    if (row.bidirectional !== false) {
      expanded.push({
        ...entry,
        origin: entry.destination,
        destination: entry.origin,
      });
    }
  }
  return expanded;
}

/**
 * Compare one recorded payment against one published row.
 *
 * @param {object} input
 * @param {object} input.trip      { origin, destination, passengers, pakyaw, discountCode }
 * @param {number} input.paid      total amount handed over, in pesos
 * @param {object|null} input.expected
 *        { amount, unitFare, seatUnits, rowNumber, from, to, discounted,
 *          unitRegularFare, unitDiscountedFare }
 * @param {Array}  input.rows      every printed row for this city + vehicle
 * @param {object} [input.policy]  { discountRate, leeway, pakyawSeatCap }
 * @param {object} [input.instrument] { id, title, effectiveFrom, provisional }
 */
export function assessOvercharge(input = {}) {
  const trip = input.trip || {};
  const paid = number(input.paid);
  const expected = input.expected || null;
  const rows = expandRows(input.rows || []);
  const policy = input.policy || {};
  const instrument = input.instrument || null;

  const passengers = Math.max(1, int(trip.passengers) || 1);
  const tolerance = resolveTolerance(policy);

  const expectedAmount = expected ? money(expected.amount) : null;
  const status = statusFor({
    expected,
    trip,
    paid,
    tolerance: tolerance.amount,
    expectedAmount,
  });
  const delta = expectedAmount === null ? null : round(paid - expectedAmount, 2);
  const ratio =
    expectedAmount && expectedAmount > 0 ? round(delta / expectedAmount, 4) : null;
  const multiple =
    expectedAmount && expectedAmount > 0 ? round(paid / expectedAmount, 3) : null;

  const assessment = {
    status,
    severity: severityFor(status, delta, ratio, tolerance.amount),
    currency: 'PHP',
    expected: expected
      ? {
          amount: expectedAmount,
          unitFare: money(expected.unitFare),
          seatUnits: int(expected.seatUnits) || passengers,
          rowNumber: int(expected.rowNumber),
          from: text(expected.from),
          to: text(expected.to),
          discounted: Boolean(expected.discounted),
          unitRegularFare: money(expected.unitRegularFare),
          unitDiscountedFare: money(expected.unitDiscountedFare),
        }
      : null,
    paid: {
      amount: paid,
      perPassenger: round(paid / passengers, 2),
    },
    delta:
      delta === null
        ? null
        : {
            amount: delta,
            ratio,
            perPassenger: round(delta / passengers, 2),
            multipleOfExpected: multiple,
            direction: delta > 0 ? 'above' : delta < 0 ? 'below' : 'level',
          },
    tolerance,
    instrument,
  };

  const hypotheses =
    status === STATUS.COMPLIANT
      ? []
      : buildHypotheses({
          trip,
          passengers,
          paid,
          expected: assessment.expected,
          rows,
          delta,
          ratio,
          policy,
        });

  const matches = findMatchingRows(rows, paid, assessment.expected);
  return {
    assessment,
    hypotheses,
    matches,
    allowedNumbers: allowedNumbers({ trip, assessment, hypotheses, rows, policy }),
  };
}

/**
 * Deterministic, human-readable explanation used when no model is configured
 * (and as the yardstick the model narrative is compared against).
 */
export function baselineExplanation(packet) {
  const { assessment, hypotheses } = packet;
  const top = hypotheses[0] || null;
  const { status } = assessment;

  if (status === STATUS.NOT_COVERED || status === STATUS.CONTRACT) {
    const reason =
      status === STATUS.CONTRACT
        ? 'This was recorded as a direct hire, which the matrix treats as a contract trip rather than a printed fare.'
        : 'The matrix prints no row for this origin and destination, so there is no published amount to compare against.';
    return {
      headline: 'No published fare covers this pair',
      verdict: status,
      explanation: `${reason} The payment of ${peso(assessment.paid.amount)} cannot be called an overcharge or a discount on the strength of this record.`,
      mostLikely: hypotheses[0]?.code || 'unlisted_place',
      reasoning: hypotheses.slice(0, 3).map((row) => row.detail),
      whatToCheck: [
        'Confirm the exact origin and destination labels used at boarding.',
        'Check whether a barangay-level row exists for either endpoint.',
      ],
    };
  }

  if (status === STATUS.COMPLIANT) {
    return {
      headline: 'Payment matches the published fare',
      verdict: status,
      explanation: `The passenger paid ${peso(assessment.paid.amount)} and the matrix prints ${peso(assessment.expected.amount)} for row ${assessment.expected.rowNumber}. The ${peso(Math.abs(assessment.delta.amount))} difference is inside the ${peso(assessment.tolerance.amount)} tolerance.`,
      mostLikely: 'none',
      reasoning: [
        `Row ${assessment.expected.rowNumber} covers ${assessment.expected.from} → ${assessment.expected.to}.`,
        `The row is charged per passenger at ${peso(assessment.expected.unitFare)} for ${assessment.expected.seatUnits} passenger(s).`,
      ],
      whatToCheck: [],
    };
  }

  const direction =
    status === STATUS.OVERCHARGED ? 'above' : 'below';
  const headline =
    status === STATUS.OVERCHARGED
      ? `Paid ${peso(assessment.delta.amount)} above the printed fare`
      : `Paid ${peso(Math.abs(assessment.delta.amount))} below the printed fare`;

  return {
    headline,
    verdict: status,
    explanation: `The passenger paid ${peso(assessment.paid.amount)} against a printed fare of ${peso(assessment.expected.amount)} for row ${assessment.expected.rowNumber} (${assessment.expected.from} → ${assessment.expected.to}). That is ${formatPercent(assessment.delta.ratio)} ${direction} the published amount. ${top ? top.detail : ''}`.trim(),
    mostLikely: top ? top.code : 'unexplained',
    reasoning: hypotheses.slice(0, 3).map((row) => row.detail),
    whatToCheck: checksFor(assessment, hypotheses),
  };
}

/**
 * Accept a model narrative only when it is structurally valid and every number
 * it writes already exists in the deterministic packet.
 */
export function validateExplanation(raw, packet) {
  const problems = [];
  const value = raw && typeof raw === 'object' ? raw : {};

  const headline = clampText(value.headline, 200);
  const explanation = clampText(value.explanation, 1200);
  if (!headline) problems.push('headline is missing');
  if (!explanation) problems.push('explanation is missing');

  const mostLikely = String(value.mostLikely || 'none');
  const known = new Set([
    ...packet.hypotheses.map((row) => row.code),
    'none',
  ]);
  if (!known.has(mostLikely)) problems.push(`unknown hypothesis "${mostLikely}"`);

  const reasoning = Array.isArray(value.reasoning)
    ? value.reasoning.map((item) => clampText(item, 240)).filter(Boolean).slice(0, 5)
    : [];
  const whatToCheck = Array.isArray(value.whatToCheck)
    ? value.whatToCheck.map((item) => clampText(item, 200)).filter(Boolean).slice(0, 4)
    : [];

  const allowed = packet.allowedNumbers;
  for (const block of [headline, explanation, ...reasoning, ...whatToCheck]) {
    for (const token of numbersIn(block)) {
      if (!allowed.some((candidate) => Math.abs(candidate - token) <= 0.51)) {
        problems.push(`number ${token} is not in the trip record`);
      }
    }
  }

  // The model may explain a gap, but it may not overturn the arithmetic.
  if (value.verdict !== undefined) {
    const verdict = String(value.verdict);
    if (verdict !== packet.assessment.status) {
      problems.push(`verdict "${verdict}" contradicts the computed status`);
    }
  }

  if (problems.length) {
    return { ok: false, reason: problems.slice(0, 3).join('; '), value: null };
  }
  return {
    ok: true,
    reason: null,
    value: {
      headline,
      verdict: packet.assessment.status,
      explanation,
      mostLikely,
      reasoning,
      whatToCheck,
    },
  };
}

/** Every number the narrative is allowed to mention. */
export function allowedNumbers({ trip, assessment, hypotheses, rows, policy }) {
  const numbers = [];

  walk(assessment, (leaf) => {
    if (typeof leaf === 'number' && Number.isFinite(leaf)) numbers.push(leaf);
  });
  for (const key of ['passengers', 'distanceKm', 'durationMinutes']) {
    const value = number(trip[key]);
    if (Number.isFinite(value) && value > 0) numbers.push(value);
  }
  if (policy && Number.isFinite(number(policy.discountRate))) {
    numbers.push(number(policy.discountRate));
  }
  for (const row of hypotheses) {
    for (const token of numbersIn(row.detail)) numbers.push(token);
    for (const evidence of row.evidence || []) {
      if (typeof evidence.value === 'number') numbers.push(evidence.value);
    }
  }
  // Printed labels carry numbers too ("Purok 5", "Poblacion 4").
  for (const row of rows) {
    for (const token of numbersIn(`${row.origin} ${row.destination}`)) {
      numbers.push(token);
    }
  }
  return dedupe(numbers);
}

// ---------------------------------------------------------------------------
// classification
// ---------------------------------------------------------------------------

function statusFor({ expected, trip, paid, tolerance, expectedAmount }) {
  if (!expected || expectedAmount === null) {
    return trip.pakyaw ? STATUS.CONTRACT : STATUS.NOT_COVERED;
  }
  if (!Number.isFinite(paid)) return STATUS.NOT_COVERED;
  const diff = paid - expectedAmount;
  if (Math.abs(diff) <= tolerance) return STATUS.COMPLIANT;
  return diff > 0 ? STATUS.OVERCHARGED : STATUS.UNDERCHARGED;
}

function severityFor(status, delta, ratio, tolerance) {
  if (status !== STATUS.OVERCHARGED) return 'none';
  const abs = Math.abs(delta);
  if (abs <= Math.max(tolerance, 5) || Math.abs(ratio || 0) <= 0.1) return 'minor';
  if (abs <= 20 || Math.abs(ratio || 0) <= 0.25) return 'moderate';
  return 'serious';
}

function resolveTolerance(policy) {
  const leeway = number(policy?.leeway ?? policy?.leewayMax);
  if (Number.isFinite(leeway) && leeway > 0) {
    return { amount: round(leeway, 2), basis: 'fare policy leeway' };
  }
  return { amount: DEFAULT_TOLERANCE, basis: 'coin rounding allowance' };
}

// ---------------------------------------------------------------------------
// hypotheses
// ---------------------------------------------------------------------------

function buildHypotheses({ trip, passengers, paid, expected, rows, delta, ratio, policy }) {
  const out = [];
  const expectedAmount = expected ? expected.amount : null;
  const push = (code, confidence, detail, evidence) => {
    out.push({
      code,
      label: HYPOTHESES[code],
      confidence: round(confidence, 2),
      detail,
      evidence: evidence.map(([path, value]) => ({ path, value })),
    });
  };

  if (!expected) {
    if (trip.pakyaw) {
      push(
        'contract_hire',
        0.9,
        'The trip was recorded as a direct hire, so the amount is a contract (pakyaw) price and no printed row applies.',
        [['paid', paid]],
      );
    } else {
      push(
        'unlisted_place',
        0.9,
        'No printed row covers this origin and destination, so the amount cannot be checked against the matrix.',
        [['paid', paid]],
      );
    }
    return out.slice(0, MAX_HYPOTHESES);
  }

  const sameRow = (row) => row.rowNumber === expected.rowNumber;
  const expectedKey = barangayKey(expected.to);
  const isNeighbour = (row) =>
    expectedKey !== '' && barangayKey(placeLabel(row)) === expectedKey;

  // A bidirectional row appears twice after expansion; keep one entry per row.
  const rowMatches = dedupeRows(
    rows.filter(
      (row) =>
        !sameRow(row) &&
        !approx(row.regular, expectedAmount) &&
        (approx(row.regular, paid) || approx(row.discounted, paid)),
    ),
  );
  const neighbours = rowMatches.filter(isNeighbour);
  const elsewhere = rowMatches.filter((row) => !isNeighbour(row));

  // 1. The amount is exactly another printed fare. When several rows print it,
  // name them rather than picking one: the table often reuses a round amount.
  if (neighbours.length) {
    push(
      'matched_adjacent_sitio',
      0.92,
      `The amount paid is printed for ${describeRows(neighbours)}, a sitio in the same barangay as ${expected.to}.`,
      [
        ['matched.row', neighbours[0].rowNumber],
        ['matched.fare', neighbours[0].regular],
        ['expected.amount', expectedAmount],
      ],
    );
  }
  if (elsewhere.length) {
    push(
      'matched_other_row',
      0.9,
      `The amount paid is printed for ${describeRows(elsewhere)} rather than ${peso(expectedAmount)} for ${expected.to}.`,
      [
        ['matched.row', elsewhere[0].rowNumber],
        ['matched.fare', elsewhere[0].regular],
        ['expected.amount', expectedAmount],
      ],
    );
  }

  // 2. Per-head multiplication: the right unit fare was charged for every head.
  if (passengers > 1) {
    const unitPaid = round(paid / passengers, 2);
    const unitMatches = dedupeRows(
      rows.filter(
        (row) =>
          !sameRow(row) &&
          !approx(row.regular, expected.unitFare) &&
          approx(row.regular, unitPaid),
      ),
    );
    if (unitMatches.length) {
      const row = unitMatches[0];
      push(
        'matched_unit_row',
        0.72,
        `Each passenger was charged ${peso(unitPaid)}, which is the printed fare for ${placeLabel(row)} (row ${row.rowNumber}), not the ${peso(expected.unitFare)} per head for ${expected.to}.`,
        [
          ['paid.perPassenger', unitPaid],
          ['matched.row', row.rowNumber],
          ['expected.unitFare', expected.unitFare],
        ],
      );
    }
  }

  // 3. A second printed row was added to the expected fare.
  const added = round(paid - expectedAmount, 2);
  if (added > 0) {
    const companions = dedupeRows(
      rows.filter((row) => !sameRow(row) && approx(row.regular, added)),
    );
    if (companions.length) {
      const row = companions[0];
      const link = mentionsCentro(row);
      push(
        link ? 'hub_link_added' : 'composed_as_single_hire',
        link ? 0.82 : 0.7,
        link
          ? `The difference of ${peso(added)} equals row ${row.rowNumber} (${row.origin} \u2192 ${row.destination}), the Poblacion/terminal link fare, as if the trip needed a hub transfer.`
          : `The difference of ${peso(added)} equals row ${row.rowNumber} (${placeLabel(row)}, ${peso(row.regular)}), as if two printed legs were charged for one direct ride.`,
        [
          ['delta.amount', added],
          ['matched.row', row.rowNumber],
          ['matched.fare', row.regular],
        ],
      );
    }
  }

  // 4. The discount exists in the table but was not applied.
  if (
    expected.discounted === true &&
    trip.discountCode &&
    trip.discountCode !== 'none' &&
    Number.isFinite(expected.unitDiscountedFare) &&
    expected.unitDiscountedFare < expected.unitRegularFare &&
    approx(paid, expected.unitRegularFare * (expected.seatUnits || passengers))
  ) {
    push(
      'discount_missed',
      0.86,
      `A ${trip.discountCode} discount was declared and the matrix applies ${peso(expected.unitDiscountedFare)} per head, but the amount paid is the undiscounted ${peso(expected.unitRegularFare)} per head.`,
      [
        ['expected.unitRegularFare', expected.unitRegularFare],
        ['expected.unitDiscountedFare', expected.unitDiscountedFare],
        ['discountRate', number(policy?.discountRate)],
      ],
    );
  }

  // 5. The group total was multiplied by the passenger count.
  if (
    passengers > 1 &&
    approx(paid, expectedAmount * passengers) &&
    !approx(paid, expectedAmount)
  ) {
    push(
      'per_passenger_double',
      0.6,
      `The amount paid is ${passengers} times the printed group total of ${peso(expectedAmount)}, which happens when a total fare is charged again for every passenger.`,
      [
        ['expected.amount', expectedAmount],
        ['trip.passengers', passengers],
        ['paid.amount', paid],
      ],
    );
  }

  // 6. Solo hire charged as two passenger fares.
  if (
    passengers === 1 &&
    !trip.pakyaw &&
    approx(paid, expectedAmount * 2)
  ) {
    push(
      'solo_double',
      0.55,
      `The amount paid is exactly twice the printed fare of ${peso(expectedAmount)}, the pattern of a solo hire charged as two passenger fares. This matrix prints no special-trip clause, so that doubling is not in the ordinance.`,
      [
        ['expected.amount', expectedAmount],
        ['paid.amount', paid],
      ],
    );
  }

  // 7. Small coin rounding.
  if (added > 0 && added <= 10) {
    const crisp = approx(added % 5, 0) || approx(added % 10, 0);
    if (crisp) {
      push(
        'rounded_up',
        0.42,
        `The amount is ${peso(added)} above the printed fare and lands on a round note or coin, the usual pattern of rounding up at hand-over.`,
        [
          ['delta.amount', added],
          ['expected.amount', expectedAmount],
          ['paid.amount', paid],
        ],
      );
    }
  }

  // 8. An add-on the matrix does not print.
  if (added > 0 && added <= 30 && !out.some((row) => row.code === 'hub_link_added')) {
    push(
      'surcharge_added',
      0.3,
      `The amount is ${peso(added)} above the printed fare and does not match any other printed row, which fits a flat add-on such as a fuel or waiting charge that the matrix does not print.`,
      [
        ['delta.amount', added],
        ['expected.amount', expectedAmount],
      ],
    );
  }

  if (!out.length && Math.abs(delta) > 0) {
    push(
      'unexplained',
      0.15,
      `The ${peso(Math.abs(delta))} gap does not reproduce any printed row, combination of rows or discount, so the record alone does not explain it.`,
      [
        ['delta.amount', delta],
        ['expected.amount', expectedAmount],
        ['paid.amount', paid],
      ],
    );
  }

  return out.sort((a, b) => b.confidence - a.confidence).slice(0, MAX_HYPOTHESES);
}

function checksFor(assessment, hypotheses) {
  const checks = [];
  const top = hypotheses[0];
  if (top?.code === 'matched_other_row' || top?.code === 'matched_adjacent_sitio') {
    checks.push('Confirm which sitio the passenger actually alighted at.');
  }
  if (top?.code === 'hub_link_added') {
    checks.push('Check whether the ride started in Poblacion or at the terminal.');
  }
  if (top?.code === 'composed_as_single_hire') {
    checks.push('Ask whether the trip was one direct hire or two separate rides.');
  }
  if (top?.code === 'discount_missed') {
    checks.push('Check the passenger\u2019s discount eligibility and ID.');
  }
  if (top?.code === 'per_passenger_double' || top?.code === 'solo_double') {
    checks.push('Confirm how many passengers were on board and whether it was a solo hire.');
  }
  if (top?.code === 'rounded_up') {
    checks.push('Check whether the exact change was available at hand-over.');
  }
  if (assessment.paid.amount > assessment.expected.amount) {
    checks.push(`Show the driver row ${assessment.expected.rowNumber} of the published matrix.`);
  }
  return checks.slice(0, 4);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function findMatchingRows(rows, paid, expected) {
  const expectedRowNumber = expected ? expected.rowNumber : null;
  const expectedKey = expected ? barangayKey(expected.to) : '';
  const hits = dedupeRows(
    rows.filter((row) => {
      if (row.rowNumber === expectedRowNumber) return false;
      const expectedAmount = expected ? number(expected.amount) : null;
      if (expectedAmount !== null && approx(row.regular, expectedAmount)) {
        return false;
      }
      return approx(row.regular, paid) || approx(row.discounted, paid);
    }),
  );
  return hits.slice(0, 8).map((row) => {
    const fare = approx(row.regular, paid) ? row.regular : row.discounted;
    const keyOfRow = barangayKey(placeLabel(row));
    return {
      rowNumber: row.rowNumber,
      origin: row.origin,
      destination: row.destination,
      place: placeLabel(row),
      fare,
      sameBarangay: keyOfRow !== '' && keyOfRow === expectedKey,
    };
  });
}

/** One entry per printed row, whichever direction matched. */
function dedupeRows(rows) {
  const seen = new Map();
  for (const row of rows) {
    if (!seen.has(row.rowNumber)) seen.set(row.rowNumber, row);
  }
  return [...seen.values()];
}

/** The non-hub label of a row, so a reverse match still names the sitio. */
function placeLabel(row) {
  return mentionsCentro(row) ? row.origin : row.destination;
}

/** Names up to three printed rows, so a round amount is not pinned to one. */
function describeRows(rows, limit = 3) {
  return rows
    .slice(0, limit)
    .map((row) => `${placeLabel(row)} (row ${row.rowNumber}, ${peso(row.regular)})`)
    .join('; ');
}

/** "Bugho, Bay-Ang" -> "bayang"; "Bay-ang" -> "bayang". */
function barangayKey(label) {  const text_ = text(label);
  if (!text_) return '';
  const parts = text_.split(',');
  const tail = parts.length > 1 ? parts[parts.length - 1] : text_;
  return tail.toLowerCase().replace(/[^a-z]/g, '');
}

function mentionsCentro(row) {
  const haystack = `${row.destination}`.toLowerCase();
  return haystack.includes('poblacion') || haystack.includes('terminal');
}

function peso(value) {
  return `\u20b1${number(value).toFixed(2)}`;
}

function formatPercent(ratio) {
  const value = Math.abs(number(ratio)) * 100;
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function approx(a, b) {
  return Math.abs(number(a) - number(b)) < MONEY_EPSILON;
}

function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const key = value.toFixed(4);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
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

export function numbersIn(value) {
  const found = String(value ?? '').match(/-?\d[\d,]*(?:\.\d+)?/g) || [];
  return found
    .map((token) => Number(token.replace(/,/g, '')))
    .filter((token) => Number.isFinite(token));
}

function clampText(value, max) {
  const text_ = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text_.length > max ? `${text_.slice(0, max - 1)}\u2026` : text_;
}

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function int(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function money(value) {
  return Math.round((number(value) + Number.EPSILON) * 100) / 100;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}
