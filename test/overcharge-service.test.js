import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeOvercharge, resetOverchargeCache } from '../src/services/overcharge-service.js';
import { llmSettings } from '../src/services/llm.js';

/**
 * A tiny stand-in for the database. It answers only the six queries the
 * overcharge service issues, so a failure points at the wiring rather than at
 * PGlite.
 */
function fakeDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('fn_lookup_fare_route')) {
        return {
          rows: [
            {
              row_number: 6,
              from_label: 'Poblacion or Terminal',
              to_label: 'Bugho, Bay-Ang',
              via: null,
              regular_fare: '40.00',
              discounted_fare: '32.00',
              remark: null,
              bidirectional: true,
            },
          ],
        };
      }
      if (sql.includes('pv.discount_rate')) {
        return {
          rows: [
            {
              matrix_version_id: 'mv-1',
              provisional: true,
              policy_version_id: 'pv-1',
              discount_rate: '0.20',
              pakyaw_seat_cap: 4,
              typical_capacity: 4,
              base_fare: '40.00',
              base_distance_km: '0.00',
              per_km_rate: '0.00',
            },
          ],
        };
      }
      if (sql.includes('FROM fare_policy_versions')) {
        return { rows: [{ discount_rate: '0.20', customary_leeway_max: '0.00', pakyaw_seat_cap: 4 }] };
      }
      if (sql.includes('e.ordinance_id')) {
        return {
          rows: [
            {
              ordinance_id: 'ord-1',
              typical_capacity: 4,
              per_km_rate: '0.00',
              base_fare: '40.00',
              base_distance_km: '0.00',
              matrix_version_id: 'mv-1',
              source: 'S.C.O. 2020-012 (posted 17 July 2026)',
              provisional: true,
              effective_from: '2026-07-17',
              notes: '',
            },
          ],
        };
      }
      if (sql.includes('FROM ordinances')) {
        return {
          rows: [
            {
              external_id: 'sco-2020-012',
              title: 'An Ordinance Prescribing the Tricycle Fare in the City of Cabadbaran',
              ordinance_number: 'S.C.O. 2020-012',
            },
          ],
        };
      }
      if (sql.includes('FROM fare_matrix_routes')) {
        return {
          rows: [
            { row_number: 2, from_label: 'Poblacion', to_label: 'Land Transport Terminal', via: null, regular_fare: '9.00', discounted_fare: '7.20', bidirectional: true },
            { row_number: 5, from_label: 'Poblacion', to_label: 'Bay-ang', via: null, regular_fare: '20.00', discounted_fare: '16.00', bidirectional: true },
            { row_number: 6, from_label: 'Poblacion or Terminal', to_label: 'Bugho, Bay-Ang', via: null, regular_fare: '40.00', discounted_fare: '32.00', bidirectional: true },
            { row_number: 7, from_label: 'Poblacion or Terminal', to_label: 'Bung-Aw, Bay-Ang', via: null, regular_fare: '35.00', discounted_fare: '28.00', bidirectional: true },
            { row_number: 8, from_label: 'Poblacion or Terminal', to_label: 'Dal-As, Bay-Ang', via: null, regular_fare: '35.00', discounted_fare: '28.00', bidirectional: true },
            { row_number: 56, from_label: 'Land Transport Terminal', to_label: 'Puting Bato Centro', via: null, regular_fare: '50.00', discounted_fare: '40.00', bidirectional: true },
          ],
        };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    },
  };
}

function trip(overrides = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'TRIP-0001',
    cityId: 'cabadbaran',
    cityName: 'Cabadbaran City',
    vehicleId: 'tricycle',
    vehicleName: 'Tricycle',
    origin: 'Poblacion',
    destination: 'Bugho, Bay-Ang',
    distanceKm: 5.81,
    durationMinutes: 9,
    passengers: 1,
    pakyaw: false,
    discountCode: 'none',
    recordedVia: 'live_trip_recording',
    recordedAt: '2026-10-20T08:00:00.000Z',
    points: [{ lat: 9.1, lng: 125.5 }, { lat: 9.09, lng: 125.58 }],
    ...overrides,
  };
}

function providerSettings() {
  return llmSettings({
    FAREFAIR_LLM_BASE_URL: 'https://provider.test/v1',
    FAREFAIR_LLM_MODEL: 'test-model',
    FAREFAIR_LLM_API_KEY: 'test-key',
  });
}

function stubFetch(reply) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: JSON.stringify(reply) } }] };
      },
      async text() {
        return '';
      },
    };
  };
  impl.calls = calls;
  return impl;
}

test('the expected amount is rebuilt from the printed row, not from the stored estimate', async () => {
  resetOverchargeCache();
  const db = fakeDb();
  const result = await analyzeOvercharge(db, trip(), { paid: 40, disableLlm: true });

  assert.equal(result.assessment.expected.amount, 40);
  assert.equal(result.assessment.expected.rowNumber, 6);
  assert.equal(result.assessment.expected.from, 'Poblacion or Terminal');
  assert.equal(result.assessment.status, 'compliant');
  assert.equal(result.engine.mode, 'rules');
  assert.match(result.basis[0], /row 6/);
  assert.match(result.basis[1], /S\.C\.O\. 2020-012/);
});

test('a short payment is compared against the per-passenger row, not the stored total', async () => {
  resetOverchargeCache();
  const db = fakeDb();
  const result = await analyzeOvercharge(db, trip({ passengers: 2 }), {
    paid: 80,
    disableLlm: true,
  });
  assert.equal(result.assessment.expected.amount, 80);
  assert.equal(result.assessment.expected.seatUnits, 2);
  assert.equal(result.assessment.status, 'compliant');
});

test('the model explains a matched-row overcharge and its request carries the evidence', async () => {
  resetOverchargeCache();
  const db = fakeDb();
  const fetchImpl = stubFetch({
    headline: 'The payment matches the Puting Bato Centro fare',
    explanation:
      'The matrix prints 40.00 for Bugho in row 6. The amount paid is 50.00, which is the fare printed for Puting Bato Centro in row 56.',
    mostLikely: 'matched_other_row',
    reasoning: ['The passenger alighted at Bugho, Bay-Ang.', 'Row 56 is a different barangay.'],
    whatToCheck: ['Confirm the drop-off sitio.'],
  });

  const result = await analyzeOvercharge(db, trip(), {
    paid: 50,
    settings: providerSettings(),
    fetchImpl,
  });

  assert.equal(result.engine.mode, 'llm');
  assert.equal(result.engine.model, 'test-model');
  assert.equal(result.assessment.status, 'overcharged');
  assert.equal(result.assessment.delta.amount, 10);
  assert.equal(result.explanation.mostLikely, 'matched_other_row');
  assert.equal(result.hypotheses[0].code, 'matched_other_row');

  const request = fetchImpl.calls[0];
  assert.equal(request.url, 'https://provider.test/v1/chat/completions');
  assert.equal(request.body.model, 'test-model');
  assert.match(request.body.messages[0].content, /Never re-price/);
  assert.match(request.body.messages[1].content, /matched_other_row/);
  assert.match(request.body.messages[1].content, /Bugho, Bay-Ang/);
});

test('a model that invents a fare is discarded and the rule-based reading is kept', async () => {
  resetOverchargeCache();
  const db = fakeDb();
  const fetchImpl = stubFetch({
    headline: 'Overcharged',
    explanation: 'The correct fare should be 38.00 for this trip.',
    mostLikely: 'matched_other_row',
    reasoning: [],
    whatToCheck: [],
  });

  const result = await analyzeOvercharge(db, trip(), {
    paid: 50,
    settings: providerSettings(),
    fetchImpl,
  });

  assert.equal(result.engine.mode, 'rules');
  assert.match(result.engine.note, /rejected/);
  assert.match(result.engine.rejected, /38/);
  assert.equal(result.explanation.verdict, 'overcharged');
  assert.match(result.explanation.headline, /10\.00/);
});

test('a provider outage degrades to rules instead of throwing', async () => {
  resetOverchargeCache();
  const db = fakeDb();
  const fetchImpl = async () => {
    throw new Error('socket hang up');
  };

  const result = await analyzeOvercharge(db, trip(), {
    paid: 55,
    settings: providerSettings(),
    fetchImpl,
  });

  assert.equal(result.engine.mode, 'rules');
  assert.match(result.engine.note, /provider unavailable/);
  assert.equal(result.assessment.status, 'overcharged');
  assert.ok(result.hypotheses.length > 0);
});

test('a pair with no printed row reports that plainly and refuses to judge it', async () => {
  resetOverchargeCache();
  const db = {
    async query(sql) {
      if (sql.includes('fn_lookup_fare_route')) return { rows: [] };
      if (sql.includes('pv.discount_rate')) return { rows: [] };
      if (sql.includes('FROM fare_policy_versions')) {
        return { rows: [{ discount_rate: '0.20', customary_leeway_max: '0.00', pakyaw_seat_cap: 4 }] };
      }
      if (sql.includes('e.ordinance_id')) {
        return { rows: [{ matrix_version_id: 'mv-1', source: 'S.C.O. 2020-012', provisional: true, effective_from: '2026-07-17', ordinance_id: null }] };
      }
      if (sql.includes('FROM fare_matrix_routes')) {
        return { rows: [{ row_number: 6, from_label: 'Poblacion or Terminal', to_label: 'Bugho, Bay-Ang', regular_fare: '40.00', discounted_fare: '32.00', bidirectional: true }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    },
  };

  const result = await analyzeOvercharge(db, trip({ destination: 'Sitio Nowhere' }), {
    paid: 60,
    disableLlm: true,
  });

  assert.equal(result.assessment.status, 'not_covered');
  assert.equal(result.hypotheses[0].code, 'unlisted_place');
  assert.match(result.explanation.headline, /No published fare/);
});

test('a direct hire is a contract trip even when the pair has a printed row', async () => {
  resetOverchargeCache();
  const db = fakeDb();
  // Bugho prints a ₱40 row, but a pakyaw hire is agreed, not printed. The
  // matrix sets no ceiling for it, so the amount must not be judged.
  const result = await analyzeOvercharge(db, trip({ pakyaw: true }), {
    paid: 200,
    disableLlm: true,
  });

  assert.equal(result.assessment.status, 'contract');
  assert.equal(result.assessment.expected, null);
  assert.equal(result.assessment.delta, null);
  assert.equal(result.hypotheses[0].code, 'contract_hire');
});
