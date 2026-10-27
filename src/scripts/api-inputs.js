/**
 * Execute the success-path input matrix in docs/api-inputs.json against the
 * running API and print the ACTUAL status of every operation.
 *
 * Usage:
 *   npm run api:inputs
 *   API_BASE=http://localhost:4000 npm run api:inputs
 *
 * The matrix resolves dynamic path parameters (tripId, quoteId, versionId,
 * anomalyId) from earlier responses, so it works after a database reset.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(here, '..', '..', 'docs');
const matrixPath = path.join(docsDir, 'api-inputs.json');
const resolvedPath = path.join(docsDir, 'api-inputs.resolved.json');

const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
const base = process.env.API_BASE ?? matrix.baseUrl ?? 'http://localhost:4000';
const responses = {};
const results = [];
let failures = 0;

function getPath(value, dottedPath) {
  return dottedPath
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => (current == null ? undefined : current[key]), value);
}

function resolve(value, operationId) {
  if (Array.isArray(value)) {
    return value.map((item) => resolve(item, operationId));
  }
  if (value && typeof value === 'object') {
    if (typeof value.from === 'string' && typeof value.field === 'string') {
      const source = responses[value.from];
      const resolved = getPath(source, value.field);
      if (resolved === undefined) {
        throw new Error(
          `Cannot resolve ${value.from}.${value.field} for ${operationId}. ` +
            `Make sure "${value.from}" runs first and returned JSON.`,
        );
      }
      return resolved;
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolve(item, operationId)]),
    );
  }
  return value;
}

function formatInput(operation, pathParams, query, body) {
  const parts = [];
  if (pathParams && Object.keys(pathParams).length) {
    parts.push(`path=${JSON.stringify(pathParams)}`);
  }
  if (query && Object.keys(query).length) {
    parts.push(`query=${JSON.stringify(query)}`);
  }
  if (body !== undefined) {
    parts.push(`body=${JSON.stringify(body)}`);
  }
  return parts.length ? parts.join(' ') : '-';
}

function compact(text, max = 100) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Keep resolved responses small enough to commit, but detailed enough to
 * infer the response schema used by Swagger.
 */
function sampleResponse(operation, payload) {
  if (payload === undefined) return undefined;
  if (operation.path === '/openapi.json' || operation.path === '/docs') {
    return undefined;
  }
  if (typeof payload === 'string') {
    if (operation.path === '/v1/trips.csv') {
      // Capture a complete header + data row instead of cutting mid-record.
      return payload
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .slice(0, 2)
        .join('\n');
    }
    return payload.length > 600 ? `${payload.slice(0, 600)}…` : payload;
  }
  return sampleValue(payload);
}

function sampleValue(value) {
  if (typeof value === 'string') {
    return value.length > 300 ? `${value.slice(0, 300)}…` : value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 3).map(sampleValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sampleValue(item)]),
    );
  }
  return value;
}

for (const operation of matrix.operations) {
  const pathParams = resolve(operation.pathParams ?? {}, operation.id);
  const query = resolve(operation.query ?? {}, operation.id);
  const body = operation.body ? resolve(operation.body, operation.id) : undefined;
  // `auth` is either a literal bearer token or a { from, field } reference to
  // an earlier /v1/auth/login response, so admin operations are exercised live.
  const auth = operation.auth ? resolve(operation.auth, operation.id) : undefined;

  let requestPath = operation.path;
  for (const [key, value] of Object.entries(pathParams)) {
    requestPath = requestPath.replace(
      new RegExp(`\\{${key}\\}`, 'g'),
      encodeURIComponent(String(value)),
    );
  }

  const url = new URL(requestPath, base);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  let actual = 'ERR';
  let payload;
  let error;
  let contentType = null;
  try {
    const response = await fetch(url, {
      method: operation.method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    actual = response.status;
    contentType = response.headers.get('content-type');
    const text = await response.text();
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  } catch (cause) {
    error = cause.message;
  }

  const ok = actual === operation.expect;
  if (!ok) failures += 1;
  if (payload !== undefined) responses[operation.id] = payload;

  results.push({
    id: operation.id,
    method: operation.method,
    path: requestPath,
    url: `${url.pathname}${url.search}`,
    inputs: formatInput(operation, pathParams, query, body),
    query,
    pathParams,
    body,
    expect: operation.expect,
    actual,
    ok,
    error,
    contentType,
    responseSample: sampleResponse(operation, payload),
  });
}

const headers = ['#', 'METHOD', 'PATH', 'INPUTS', 'EXPECT', 'ACTUAL', 'RESULT'];
const rows = results.map((result, index) => [
  String(index + 1),
  result.method,
  result.url,
  compact(result.inputs),
  String(result.expect),
  String(result.actual),
  result.ok ? 'PASS' : 'FAIL',
]);

const widths = headers.map((header, column) =>
  Math.max(header.length, ...rows.map((row) => row[column].length)),
);
const line = (cells) =>
  cells.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd();

console.log(`\nSuccess-path API input matrix (live HTTP statuses) — ${base}\n`);
console.log(line(headers));
console.log(line(widths.map((width) => '-'.repeat(width))));
for (const row of rows) console.log(line(row));

await writeFile(
  resolvedPath,
  `${JSON.stringify(
    {
      baseUrl: base,
      generatedAt: new Date().toISOString(),
      results,
    },
    null,
    2,
  )}\n`,
  'utf8',
);

if (failures) {
  console.log(`\n${failures} operation(s) failed:`);
  for (const result of results.filter((item) => !item.ok)) {
    console.log(
      `- ${result.method} ${result.url} -> ${result.actual} (expected ${result.expect})${result.error ? `: ${result.error}` : ''}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `\nAll ${results.length} operations returned their expected status. ` +
      `Resolved inputs were written to docs/api-inputs.resolved.json.`,
  );
}
