import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HYPOTHESIS_CODES,
  STATUS,
  assessOvercharge,
  baselineExplanation,
  expandRows,
  validateExplanation,
} from '../src/lib/overcharge.js';
import { llmSettings } from '../src/services/llm.js';

/**
 * The real rows this study cares about, transcribed from
 * S.C.O. 2020-012 as posted on 17 July 2026. Keeping the fixture small makes a
 * failure point at one row instead of a wall of JSON.
 */
const ROWS = [
  { rowNumber: 1, from: 'Anywhere in Poblacion', to: 'Anywhere in Poblacion', regularFare: 9, discountedFare: 7.2 },
  { rowNumber: 2, from: 'Poblacion', to: 'Land Transport Terminal', regularFare: 9, discountedFare: 7.2 },
  { rowNumber: 5, from: 'Poblacion', to: 'Bay-ang', regularFare: 20, discountedFare: 16 },
  { rowNumber: 6, from: 'Poblacion or Terminal', to: 'Bugho, Bay-Ang', regularFare: 40, discountedFare: 32 },
  { rowNumber: 7, from: 'Poblacion or Terminal', to: 'Bung-Aw, Bay-Ang', regularFare: 35, discountedFare: 28 },
  { rowNumber: 8, from: 'Poblacion or Terminal', to: 'Dal-As, Bay-Ang', regularFare: 35, discountedFare: 28 },
  { rowNumber: 9, from: 'Poblacion or Terminal', to: 'Caasinan', regularFare: 15, discountedFare: 12 },
  { rowNumber: 11, from: 'Poblacion or Terminal', to: 'Calamba Proper', regularFare: 40, discountedFare: 32 },
  { rowNumber: 56, from: 'Land Transport Terminal', to: 'Puting Bato Centro', regularFare: 50, discountedFare: 40 },
  { rowNumber: 60, from: 'Poblacion or Terminal', to: 'Soriano', regularFare: 20, discountedFare: 16 },
];

function expectedFor(rowNumber, overrides = {}) {
  const row = ROWS.find((item) => item.rowNumber === rowNumber);
  const seatUnits = overrides.seatUnits ?? 1;
  const discounted = Boolean(overrides.discounted);
  const unitFare = row.regularFare;
  return {
    amount: (discounted ? row.discountedFare : row.regularFare) * seatUnits,
    unitFare,
    unitRegularFare: row.regularFare,
    unitDiscountedFare: row.discountedFare,
    seatUnits,
    rowNumber: row.rowNumber,
    from: row.from,
    to: row.to,
    discounted,
    ...overrides,
  };
}

function assess(paid, options = {}) {
  return assessOvercharge({
    trip: {
      origin: options.origin || 'Poblacion',
      destination: options.destination || 'Bugho, Bay-Ang',
      passengers: options.passengers ?? 1,
      pakyaw: Boolean(options.pakyaw),
      discountCode: options.discountCode || 'none',
    },
    paid,
    expected: options.expected === undefined ? expectedFor(6) : options.expected,
    rows: ROWS,
    policy: { discountRate: 0.2 },
    instrument: { id: 'sco-2020-012', title: 'S.C.O. 2020-012', effectiveFrom: '2026-07-17' },
  });
}

test('a payment equal to the printed row is compliant', () => {
  const result = assess(40);
  assert.equal(result.assessment.status, STATUS.COMPLIANT);
  assert.equal(result.assessment.severity, 'none');
  assert.equal(result.assessment.delta.amount, 0);
  assert.equal(result.hypotheses.length, 0);
});

test('coin rounding inside the tolerance is still compliant', () => {
  const result = assess(41);
  assert.equal(result.assessment.status, STATUS.COMPLIANT);
  assert.equal(result.assessment.tolerance.amount, 1);
});

test('paying another printed row names that row exactly', () => {
  const result = assess(50);
  assert.equal(result.assessment.status, STATUS.OVERCHARGED);
  assert.equal(result.assessment.delta.amount, 10);
  assert.equal(result.assessment.delta.ratio, 0.25);
  const top = result.hypotheses[0];
  assert.equal(top.code, 'matched_other_row');
  assert.match(top.detail, /Puting Bato Centro/);
  assert.match(top.detail, /row 56/);
});

test('a neighbouring sitio is reported as an adjacent-sitio match', () => {
  const result = assess(35);
  const codes = result.hypotheses.map((row) => row.code);
  assert.ok(codes.includes('matched_adjacent_sitio'));
  const top = result.hypotheses[0];
  assert.equal(top.code, 'matched_adjacent_sitio');
  assert.match(top.detail, /Bung-Aw|Dal-As/);
});

test('adding the Poblacion-to-terminal link is detected on a Bay-ang trip', () => {
  const result = assessOvercharge({
    trip: { origin: 'Poblacion', destination: 'Bay-ang', passengers: 1, pakyaw: false, discountCode: 'none' },
    paid: 29,
    expected: expectedFor(5),
    rows: ROWS,
  });
  assert.equal(result.assessment.status, STATUS.OVERCHARGED);
  assert.equal(result.assessment.delta.amount, 9);
  assert.equal(result.hypotheses[0].code, 'hub_link_added');
  assert.equal(result.hypotheses[0].evidence[0].value, 9);
});

test('two printed legs charged as one direct hire are separated', () => {
  // Bugho 40 + Caasinan 15 = 55, which is not a printed fare on its own.
  const result = assess(55);
  assert.equal(result.assessment.status, STATUS.OVERCHARGED);
  assert.equal(result.hypotheses[0].code, 'composed_as_single_hire');
  assert.equal(result.hypotheses[0].evidence[1].value, 9);
});

test('a solo hire charged as two passenger fares is named and denied', () => {
  const result = assess(80);
  const solo = result.hypotheses.find((row) => row.code === 'solo_double');
  assert.ok(solo);
  assert.match(solo.detail, /no special-trip clause/);
});

test('a group total charged again per passenger is detected', () => {
  const result = assessOvercharge({
    trip: { origin: 'Poblacion', destination: 'Bugho, Bay-Ang', passengers: 2, pakyaw: false, discountCode: 'none' },
    paid: 160,
    expected: expectedFor(6, { seatUnits: 2 }),
    rows: ROWS,
  });
  assert.equal(result.assessment.expected.amount, 80);
  assert.equal(result.assessment.delta.amount, 80);
  const codes = result.hypotheses.map((row) => row.code);
  assert.ok(codes.includes('per_passenger_double'));
});

test('an unapplied statutory discount is reported as such', () => {
  const result = assessOvercharge({
    trip: { origin: 'Poblacion', destination: 'Bugho, Bay-Ang', passengers: 1, pakyaw: false, discountCode: 'student' },
    paid: 40,
    expected: expectedFor(6, { discounted: true }),
    rows: ROWS,
    policy: { discountRate: 0.2 },
  });
  assert.equal(result.assessment.expected.amount, 32);
  assert.equal(result.assessment.status, STATUS.OVERCHARGED);
  const discount = result.hypotheses.find((row) => row.code === 'discount_missed');
  assert.ok(discount, 'expected a discount_missed hypothesis');
  assert.match(discount.detail, /student/);
});

test('paying less than the printed row is reported as undercharged, not overcharged', () => {
  const result = assess(20);
  assert.equal(result.assessment.status, STATUS.UNDERCHARGED);
  assert.equal(result.assessment.severity, 'none');
  assert.equal(result.assessment.delta.amount, -20);
});

test('a pair with no printed row cannot be called an overcharge', () => {
  const result = assess(30, { expected: null });
  assert.equal(result.assessment.status, STATUS.NOT_COVERED);
  assert.equal(result.assessment.delta, null);
  assert.equal(result.hypotheses[0].code, 'unlisted_place');
});

test('a direct hire with no printed row is a contract trip, not an overcharge', () => {
  const result = assess(200, { expected: null, pakyaw: true });
  assert.equal(result.assessment.status, STATUS.CONTRACT);
  assert.equal(result.hypotheses[0].code, 'contract_hire');
});

test('an amount that matches nothing is left unexplained rather than guessed', () => {
  const result = assess(47);
  assert.equal(result.assessment.status, STATUS.OVERCHARGED);
  const codes = result.hypotheses.map((row) => row.code);
  assert.ok(codes.every((code) => HYPOTHESIS_CODES.includes(code)));
  assert.ok(codes.includes('rounded_up') || codes.includes('surcharge_added'));
});

test('the rule-based explanation never invents a cause', () => {
  const packet = assess(50);
  const explanation = baselineExplanation(packet);
  assert.match(explanation.headline, /10\.00/);
  assert.equal(explanation.verdict, STATUS.OVERCHARGED);
  assert.ok(explanation.explanation.length > 0);
  assert.ok(explanation.whatToCheck.length > 0);
});

test('a narrative may reuse packet numbers', () => {
  const packet = assess(50);
  const verdict = validateExplanation(
    {
      headline: 'Paid 10.00 above the printed 40.00',
      explanation:
        'The matrix prints 40.00 for Bugho in row 6, but the amount paid is 50.00, which is row 56.',
      mostLikely: 'matched_other_row',
      reasoning: ['row 6 covers Poblacion or Terminal to Bugho, Bay-Ang'],
      whatToCheck: ['Confirm the drop-off sitio.'],
    },
    packet,
  );
  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.value.verdict, STATUS.OVERCHARGED);
  assert.equal(verdict.value.mostLikely, 'matched_other_row');
});

test('a narrative that invents a fare is rejected', () => {
  const packet = assess(50);
  const verdict = validateExplanation(
    {
      headline: 'Overcharged by 10.00',
      explanation: 'The correct fare is 38.00 according to the ordinance.',
      mostLikely: 'matched_other_row',
      reasoning: [],
      whatToCheck: [],
    },
    packet,
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /38/);
});

test('a narrative that overturns the computed verdict is rejected', () => {
  const packet = assess(50);
  const verdict = validateExplanation(
    {
      headline: 'Fare is fair',
      explanation: 'The amount paid matches the printed row.',
      verdict: STATUS.COMPLIANT,
      mostLikely: 'none',
    },
    packet,
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /contradicts the computed status/);
});

test('a narrative naming an unknown cause is rejected', () => {
  const packet = assess(50);
  const verdict = validateExplanation(
    {
      headline: 'Something happened',
      explanation: 'The driver added a fuel surcharge that the ordinance allows.',
      mostLikely: 'fuel_indexed_surcharge',
    },
    packet,
  );
  assert.equal(verdict.ok, false);
  assert.match(verdict.reason, /fuel_indexed_surcharge/);
});

test('rows expand in both directions so a reverse trip still resolves', () => {
  const rows = expandRows(ROWS);
  const reverse = rows.find(
    (row) => row.origin === 'Bugho, Bay-Ang' && row.destination === 'Poblacion or Terminal',
  );
  assert.ok(reverse);
  assert.equal(reverse.regular, 40);
  assert.equal(reverse.rowNumber, 6);
});

test('label numbers such as Poblacion 4 stay mentionable', () => {
  const rows = [
    ...ROWS,
    { rowNumber: 65, from: 'Poblacion', to: 'Catholic Cemetery, Poblacion 4', regularFare: 10, discountedFare: 8 },
  ];
  const result = assessOvercharge({
    trip: { origin: 'Poblacion', destination: 'Catholic Cemetery, Poblacion 4', passengers: 1 },
    paid: 10,
    expected: {
      amount: 10,
      unitFare: 10,
      unitRegularFare: 10,
      unitDiscountedFare: 8,
      seatUnits: 1,
      rowNumber: 65,
      from: 'Poblacion',
      to: 'Catholic Cemetery, Poblacion 4',
      discounted: false,
    },
    rows,
  });
  assert.ok(result.allowedNumbers.includes(4));
  assert.ok(result.allowedNumbers.includes(65));
});

test('the nvidia provider preset needs only a key', () => {
  const settings = llmSettings({
    FAREFAIR_LLM_PROVIDER: 'nvidia',
    FAREFAIR_LLM_API_KEY: 'nvapi-test',
  });
  assert.equal(settings.enabled, true);
  assert.equal(settings.baseUrl, 'https://integrate.api.nvidia.com/v1');
  assert.equal(settings.model, 'nvidia/nemotron-3-ultra-550b-a55b');
  assert.equal(settings.provider, 'nvidia');
  assert.equal(settings.timeoutMs, 240000);
  assert.deepEqual(settings.chatTemplateKwargs, { thinking: false });
});

test('an explicit timeout still wins over the preset default', () => {
  const settings = llmSettings({
    FAREFAIR_LLM_PROVIDER: 'nvidia',
    FAREFAIR_LLM_API_KEY: 'nvapi-test',
    FAREFAIR_LLM_TIMEOUT_MS: '9000',
  });
  assert.equal(settings.timeoutMs, 9000);
});

test('an explicit base url and model override the preset', () => {
  const settings = llmSettings({
    FAREFAIR_LLM_PROVIDER: 'nvidia',
    FAREFAIR_LLM_BASE_URL: 'https://example.test/v1/',
    FAREFAIR_LLM_MODEL: 'custom-model',
    FAREFAIR_LLM_API_KEY: 'k',
  });
  assert.equal(settings.baseUrl, 'https://example.test/v1');
  assert.equal(settings.model, 'custom-model');
});

test('no provider means rules mode, never a network call', () => {
  const settings = llmSettings({});
  assert.equal(settings.enabled, false);
});
