/**
 * Generate docs/API_INPUTS.md from docs/api-inputs.json and the last
 * docs/api-inputs.resolved.json run.
 *
 * Usage:
 *   npm run api:inputs       # refresh resolved values + actual statuses
 *   npm run docs:inputs      # regenerate this Markdown
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(here, '..', '..', 'docs');

const matrix = JSON.parse(await readFile(path.join(docsDir, 'api-inputs.json'), 'utf8'));
let resolved = null;
try {
  resolved = JSON.parse(
    await readFile(path.join(docsDir, 'api-inputs.resolved.json'), 'utf8'),
  );
} catch {
  // Optional; the doc still renders from the fixture when no run exists.
}

const resolvedById = new Map(
  (resolved?.results ?? []).map((result) => [result.id, result]),
);

function flatten(value, prefix = '', output = []) {
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== 'object')) {
      output.push([prefix, JSON.stringify(value)]);
    } else {
      value.forEach((item, index) => {
        flatten(item, `${prefix}[${index}]`, output);
      });
    }
    return output;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      flatten(item, prefix ? `${prefix}.${key}` : key, output);
    }
    return output;
  }
  output.push([prefix, String(value)]);
  return output;
}

function table(rows) {
  if (!rows.length) return '_No inputs._\n';
  const lines = ['| Field | Value |', '| --- | --- |'];
  for (const [field, value] of rows) {
    lines.push(`| \`${field}\` | ${value === '' ? '*(blank)*' : `\`${value.replaceAll('|', '\\|')}\``} |`);
  }
  return `${lines.join('\n')}\n`;
}

const sections = [];
for (const [index, operation] of matrix.operations.entries()) {
  const actual = resolvedById.get(operation.id);
  const pathParams = actual?.pathParams ?? operation.pathParams ?? {};
  const query = actual?.query ?? operation.query ?? {};
  const body = actual?.body ?? operation.body;
  const rows = [];

  for (const [field, value] of Object.entries(pathParams)) {
    rows.push([`path.${field}`, String(value)]);
  }
  for (const [field, value] of Object.entries(query)) {
    rows.push([`query.${field}`, String(value)]);
  }
  if (body !== undefined) {
    for (const [field, value] of flatten(body)) {
      rows.push([`body.${field}`, value]);
    }
  }

  const status = actual ? actual.actual : 'not run';
  const result = actual ? (actual.ok ? 'PASS' : 'FAIL') : '-';

  sections.push(
    [
      `### ${index + 1}. ${operation.method} ${operation.path}`,
      '',
      `**Success status:** \`${operation.expect}\`  `,
      `**Last actual status:** \`${status}\` (${result})`,
      '',
      table(rows),
    ].join('\n'),
  );
}

const summary = [
  '| # | Method | Path | Success | Last actual | Result |',
  '| --- | --- | --- | --- | --- | --- |',
  ...matrix.operations.map((operation, index) => {
    const actual = resolvedById.get(operation.id);
    return `| ${index + 1} | ${operation.method} | \`${operation.path}\` | ${operation.expect} | ${actual ? actual.actual : '-'} | ${actual ? (actual.ok ? 'PASS' : 'FAIL') : '-'} |`;
  }),
].join('\n');

const document = `# FareFair API input matrix

Success-path inputs for every FareFair API operation, from \`GET /health\` and
\`GET /v1/meta\` through analytics. The machine-readable source is
[\`api-inputs.json\`](./api-inputs.json); execution results are written to
\`api-inputs.resolved.json\`.

## How to run

\`\`\`bash
cd backend
npm run api:inputs      # execute all operations against http://localhost:4000
npm run docs:examples   # apply the latest examples to Swagger/OpenAPI
\`\`\`

- \`GET\` operations return **200**.
- \`POST /v1/trips\`, \`POST /v1/fare/models/train\` and \`POST /v1/admin/audit\` return **201**
  because they create a resource; every other operation returns **200**.
- Dynamic values (\`tripId\`, \`quoteId\`, \`versionId\`, \`anomalyId\`) are resolved from earlier
  responses by the runner, so the matrix still works after \`npm run db:reset\`.
- The matrix signs in with \`admin@farefair.local\`, sends that bearer token to the
  \`/v1/auth/*\` and \`/v1/admin/*\` operations, and signs out at the end.
- Base URL: \`${matrix.baseUrl}\`.
- Current focus dataset: \`cityId=cabadbaran\`, \`vehicleId=tricycle\`, \`modelKey=fare-fair-linear\`.

## Response contract

Every operation keeps the same success contract:

- **Blank optional inputs are treated as absent.** An empty query value
  (\`?cityId=&search=&limit=\`) or an empty request body falls back to the documented
  default and still returns \`200\`/\`201\`.
- **Empty result sets still succeed.** Filters that match nothing return \`200\` with
  \`data: []\`, \`count: 0\` and \`pagination.total: 0\` (or zeroed analytics totals)
  instead of \`404\`.
- **Every documented field is present.** Serializers emit \`null\` for genuinely
  unknown values (for example an open-ended \`effectiveTo\` or an unobserved fare)
  rather than dropping the key.
- **Only invalid input fails.** An unknown enum value, malformed UUID, malformed
  JSON or an out-of-range number returns \`400\` (\`VALIDATION_ERROR\`, \`INVALID_ID\`
  or \`INVALID_JSON\`); a body over 2 MB returns \`413\`.
- **Swagger shows real responses.** \`npm run docs:examples\` copies the response sample
  captured by the last \`api:inputs\` run into the \`200\`/\`201\` schema and example
  for every operation.

## Status summary

${summary}

## Inputs per operation

${sections.join('\n\n')}
`;

await writeFile(path.join(docsDir, 'API_INPUTS.md'), document, 'utf8');
console.log('[farefair] wrote docs/API_INPUTS.md');
