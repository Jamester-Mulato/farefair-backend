export function asJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function num(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Blank optional text is treated as absent so clients receive a documented
 * `null` fallback instead of an ambiguous empty string.
 */
export function textOrNull(value) {
  if (value === null || value === undefined) return null;
  return String(value).trim() === '' ? null : value;
}

export function money(value) {
  const parsed = num(value);
  return parsed === null ? null : Math.round((parsed + Number.EPSILON) * 100) / 100;
}

export function int(value) {
  const parsed = num(value);
  return parsed === null ? null : Math.trunc(parsed);
}

export function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function dateOnly(value) {
  if (!value) return null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (part) => String(part).padStart(2, '0');
  const localMidnight =
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0;
  const utcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
  // DATE columns arrive as local midnight from `pg` and as UTC midnight from
  // PGlite. Preserve the calendar date for both without shifting a day.
  if (localMidnight && !utcMidnight) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function bool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function serializeCitySummary(row) {
  return {
    id: row.id,
    displayName: row.display_name,
    province: row.province,
    region: row.region,
    status: row.status,
    centroLabel: row.centro_label,
    center: { lat: num(row.center_lat), lng: num(row.center_lng) },
    isFocus: row.is_focus,
    provisional: row.provisional,
    source: row.source,
    lastVerified: dateOnly(row.last_verified),
    farePolicyVersionId: row.fare_policy_version_id,
    farePolicyVersion: int(row.fare_policy_version),
    fareMatrixVersionId: row.fare_matrix_version_id,
    fareMatrixVersion: int(row.fare_matrix_version),
    activeVehicleCount: int(row.active_vehicle_count),
    fareRouteCount: int(row.fare_route_count ?? 0),
    ordinanceCount: int(row.ordinance_count),
  };
}

export function serializePolicy(row) {
  if (!row) return null;
  return {
    id: row.id,
    cityId: row.city_id,
    version: int(row.version),
    status: row.status,
    discountRate: num(row.discount_rate),
    customaryLeewayMin: num(row.customary_leeway_min),
    customaryLeewayMax: num(row.customary_leeway_max),
    minPassengers: int(row.min_passengers),
    maxPassengers: int(row.max_passengers),
    pakyawSeatCap: int(row.pakyaw_seat_cap),
    effectiveFrom:
      dateOnly(row.effective_from) ??
      dateOnly(row.activated_at) ??
      dateOnly(row.created_at),
    effectiveTo: dateOnly(row.effective_to),
    notes: row.notes,
    activatedAt: iso(row.activated_at),
    createdAt: iso(row.created_at),
  };
}

export function serializeMatrixEntry(row) {
  return {
    vehicleId: row.vehicle_type_id,
    name: row.vehicle_name,
    category: row.category,
    active: row.active,
    baseFare: money(row.base_fare),
    baseDistanceKm: num(row.base_distance_km),
    perKmRate: money(row.per_km_rate),
    minFare: money(row.min_fare),
    maxCustomary: money(row.max_customary),
    typicalCapacity: int(row.typical_capacity),
    regulationMatrix: row.regulation_matrix,
    ordinanceId: row.ordinance_id,
  };
}

export function serializeMatrix(row, entries = []) {
  if (!row) return null;
  return {
    id: row.id,
    cityId: row.city_id,
    version: int(row.version),
    status: row.status,
    effectiveFrom:
      dateOnly(row.effective_from) ??
      dateOnly(row.activated_at) ??
      dateOnly(row.created_at),
    effectiveTo: dateOnly(row.effective_to),
    provisional: row.provisional,
    source: row.source,
    notes: row.notes,
    activatedAt: iso(row.activated_at),
    createdAt: iso(row.created_at),
    entries: entries.map(serializeMatrixEntry),
  };
}

export function serializeFareRoute(row) {
  return {
    rowNumber: int(row.row_number),
    vehicleId: row.vehicle_type_id,
    vehicleName: row.vehicle_name ?? null,
    from: row.from_label,
    to: row.to_label,
    via: textOrNull(row.via),
    regularFare: money(row.regular_fare),
    discountedFare: money(row.discounted_fare),
    remark: textOrNull(row.remark),
    bidirectional: row.bidirectional !== false,
  };
}

export function serializeOrdinance(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    slug: row.slug,
    cityId: row.city_id,
    cityName: row.city_name ?? null,
    title: row.title,
    municipality: row.municipality,
    ordinanceNumber: row.ordinance_number,
    status: row.status,
    dateEnactedLabel: row.date_enacted_label,
    dateEnacted: dateOnly(row.date_enacted),
    effectiveFrom:
      dateOnly(row.effective_from) ?? dateOnly(row.date_enacted),
    effectiveTo: dateOnly(row.effective_to),
    summary: row.summary,
    vehicleApplicability: row.vehicle_applicability,
    vehicleIds: Array.isArray(row.vehicle_ids) ? row.vehicle_ids : [],
    baseFare: money(row.base_fare),
    succeedingKmRate: money(row.succeeding_km_rate),
    discountTerms: row.discount_terms,
    documentUrl: textOrNull(row.document_url),
  };
}

export function serializeVehicle(row) {
  return {
    id: row.id,
    category: row.category,
    name: row.name,
    tag: row.tag,
    description: row.description,
    icon: row.icon,
    defaults: {
      baseFare: money(row.default_base_fare),
      baseDistanceKm: num(row.default_base_distance_km),
      perKmRate: money(row.default_per_km_rate),
      minFare: money(row.default_min_fare),
      maxCustomary: money(row.default_max_customary),
      typicalCapacity: int(row.typical_capacity),
      regulationNote: row.regulation_note,
    },
    sortOrder: int(row.sort_order),
    cityCount: row.city_count === undefined ? null : int(row.city_count),
  };
}

export function serializeTrip(row) {
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    cityId: row.city_id,
    cityName: row.city_name,
    cityRegion: row.city_region,
    vehicleId: row.vehicle_type_id,
    vehicleName: row.vehicle_name,
    vehicleCategory: row.vehicle_category,
    origin: row.origin,
    destination: row.destination,
    distanceKm: num(row.distance_km),
    durationSeconds: int(row.duration_seconds),
    durationMinutes: Math.round((int(row.duration_seconds) ?? 0) / 60),
    passengers: int(row.passengers),
    pakyaw: row.is_pakyaw,
    discountCode: row.discount_code,
    discountLabel: row.discount_label,
    fare: {
      currency: 'PHP',
      exact: money(row.exact_fare),
      min: money(row.fare_min),
      max: money(row.fare_max),
    },
    fareSource: row.fare_source ?? 'distance_matrix',
    routeRowNumber: row.route_row_number == null ? null : int(row.route_row_number),
    status: row.status,
    flagReason: textOrNull(row.flag_reason),
    recordedVia: row.recorded_via,
    recordedAt: iso(row.recorded_at),
    createdAt: iso(row.created_at),
    matrixVersionId: row.matrix_version_id,
    policyVersionId: row.policy_version_id,
    openAnomalies:
      row.open_anomalies === undefined ? null : int(row.open_anomalies),
  };
}

export function serializePoint(row) {
  return {
    seq: int(row.seq),
    lat: num(row.lat),
    lng: num(row.lng),
    recordedAt: iso(row.recorded_at),
  };
}

export function serializeAnomaly(row) {
  return {
    id: row.id,
    tripId: row.trip_id,
    tripReference: row.reference ?? null,
    cityId: row.city_id,
    cityName: row.city_name ?? null,
    kind: row.kind,
    severity: row.severity,
    detail: row.detail,
    detectedAt: iso(row.detected_at),
    resolvedAt: iso(row.resolved_at),
    resolutionNote: textOrNull(row.resolution_note),
  };
}

export function serializeQuote(row) {
  if (!row) return null;
  return {
    id: row.id,
    cityId: row.city_id,
    cityName: row.city_name ?? null,
    vehicleId: row.vehicle_type_id,
    vehicleName: row.vehicle_name ?? null,
    tripId: row.trip_id,
    modelVersionId: row.model_version_id,
    origin: row.origin ?? null,
    destination: row.destination ?? null,
    routeRowNumber:
      row.route_row_number == null ? null : int(row.route_row_number),
    distanceKm: num(row.distance_km),
    passengers: int(row.passengers),
    pakyaw: row.is_pakyaw,
    discountCode: row.discount_code,
    baseRate: money(row.base_rate),
    seatUnits: int(row.seat_units),
    fare: {
      currency: 'PHP',
      exact: money(row.exact_fare),
      min: money(row.fare_min),
      max: money(row.fare_max),
    },
    matrixVersionId: row.matrix_version_id,
    policyVersionId: row.policy_version_id,
    fareSource: row.fare_source ?? 'distance_matrix',
    source: row.source,
    createdAt: iso(row.created_at),
  };
}

export function serializeModelVersion(row) {
  return {
    id: row.id,
    modelId: row.model_id,
    modelKey: row.model_key,
    name: row.name,
    task: row.task,
    target: row.target,
    version: int(row.version),
    status: row.status,
    algorithm: row.algorithm,
    featureNames: row.feature_names,
    coefficients: asJson(row.coefficients),
    hyperparameters: asJson(row.hyperparameters),
    metrics: asJson(row.metrics),
    residualStddev: num(row.residual_stddev),
    trainingRows: int(row.training_rows),
    trainedAt: iso(row.trained_at),
    activatedAt: iso(row.activated_at),
    artifactUri: row.artifact_uri,
    checksum: row.checksum,
    isActive: row.status === 'active',
  };
}

export function serializeAudit(row) {
  return {
    id: row.id,
    occurredAt: iso(row.occurred_at),
    actorId: row.actor_id,
    actorName: row.actor_name,
    role: row.role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    cityId: row.city_id,
    cityName: row.city_name ?? null,
    detail: asJson(row.detail),
  };
}

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
