/**
 * Trip analysis orchestration.
 *
 * The rule engine always runs. A language model is optional and additive: it
 * may only rank the rule findings and write the narrative. Anything that fails
 * validation is discarded, so the endpoint degrades to rules mode instead of
 * inventing a fare.
 */

import {
  ACTIONS,
  FINDING_CODES,
  RISK_ORDER,
  actionForRisk,
  analyzeFacts,
  baselineFindings,
  baselineNarrative,
  confidenceFromFacts,
  maxRisk,
  riskFromFindings,
  validateNarrative,
} from '../lib/trip-analysis.js';
import { completeJson, disabledReason, llmSettings } from './llm.js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

const SYSTEM_PROMPT = [
  'You are a fare-compliance analyst for FareFair, a Philippine public-transport fare reference.',
  'You receive one JSON packet describing a single recorded trip plus the rule findings computed from it.',
  '',
  'Hard rules:',
  '- The packet is the only source of truth. Never add facts, fares, laws, places or operators.',
  '- Never state a number that is not already present in the packet or the findings. No arithmetic, no estimates.',
  '- Do not decide whether the fare is legal: the stored amount already comes from the published matrix.',
  '- Do not speculate about intent or name any person.',
  '- Recommended actions are limited to: ' + ACTIONS.join(', ') + '.',
  '- Reply with a single JSON object and nothing else.',
].join('\n');

export async function analyzeTrip(detail, options = {}) {
  const facts = analyzeFacts(detail);
  const findings = baselineFindings(facts);
  const ruleRisk = riskFromFindings(findings);
  const confidence = confidenceFromFacts(facts);
  const baseline = baselineNarrative(facts, findings, ruleRisk);

  const settings = options.settings || llmSettings(options.env);
  const engine = {
    mode: 'rules',
    model: null,
    latencyMs: 0,
    note: null,
    rejected: null,
  };

  let narrative = baseline;
  let key = null;

  if (settings.enabled && !options.disableLlm) {
    key = cacheKey(detail, settings, findings);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.payload;
    }

    try {
      const result = await completeJson({
        settings,
        system: SYSTEM_PROMPT,
        user: buildPrompt(facts, findings, ruleRisk),
        fetchImpl: options.fetchImpl,
      });
      const validated = validateNarrative(result.value, facts, findings);
      if (validated.ok) {
        const risk = maxRisk(ruleRisk, validated.value.risk);
        narrative = {
          ...validated.value,
          risk,
          recommendedAction:
            actionIndex(validated.value.recommendedAction) >
            actionIndex(actionForRisk(risk))
              ? validated.value.recommendedAction
              : actionForRisk(risk),
        };
        engine.mode = 'llm';
        engine.model = result.model;
        engine.latencyMs = result.latencyMs;
      } else {
        engine.note = 'model narrative rejected; showing rule-based analysis';
        engine.rejected = validated.reason;
      }
    } catch (error) {
      engine.note = `provider unavailable; showing rule-based analysis (${short(error)})`;
    }
  } else if (!settings.enabled) {
    engine.note = disabledReason(settings);
  }

  const ordered = orderFindings(findings, narrative.priorities);
  const payload = {
    tripId: detail.id,
    reference: detail.reference,
    generatedAt: new Date().toISOString(),
    engine,
    verdict: {
      risk: narrative.risk,
      headline: narrative.headline,
      summary: narrative.summary,
      confidence,
      recommendedAction: narrative.recommendedAction,
    },
    facts,
    findings: ordered,
    checks: narrative.checks,
    basis: basisFor(facts),
    disclaimer:
      'Fare amounts come from the published matrix; this analysis only describes the recorded trip.',
  };

  if (engine.mode === 'llm' && key) {
    cache.set(key, { at: Date.now(), payload });
  }
  return payload;
}

export function resetAnalysisCache() {
  cache.clear();
}

function buildPrompt(facts, findings, risk) {
  const shape = {
    headline: 'one sentence, at most 200 characters',
    summary: 'two or three sentences, at most 600 characters',
    risk: RISK_ORDER.join(' | '),
    priorities: ['rule finding codes, most important first'],
    recommendedAction: ACTIONS.join(' | '),
    checks: ['up to four short items a human should verify'],
  };
  return [
    'Rule findings (authoritative, do not invent others):',
    JSON.stringify(findings, null, 2),
    '',
    `Deterministic risk before your review: ${risk}`,
    '',
    'Trip packet:',
    JSON.stringify(facts, null, 2),
    '',
    'Finding codes available:',
    JSON.stringify(FINDING_CODES, null, 2),
    '',
    'Reply with exactly this shape:',
    JSON.stringify(shape, null, 2),
  ].join('\n');
}

function orderFindings(findings, priorities) {
  if (!Array.isArray(priorities) || !priorities.length) return findings;
  const order = new Map(priorities.map((code, index) => [code, index]));
  return findings
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const rankA = order.has(a.row.code) ? order.get(a.row.code) : Number.MAX_SAFE_INTEGER;
      const rankB = order.has(b.row.code) ? order.get(b.row.code) : Number.MAX_SAFE_INTEGER;
      return rankA - rankB || a.index - b.index;
    })
    .map((entry) => entry.row);
}

function basisFor(facts) {
  return [
    facts.fare.published
      ? `fare: published row ${facts.fare.routeRow}`
      : 'fare: distance engine (no published row)',
    `matrix band: ${facts.fare.rangeMin.toFixed(2)} – ${facts.fare.rangeMax.toFixed(2)} ${facts.fare.currency}`,
    `distance: ${facts.trip.distanceKm.toFixed(2)} km declared`,
    `gps: ${facts.gps.points} breadcrumb${facts.gps.points === 1 ? '' : 's'}`,
  ];
}

function cacheKey(detail, settings, findings) {
  return `${cacheKeyFor(detail, settings)}:${findings.length}`;
}

function cacheKeyFor(detail, settings) {
  return [
    detail.id,
    detail.status,
    detail.anomalies?.length ?? 0,
    settings.model,
  ].join(':');
}

function actionIndex(action) {
  const index = ACTIONS.indexOf(action);
  return index === -1 ? 0 : index;
}

function short(error) {
  const message = String(error?.message || error || 'unknown error');
  return message.length > 120 ? `${message.slice(0, 119)}…` : message;
}
