/**
 * Apply the success-path inputs from docs/api-inputs.json (and the last resolved
 * run in docs/api-inputs.resolved.json) to docs/openapi.json.
 *
 * - Adds example values to every query/path parameter and request body.
 * - Adds the two operations that were missing from the spec:
 *     GET /v1/fare/quotes/{quoteId}
 *     GET /v1/fare/predictions
 * - Documents activate/resolve request bodies and the missing filter fields.
 *
 * Usage:
 *   npm run api:inputs      # refresh docs/api-inputs.resolved.json
 *   npm run docs:examples   # apply the latest values to docs/openapi.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(here, '..', '..', 'docs');

const spec = JSON.parse(await readFile(path.join(docsDir, 'openapi.json'), 'utf8'));
const matrix = JSON.parse(await readFile(path.join(docsDir, 'api-inputs.json'), 'utf8'));
const resolved = JSON.parse(
  await readFile(path.join(docsDir, 'api-inputs.resolved.json'), 'utf8'),
);
const resolvedById = new Map(resolved.results.map((result) => [result.id, result]));

function paramsOf(operation) {
  if (!operation.parameters) operation.parameters = [];
  return operation.parameters;
}

function setParameter(operation, name, value, location) {
  let parameter = paramsOf(operation).find(
    (item) => !item.$ref && item.name === name && item.in === location,
  );
  if (!parameter) {
    parameter = {
      name,
      in: location,
      required: location === 'path',
      schema: { type: typeof value === 'number' ? 'integer' : 'string' },
    };
    paramsOf(operation).push(parameter);
  }
  parameter.required = location === 'path';
  parameter.example = value;
  parameter.schema = { ...(parameter.schema ?? {}), example: value };
}

function jsonMedia(operation) {
  return operation.requestBody?.content?.['application/json'];
}

function applyBody(operation, body) {
  if (!operation.requestBody) return;
  const media = jsonMedia(operation);
  if (!media) return;
  media.example = body;
  const properties = media.schema?.properties;
  if (properties) {
    for (const [key, schema] of Object.entries(properties)) {
      if (body[key] !== undefined) schema.example = body[key];
    }
  }
}

function addPropertyExamples(schema, values) {
  for (const [key, value] of Object.entries(values)) {
    if (schema.properties?.[key]) schema.properties[key].example = value;
  }
}

/* -------------------------------------------------------------------------
 * 1. Add operations that exist in the API but were missing from the spec.
 * ---------------------------------------------------------------------- */
if (!spec.paths['/v1/fare/quotes/{quoteId}']) {
  const quoteExample = resolvedById.get('quote')?.pathParams?.quoteId;
  spec.paths['/v1/fare/quotes/{quoteId}'] = {
    get: {
      tags: ['Fares'],
      summary: 'Fetch a persisted fare quote',
      parameters: [
        {
          name: 'quoteId',
          in: 'path',
          required: true,
          example: quoteExample,
          schema: { type: 'string', format: 'uuid', example: quoteExample },
        },
      ],
      responses: {
        200: {
          description: 'Persisted quote',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  cityId: { type: 'string' },
                  cityName: { type: 'string' },
                  vehicleId: { type: 'string' },
                  vehicleName: { type: 'string' },
                  matrixVersionId: { type: 'string', format: 'uuid' },
                  policyVersionId: { type: 'string', format: 'uuid' },
                  tripId: { type: 'string', format: 'uuid', nullable: true },
                  modelVersionId: { type: 'string', format: 'uuid', nullable: true },
                  distanceKm: { type: 'number' },
                  passengers: { type: 'integer' },
                  pakyaw: { type: 'boolean' },
                  discountCode: { type: 'string' },
                  fare: { type: 'object' },
                  createdAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        404: { $ref: '#/components/responses/Error' },
      },
    },
  };
}

if (!spec.paths['/v1/fare/predictions']) {
  const versionId = resolvedById.get('model-version')?.pathParams?.versionId;
  spec.paths['/v1/fare/predictions'] = {
    get: {
      tags: ['Fares'],
      summary: 'Prediction history from the ML registry',
      parameters: [
        {
          name: 'modelVersionId',
          in: 'query',
          required: false,
          example: versionId,
          schema: { type: 'string', format: 'uuid', example: versionId },
        },
        {
          name: 'tripId',
          in: 'query',
          required: false,
          example: resolvedById.get('trip')?.pathParams?.tripId,
          schema: {
            type: 'string',
            format: 'uuid',
            example: resolvedById.get('trip')?.pathParams?.tripId,
          },
        },
        {
          name: 'limit',
          in: 'query',
          required: false,
          example: 50,
          schema: { type: 'integer', minimum: 1, maximum: 500, default: 50, example: 50 },
        },
      ],
      responses: {
        200: {
          description: 'Predictions',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  data: { type: 'array', items: { type: 'object' } },
                  count: { type: 'integer', example: 50 },
                },
              },
            },
          },
        },
      },
    },
  };
}

/* -------------------------------------------------------------------------
 * 1b. Official point-to-point fare routes (Cabadbaran tricycle matrix).
 * ---------------------------------------------------------------------- */
const fareRouteSchema = {
  type: 'object',
  properties: {
    rowNumber: { type: 'integer', example: 4 },
    vehicleId: { type: 'string', example: 'tricycle' },
    vehicleName: { type: 'string', example: 'Tricycle' },
    from: { type: 'string', example: 'Poblacion or Terminal' },
    to: { type: 'string', example: 'Bayabas' },
    via: { type: ['string', 'null'], example: null },
    regularFare: { type: 'number', example: 50 },
    discountedFare: { type: 'number', example: 40 },
    remark: { type: ['string', 'null'], example: null },
    bidirectional: { type: 'boolean', example: true },
  },
};

if (!spec.components.schemas.FareRoute) {
  spec.components.schemas.FareRoute = fareRouteSchema;
}

const fareRouteListResponse = {
  description: 'Published fare routes',
  content: {
    'application/json': {
      schema: {
        type: 'object',
        properties: {
          cityId: { type: 'string', example: 'cabadbaran' },
          cityName: { type: 'string', example: 'Cabadbaran City, Caraga' },
          matrixVersionId: { type: ['string', 'null'], format: 'uuid' },
          vehicleId: { type: ['string', 'null'], example: 'tricycle' },
          effectiveFrom: { type: ['string', 'null'], format: 'date', example: '2026-09-24' },
          provisional: { type: ['boolean', 'null'], example: false },
          source: { type: 'string', example: 'Cabadbaran City Tricycle Fare Matrix — Official rates effective 24 September 2026' },
          count: { type: 'integer', example: 68 },
          data: { type: 'array', items: { $ref: '#/components/schemas/FareRoute' } },
        },
      },
    },
  },
};

if (!spec.paths['/v1/cities/{cityId}/fare-routes']) {
  spec.paths['/v1/cities/{cityId}/fare-routes'] = {
    get: {
      tags: ['Catalog'],
      summary: 'Official point-to-point fare routes for a city',
      description:
        'Returns the published LGU fare rows for the city, including the effective date, provisional flag and both regular and discounted per-passenger fares. Empty searches return 200 with an empty data array.',
      parameters: [
        { $ref: '#/components/parameters/CityId' },
        {
          name: 'vehicleId',
          in: 'query',
          required: false,
          example: 'tricycle',
          schema: { type: 'string', example: 'tricycle' },
        },
        {
          name: 'search',
          in: 'query',
          required: false,
          example: 'Bayabas',
          schema: { type: 'string', example: 'Bayabas' },
        },
      ],
      responses: {
        200: fareRouteListResponse,
        404: { $ref: '#/components/responses/Error' },
      },
    },
  };
}

if (!spec.paths['/v1/fare/routes']) {
  spec.paths['/v1/fare/routes'] = {
    get: {
      tags: ['Fares'],
      summary: 'Official fare routes across the focus city',
      description:
        'City-scoped alias of GET /v1/cities/{cityId}/fare-routes. When cityId is omitted the focus city (Cabadbaran) is used.',
      parameters: [
        {
          name: 'cityId',
          in: 'query',
          required: false,
          example: 'cabadbaran',
          schema: { type: 'string', example: 'cabadbaran' },
        },
        {
          name: 'vehicleId',
          in: 'query',
          required: false,
          example: 'tricycle',
          schema: { type: 'string', example: 'tricycle' },
        },
        {
          name: 'search',
          in: 'query',
          required: false,
          example: 'Poblacion',
          schema: { type: 'string', example: 'Poblacion' },
        },
      ],
      responses: {
        200: fareRouteListResponse,
        404: { $ref: '#/components/responses/Error' },
      },
    },
  };
}

if (!spec.paths['/v1/admin/cities/{cityId}/fare-routes/{rowNumber}']) {
  spec.paths['/v1/admin/cities/{cityId}/fare-routes/{rowNumber}'] = {
    put: {
      tags: ['Admin'],
      summary: 'Replace one published fare route',
      description:
        'Updates the regular and discounted per-passenger fare for one official row. Requires admin or lgu_editor with the city in scope; analysts are read-only. The write is recorded as a fare_route.update audit event.',
      security: [{ bearerAuth: [] }],
      parameters: [
        {
          name: 'cityId',
          in: 'path',
          required: true,
          example: 'cabadbaran',
          schema: { type: 'string', example: 'cabadbaran' },
        },
        {
          name: 'rowNumber',
          in: 'path',
          required: true,
          example: 4,
          schema: { type: 'integer', minimum: 1, example: 4 },
        },
        {
          name: 'vehicleId',
          in: 'query',
          required: false,
          example: 'tricycle',
          schema: { type: 'string', default: 'tricycle', example: 'tricycle' },
        },
      ],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['regularFare', 'discountedFare'],
              properties: {
                fromLabel: { type: 'string', example: 'Poblacion or Terminal' },
                toLabel: { type: 'string', example: 'Bayabas' },
                via: { type: 'string' },
                regularFare: { type: 'number', minimum: 0, example: 50 },
                discountedFare: { type: 'number', minimum: 0, example: 40 },
                remark: { type: 'string', example: '' },
                bidirectional: { type: 'boolean', default: true, example: true },
              },
            },
            example: {
              regularFare: 50,
              discountedFare: 40,
              remark: '',
              bidirectional: true,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Stored fare route',
          content: {
            'application/json': {
              schema: {
                allOf: [
                  { $ref: '#/components/schemas/FareRoute' },
                  {
                    type: 'object',
                    properties: {
                      cityId: { type: 'string', example: 'cabadbaran' },
                      matrixVersionId: { type: 'string', format: 'uuid' },
                      updatedBy: { type: 'string', example: 'Cabadbaran LGU Editor' },
                    },
                  },
                ],
              },
            },
          },
        },
        400: { $ref: '#/components/responses/Error' },
        401: { $ref: '#/components/responses/Error' },
        403: { $ref: '#/components/responses/Error' },
        404: { $ref: '#/components/responses/Error' },
      },
    },
  };
}

// PUT is the idempotent form of the full fare-matrix entry replacement.
const matrixPath = spec.paths['/v1/admin/cities/{cityId}/fare-matrix/{vehicleId}'];
if (matrixPath?.patch && !matrixPath.put) {
  matrixPath.put = {
    ...structuredClone(matrixPath.patch),
    summary: 'Replace one vehicle tariff in the active matrix',
    description:
      'Idempotent form of PATCH. Writes fare_matrix_entries for the active matrix of the city and records a fare.update audit event. Requires admin or lgu_editor with the city in scope; analysts are read-only.',
  };
}

/* -------------------------------------------------------------------------
 * 2. GET /v1/trips always returns 200 for valid input. Remove the documented
 *    400 block that Swagger displays as a synthetic "Error response" panel;
 *    keep the runtime behaviour documented in the description instead.
 * ---------------------------------------------------------------------- */
const tripsOperation = spec.paths['/v1/trips'].get;
delete tripsOperation.responses['400'];
tripsOperation.description =
  'Returns 200 for every valid query, even when no trips match. ' +
  'Invalid query values return 400 at runtime.';

/* -------------------------------------------------------------------------
 * 3. Apply examples from the resolved matrix.
 * ---------------------------------------------------------------------- */
for (const operation of matrix.operations) {
  const target = spec.paths[operation.path]?.[operation.method.toLowerCase()];
  if (!target) continue;

  const resolvedOperation = resolvedById.get(operation.id);
  const pathParams = resolvedOperation?.pathParams ?? operation.pathParams ?? {};
  const query = resolvedOperation?.query ?? operation.query ?? {};
  const body = resolvedOperation?.body ?? operation.body;

  for (const [name, value] of Object.entries(pathParams)) {
    setParameter(target, name, value, 'path');
  }
  for (const [name, value] of Object.entries(query)) {
    setParameter(target, name, value, 'query');
  }
  if (body !== undefined) applyBody(target, body);
}

/* -------------------------------------------------------------------------
 * 3. Fill documented parameters that the matrix does not exercise directly.
 * ---------------------------------------------------------------------- */
const tripsGet = spec.paths['/v1/trips'].get;
const tripQueryExamples = Object.fromEntries(
  tripsGet.parameters.map((parameter) => [
    parameter.name,
    parameter.example ?? parameter.schema?.example,
  ]),
);

const csvParameters = [
  'cityId',
  'vehicleId',
  'status',
  'discountCode',
  'recordedVia',
  'from',
  'to',
  'search',
].map((name) => {
  const existing = tripsGet.parameters.find((parameter) => parameter.name === name);
  return {
    name,
    in: 'query',
    required: false,
    example: existing?.example ?? tripQueryExamples[name],
    schema: { ...(existing?.schema ?? { type: 'string' }), example: tripQueryExamples[name] },
  };
});
spec.paths['/v1/trips.csv'].get.parameters = csvParameters;

const anomalyParams = spec.paths['/v1/anomalies'].get.parameters;
for (const parameter of [
  {
    name: 'kind',
    in: 'query',
    required: false,
    example: 'manual_flag',
    schema: { type: 'string', example: 'manual_flag' },
  },
  {
    name: 'offset',
    in: 'query',
    required: false,
    example: 0,
    schema: { type: 'integer', minimum: 0, default: 0, example: 0 },
  },
]) {
  if (!anomalyParams.some((item) => item.name === parameter.name)) {
    anomalyParams.push(parameter);
  }
}

const auditParams = spec.paths['/v1/audit'].get.parameters;
if (!auditParams.some((item) => item.name === 'offset')) {
  auditParams.push({
    name: 'offset',
    in: 'query',
    required: false,
    example: 0,
    schema: { type: 'integer', minimum: 0, default: 0, example: 0 },
  });
}

/* -------------------------------------------------------------------------
 * 4. Request bodies for activate + resolve, and the train role field.
 * ---------------------------------------------------------------------- */
const activate = spec.paths['/v1/fare/models/versions/{versionId}/activate'].post;
if (!activate.requestBody) {
  const body = resolvedById.get('activate')?.body ?? {
    actorName: 'api-inputs',
    role: 'system',
  };
  activate.requestBody = {
    required: false,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            actorName: { type: 'string', default: 'API', example: body.actorName },
            role: { type: 'string', default: 'system', example: body.role },
          },
        },
        example: body,
      },
    },
  };
}

const resolve = spec.paths['/v1/anomalies/{anomalyId}/resolve'].patch;
if (!resolve.requestBody) {
  const body = resolvedById.get('resolve-anomaly')?.body ?? {
    resolutionNote: 'Verified by API input example',
    actorName: 'api-inputs',
  };
  resolve.requestBody = {
    required: false,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            resolutionNote: {
              type: 'string',
              default: 'Resolved via API',
              example: body.resolutionNote,
            },
            actorName: { type: 'string', default: 'API', example: body.actorName },
          },
        },
        example: body,
      },
    },
  };
}

const train = spec.paths['/v1/fare/models/train'].post;
const trainBody = resolvedById.get('train')?.body ?? {
  modelKey: 'fare-fair-linear',
  activate: true,
  actorName: 'api-inputs',
  role: 'system',
};
const trainSchema = train.requestBody.content['application/json'].schema;
trainSchema.properties.role = {
  type: 'string',
  default: 'system',
  example: trainBody.role,
};
train.requestBody.content['application/json'].example = trainBody;

/* -------------------------------------------------------------------------
 * 5. Property-level examples for reusable request schemas.
 * ---------------------------------------------------------------------- */
const estimateBody = resolvedById.get('estimate')?.body ?? matrix.operations.find(
  (operation) => operation.id === 'estimate',
).body;
addPropertyExamples(spec.components.schemas.FareInput, estimateBody);

const tripBody = resolvedById.get('create-trip')?.body ?? matrix.operations.find(
  (operation) => operation.id === 'create-trip',
).body;
addPropertyExamples(spec.components.schemas.TripCreate, tripBody);
spec.components.schemas.TripCreate.properties.routePoints.example = tripBody.routePoints;

/* -------------------------------------------------------------------------
 * 5b. Official-route fields and Cabadbaran-only schema adjustments.
 * ---------------------------------------------------------------------- */
const fareInput = spec.components.schemas.FareInput;
fareInput.required = ['cityId', 'vehicleId'];
fareInput.properties.distanceKm = {
  type: 'number',
  minimum: 0,
  maximum: 500,
  example: 4.2,
  description:
    'Required only when origin/destination is not a published fare row. For official rows the distance is derived from the published fare.',
};
fareInput.properties.origin = {
  type: 'string',
  maxLength: 200,
  example: 'Poblacion',
  description: 'Official origin label; matched against the published matrix and its aliases.',
};
fareInput.properties.destination = {
  type: 'string',
  maxLength: 200,
  example: 'Bayabas',
  description: 'Official destination label; matched against the published matrix and its aliases.',
};

const tripCreate = spec.components.schemas.TripCreate;
tripCreate.required = ['cityId', 'vehicleId', 'origin', 'destination'];
tripCreate.properties.distanceKm = {
  type: 'number',
  minimum: 0,
  maximum: 500,
  example: 19.5,
  description:
    'Optional for published fare rows; derived from the official fare when omitted.',
};
tripCreate.properties.origin.example = 'Poblacion';
tripCreate.properties.destination.example = 'Bayabas';

const citySummary = spec.components.schemas.CitySummary;
if (citySummary) {
  citySummary.properties.provisional.example = false;
  citySummary.properties.activeVehicleCount.example = 1;
  citySummary.properties.ordinanceCount.example = 1;
  citySummary.properties.fareRouteCount = {
    type: 'integer',
    example: 68,
    description: 'Number of published fare rows attached to the active matrix.',
  };
}

const fareEstimate = spec.components.schemas.FareEstimate;
if (fareEstimate) {
  const estimateBody = resolvedById.get('estimate')?.body ?? {};
  fareEstimate.properties.distanceKm.example = 19.5;
  fareEstimate.properties.passengers.example = 1;
  fareEstimate.properties.provisional.example = false;
  objectAssignMissing(fareEstimate.properties, {
    distanceKmSource: {
      type: 'string',
      enum: ['requested', 'derived_from_published_fare'],
      example: 'derived_from_published_fare',
    },
    origin: { type: ['string', 'null'], example: estimateBody.origin ?? 'Poblacion' },
    destination: { type: ['string', 'null'], example: estimateBody.destination ?? 'Bayabas' },
    fareSource: {
      type: 'string',
      enum: ['official_matrix', 'distance_matrix'],
      example: 'official_matrix',
    },
    routeRowNumber: { type: ['integer', 'null'], example: 4 },
    route: {
      type: ['object', 'null'],
      properties: {
        rowNumber: { type: 'integer', example: 4 },
        from: { type: 'string', example: 'Poblacion or Terminal' },
        to: { type: 'string', example: 'Bayabas' },
        matchedOrigin: { type: 'string', example: 'Poblacion' },
        matchedDestination: { type: 'string', example: 'Bayabas' },
        via: { type: ['string', 'null'], example: null },
        remark: { type: ['string', 'null'], example: null },
        reversed: { type: 'boolean', example: false },
        regularFare: { type: 'number', example: 50 },
        discountedFare: { type: 'number', example: 40 },
      },
    },
  });
}

function objectAssignMissing(target, values) {
  for (const [key, value] of Object.entries(values)) {
    if (!target[key]) target[key] = value;
  }
}

/* -------------------------------------------------------------------------
 * 6. Realistic examples on response schemas (swagger response previews).
 * ---------------------------------------------------------------------- */
const propertyExamples = {
  id: '89328f5c-8c71-4aa8-b8fa-fd7db3c460ae',
  cityId: 'cabadbaran',
  cityName: 'Cabadbaran City, Caraga',
  vehicleId: 'tricycle',
  vehicleName: 'Tricycle',
  category: 'tricycle',
  reference: 'FF-5072',
  origin: 'Poblacion',
  destination: 'Bayabas',
  district: 'Poblacion',
  currency: 'PHP',
  discountCode: 'none',
  discountRate: 0.2,
  recordVia: 'live_trip_recording',
  recordedVia: 'live_trip_recording',
  algorithm: 'ordinary_least_squares_ridge',
  modelKey: 'fare-fair-linear',
  name: 'FareFair Linear Fare Baseline',
  province: 'Agusan del Norte',
  region: 'Caraga',
  centroLabel: 'Cabadbaran City',
  source: 'Cabadbaran City Tricycle Fare Matrix — Official rates effective 24 September 2026',
  flagReason: '',
  externalId: 'cabadbaran-tricycle-fare-matrix-2026',
  slug: 'cabadbaran-cabadbaran-tricycle-fare-matrix-2026',
  title: 'Cabadbaran City Tricycle Fare Matrix',
  municipality: 'Cabadbaran City, Agusan del Norte',
  ordinanceNumber: '',
  vehicleApplicability: 'Tricycle',
  summary: 'Official per-passenger tricycle fares for Poblacion and barangay routes.',
  vehicleIds: ['tricycle'],
  baseFare: 13,
  succeedingKmRate: 2,
  baseDistanceKm: 1,
  perKmRate: 2,
  minFare: 13,
  maxCustomary: 75,
  typicalCapacity: 4,
  distanceKm: 19.5,
  durationSeconds: 900,
  passengers: 2,
  exact: 100,
  min: 100,
  max: 100,
  lowerBound: 95,
  upperBound: 105,
  confidence: 0.98,
  residualStddev: 1.8467,
  trainingRows: 226,
  version: 1,
  isFocus: true,
  provisional: false,
  activeVehicleCount: 1,
  fareRouteCount: 68,
  ordinanceCount: 1,
  count: 1,
  total: 226,
  limit: 50,
  offset: 0,
  hasMore: true,
  days: 30,
  status: 'active',
  role: 'system',
  createdAt: '2026-10-26T00:42:20.771Z',
  updatedAt: '2026-10-26T00:42:20.771Z',
  recordedAt: '2026-10-26T08:00:00.000Z',
  trainedAt: '2026-10-26T00:42:20.752Z',
  activatedAt: '2026-10-26T00:42:20.771Z',
};

for (const schema of Object.values(spec.components.schemas)) {
  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    if (
      property.example === undefined &&
      Object.hasOwn(propertyExamples, name)
    ) {
      property.example = propertyExamples[name];
    }
  }
}

spec.components.parameters.CityId.example = 'cabadbaran';
spec.components.parameters.CityId.schema.example = 'cabadbaran';

// One realistic example for the trip list response.
const tripsResponse =
  spec.paths['/v1/trips'].get.responses['200'].content['application/json'];
tripsResponse.example = {
  data: [
    {
      id: resolvedById.get('trip')?.pathParams?.tripId ?? '35d0acaf-1615-4feb-88a8-3d43152590ee',
      reference: 'FF-5072',
      cityId: 'cabadbaran',
      cityName: 'Cabadbaran City, Caraga',
      vehicleId: 'tricycle',
      vehicleName: 'Tricycle',
      origin: 'Poblacion',
      destination: 'Bayabas',
      distanceKm: 19.5,
      durationSeconds: 900,
      passengers: 2,
      pakyaw: false,
      discountCode: 'none',
      fare: { currency: 'PHP', exact: 100, min: 100, max: 100 },
      fareSource: 'official_matrix',
      routeRowNumber: 4,
      status: 'completed',
      flagReason: '',
      recordedVia: 'live_trip_recording',
      recordedAt: '2026-10-26T08:00:00.000Z',
    },
  ],
  pagination: { total: 226, limit: 50, offset: 0, hasMore: true },
};

/* -------------------------------------------------------------------------
 * 7. Infer response schemas/examples from the last live run so every
 *    documented field reflects a real 200/201 response.
 * ---------------------------------------------------------------------- */
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function inferSchema(value) {
  if (value === null) return { nullable: true };
  if (Array.isArray(value)) {
    const first = value.find((item) => item !== null && item !== undefined);
    return {
      type: 'array',
      items: first === undefined ? {} : inferSchema(first),
    };
  }
  if (typeof value === 'object') {
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, inferSchema(item)]),
      ),
    };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'integer' } : { type: 'number' };
  }
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (typeof value === 'string') {
    if (isUuid(value)) return { type: 'string', format: 'uuid' };
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(value)) {
      return { type: 'string', format: 'date-time' };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { type: 'string', format: 'date' };
    }
    return { type: 'string' };
  }
  return {};
}

function isWeakSchema(schema) {
  if (!schema) return true;
  if (schema.$ref) return false;
  if (schema.type === 'array') return isWeakSchema(schema.items);
  if (schema.type === 'object' || schema.properties) {
    const properties = Object.values(schema.properties ?? {});
    if (!properties.length) return true;
    return properties.some((property) => {
      if (!property) return true;
      if (property.$ref) return false;
      if (property.type === 'object' && !property.properties) return true;
      if (
        property.type === 'array' &&
        (!property.items ||
          (property.items.type === 'object' && !property.items.properties))
      ) {
        return true;
      }
      return false;
    });
  }
  return false;
}

function dereference(schema) {
  if (!schema?.$ref) return schema;
  const match = /^#\/components\/schemas\/(.+)$/.exec(schema.$ref);
  return match ? spec.components.schemas[match[1]] ?? schema : schema;
}

/**
 * Align the documented schema with the captured response: a field that came
 * back as `null` must allow null, even if an older schema said `string`.
 */
function markNullable(schema, sample) {
  const node = dereference(schema);
  if (!node) return;
  if (sample === null) {
    if (typeof node.type === 'string') {
      node.type = [node.type, 'null'];
    } else if (Array.isArray(node.type)) {
      if (!node.type.includes('null')) node.type.push('null');
    } else {
      node.nullable = true;
    }
    return;
  }
  if (Array.isArray(sample)) {
    const first = sample.find((item) => item !== null && item !== undefined);
    if (first !== undefined && node.items) markNullable(node.items, first);
    return;
  }
  if (sample && typeof sample === 'object' && node.properties) {
    for (const [key, value] of Object.entries(sample)) {
      if (node.properties[key]) markNullable(node.properties[key], value);
    }
  }
}

/**
 * An integer in the first sampled array item must not hide decimals in later
 * items; widen the documented type to `number`.
 */
function widenNumericTypes(schema, sample) {
  const node = dereference(schema);
  if (!node) return;
  if (Array.isArray(sample)) {
    for (const item of sample) {
      if (item !== undefined && item !== null && node.items) {
        widenNumericTypes(node.items, item);
      }
    }
    return;
  }
  if (sample && typeof sample === 'object' && node.properties) {
    for (const [key, value] of Object.entries(sample)) {
      if (node.properties[key]) widenNumericTypes(node.properties[key], value);
    }
    return;
  }
  if (typeof sample === 'number' && !Number.isInteger(sample)) {
    if (node.type === 'integer') {
      node.type = 'number';
    } else if (Array.isArray(node.type) && node.type.includes('integer')) {
      node.type = [...node.type.filter((type) => type !== 'integer'), 'number'];
    }
  }
}

for (const operation of matrix.operations) {
  const result = resolvedById.get(operation.id);
  if (!result || !result.ok || result.responseSample === undefined) continue;
  const target = spec.paths[operation.path]?.[operation.method.toLowerCase()];
  if (!target) continue;

  const status = String(result.expect);
  if (!target.responses[status]) {
    target.responses[status] = { description: 'Successful response' };
  }
  const response = target.responses[status];
  if (!response.content) response.content = {};

  const contentType = (result.contentType ?? 'application/json')
    .split(';')[0]
    .trim();

  if (contentType === 'text/csv') {
    response.content['text/csv'] = {
      schema: { type: 'string' },
      example: result.responseSample,
    };
    continue;
  }
  if (contentType !== 'application/json') continue;

  const media = (response.content['application/json'] ??= {});
  const inferred = inferSchema(result.responseSample);
  if (isWeakSchema(media.schema)) media.schema = inferred;
  markNullable(media.schema, result.responseSample);
  widenNumericTypes(media.schema, result.responseSample);
  // A captured live response is authoritative, even when the spec already had
  // a hand-written example for this operation.
  media.example = result.responseSample;
}

// Keep the schema-level example consistent with the captured trip list, where
// unflagged trips now serialize flagReason as null instead of "".
const tripFlagReason = spec.components.schemas.Trip?.properties?.flagReason;
if (tripFlagReason) tripFlagReason.example = null;

/* -------------------------------------------------------------------------
 * 8. Document the success contract: blank optional fields are ignored,
 *    empty results still return 200, and only invalid values return 400.
 * ---------------------------------------------------------------------- */
const successContract =
  'Blank optional query parameters are treated as absent. ' +
  'Empty result sets return 200 with an empty data array. Only invalid values ' +
  '(for example an unknown enum value, a malformed UUID or malformed JSON) return 400.';
if (!spec.info.description.includes('Blank optional query parameters')) {
  spec.info.description = `${spec.info.description} ${successContract}`.trim();
}

for (const pathName of ['/v1/cities', '/v1/ordinances', '/v1/anomalies', '/v1/audit']) {
  const operation = spec.paths[pathName]?.get;
  if (!operation) continue;
  operation.description =
    operation.description ??
    'Returns 200 with an empty data array when no record matches. Blank filters are ignored; invalid values return 400.';
}

await writeFile(
  path.join(docsDir, 'openapi.json'),
  `${JSON.stringify(spec, null, 2)}\n`,
  'utf8',
);

console.log('[farefair] applied live examples to docs/openapi.json');
