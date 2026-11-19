import test from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeFacts,
  baselineFindings,
  baselineNarrative,
  confidenceFromFacts,
  riskFromFindings,
  validateNarrative,
} from '../src/lib/trip-analysis.js';
import { llmSettings } from '../src/services/llm.js';

function trip(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'TRIP-TEST-1',
    cityId: 'cabadbaran',
    cityName: 'Cabadbaran City',
    vehicleId: 'tricycle',
    vehicleName: 'Tricycle',
    origin: 'Poblacion',
    destination: 'Bayabas',
    distanceKm: 4.2,
    durationMinutes: 14,
    passengers: 2,
    pakyaw: false,
    discountCode: 'none',
    status: 'completed',
    flagReason: '',
    recordedVia: 'live_trip_recording',
    recordedAt: '2026-10-01T08:00:00.000Z',
    fare: { currency: 'PHP', exact: 9, min: 9, max: 9 },
    fareSource: 'official_matrix',
    routeRowNumber: 12,
    points: [
      { lat: 9.1, lng: 125.5, recordedAt: '2026-10-01T08:00:00.000Z' },
      { lat: 9.104, lng: 125.504, recordedAt: '2026-10-01T08:02:00.000Z' },
      { lat: 9.108, lng: 125.508, recordedAt: '2026-10-01T08:04:00.000Z' },
      { lat: 9.112, lng: 125.512, recordedAt: '2026-10-01T08:06:00.000Z' },
    ],
    anomalies: [],
    predictions: [],
    ...overrides,
  };
}

test('facts summarise the breadcrumb trail without inventing distance', () => {
  const facts = analyzeFacts(trip());
  assert.equal(facts.gps.points, 4);
  assert.ok(facts.gps.pathKm > 0);
  assert.ok(facts.gps.maxGapMeters > 0);
  assert.equal(facts.trip.distanceKm, 4.2);
  assert.equal(facts.fare.estimate, 9);
  assert.equal(facts.fare.published, true);
});

test('a fare above the published band is a high-severity finding', () => {
  const facts = analyzeFacts(
    trip({ fare: { currency: 'PHP', exact: 25, min: 9, max: 9 } }),
  );
  const findings = baselineFindings(facts);
  const outOfBand = findings.find((row) => row.code === 'fare_out_of_band');
  assert.ok(outOfBand);
  assert.equal(outOfBand.severity, 'high');
  assert.equal(riskFromFindings(findings), 'serious');
});

test('an open anomaly is carried into the findings', () => {
  const facts = analyzeFacts(
    trip({
      anomalies: [
        {
          kind: 'above_customary_ceiling',
          severity: 'high',
          detail: 'Recorded fare exceeds the published cap.',
          resolvedAt: null,
        },
      ],
    }),
  );
  const findings = baselineFindings(facts);
  assert.ok(findings.some((row) => row.code === 'open_anomaly'));
});

test('a statutory discount is informational and never raises the risk', () => {
  const undiscounted = riskFromFindings(
    baselineFindings(analyzeFacts(trip({ discountCode: 'none' }))),
  );
  const facts = analyzeFacts(trip({ discountCode: 'senior' }));
  const findings = baselineFindings(facts);
  const discount = findings.find((row) => row.code === 'discount_applied');
  assert.ok(discount);
  assert.equal(discount.informational, true);
  // The discount adds a note, not a problem: risk is unchanged.
  assert.equal(riskFromFindings(findings), undiscounted);
});

test('every finding cites a path that exists in the packet', () => {
  const facts = analyzeFacts(trip({ points: [] }));
  const findings = baselineFindings(facts);
  for (const row of findings) {
    assert.ok(row.evidence.length > 0, `${row.code} has no evidence`);
    for (const item of row.evidence) {
      assert.notEqual(resolve(facts, item.path), undefined, item.path);
    }
  }
});

test('a narrative that introduces a new amount is rejected', () => {
  const facts = analyzeFacts(trip());
  const findings = baselineFindings(facts);
  const result = validateNarrative(
    {
      headline: 'The passenger was overcharged by 15.50 PHP.',
      summary: 'The record shows a gap in the trail.',
      risk: 'review',
      priorities: [],
      recommendedAction: 'verify_record',
      checks: [],
    },
    facts,
    findings,
  );
  assert.equal(result.ok, false);
  assert.match(result.reason, /15.5/);
});

test('a narrative may reuse a number that exists in the packet', () => {
  const facts = analyzeFacts(trip());
  const findings = baselineFindings(facts);
  const result = validateNarrative(
    {
      headline: 'The amount of 9.00 PHP matches published row 12.',
      summary: 'The trail is continuous and the fare sits inside the band.',
      risk: 'clear',
      priorities: [],
      recommendedAction: 'none',
      checks: ['Confirm the destination barangay.'],
    },
    facts,
    findings,
  );
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.value.risk, 'clear');
});

test('unknown priority codes are dropped instead of trusted', () => {
  const facts = analyzeFacts(trip());
  const findings = baselineFindings(facts);
  const result = validateNarrative(
    {
      headline: 'No rule fired.',
      summary: 'The record looks consistent.',
      risk: 'clear',
      priorities: ['made_up_code'],
      recommendedAction: 'none',
      checks: [],
    },
    facts,
    findings,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.priorities, []);
});

test('confidence rises with a complete record and falls without breadcrumbs', () => {
  const full = confidenceFromFacts(analyzeFacts(trip()));
  const empty = confidenceFromFacts(analyzeFacts(trip({ points: [] })));
  assert.ok(full > empty);
  assert.ok(full <= 0.9);
});

test('rules narrative is usable when no provider is configured', () => {
  const facts = analyzeFacts(trip());
  const findings = baselineFindings(facts);
  const narrative = baselineNarrative(facts, findings, riskFromFindings(findings));
  assert.ok(narrative.headline.length > 0);
  assert.ok(narrative.summary.length > 0);
  assert.ok(['none', 'monitor', 'verify_record', 'contact_operator', 'escalate'].includes(
    narrative.recommendedAction,
  ));
});

test('the provider is opt-in', () => {
  const off = llmSettings({});
  assert.equal(off.enabled, false);

  const noKey = llmSettings({
    FAREFAIR_LLM_BASE_URL: 'https://example.invalid/v1',
    FAREFAIR_LLM_MODEL: 'some-free-model',
  });
  assert.equal(noKey.enabled, false);

  const local = llmSettings({
    FAREFAIR_LLM_BASE_URL: 'http://localhost:11434/v1',
    FAREFAIR_LLM_MODEL: 'llama3.2',
  });
  assert.equal(local.enabled, true);

  const disabled = llmSettings({
    FAREFAIR_LLM_BASE_URL: 'http://localhost:11434/v1',
    FAREFAIR_LLM_MODEL: 'llama3.2',
    FAREFAIR_LLM_DISABLED: 'true',
  });
  assert.equal(disabled.enabled, false);
});

function resolve(value, pathName) {
  return pathName
    .split('.')
    .reduce((current, key) => (current == null ? undefined : current[key]), value);
}
