/**
 * Official point-to-point fare helpers.
 *
 * The LGU publishes a fixed per-passenger fare for each origin/destination pair.
 * `fn_lookup_fare_route` (SQL) resolves the pair, including the "Poblacion or
 * Terminal" rows and reverse trips. When a pair is not published, callers fall
 * back to the distance/kilometre engine.
 */

export function blankToNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

export function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export async function lookupOfficialFare(
  db,
  cityId,
  vehicleId,
  origin,
  destination,
) {
  const from = blankToNull(origin);
  const to = blankToNull(destination);
  if (!from || !to) return null;

  const lookup = await db.query(
    `SELECT * FROM fn_lookup_fare_route($1,$2,$3,$4)`,
    [cityId, vehicleId, from, to],
  );
  if (!lookup.rows.length) return null;

  const context = await db.query(
    `SELECT mv.id AS matrix_version_id, mv.provisional,
            pv.id AS policy_version_id, pv.discount_rate, pv.pakyaw_seat_cap,
            e.typical_capacity, e.base_fare, e.base_distance_km, e.per_km_rate
     FROM fare_matrix_versions mv
     JOIN fare_matrix_entries e
       ON e.matrix_version_id = mv.id
      AND e.vehicle_type_id = $2
      AND e.active
     JOIN fare_policy_versions pv
       ON pv.city_id = mv.city_id
      AND pv.status = 'active'
     WHERE mv.city_id = $1 AND mv.status = 'active'
     LIMIT 1`,
    [cityId, vehicleId],
  );
  if (!context.rows.length) return null;

  const row = context.rows[0];
  const regular = Number(lookup.rows[0].regular_fare);
  const baseFare = Number(row.base_fare);
  const perKm = Number(row.per_km_rate);
  const baseDistance = Number(row.base_distance_km);
  const derivedDistanceKm =
    perKm > 0
      ? Math.round(
          (baseDistance + Math.max(0, regular - baseFare) / perKm) * 10,
        ) / 10
      : baseDistance;

  return {
    route: lookup.rows[0],
    context: row,
    derivedDistanceKm,
  };
}

export function buildOfficialFare(input, official, distanceKm) {
  const route = official.route;
  const context = official.context;
  const regular = Number(route.regular_fare);
  const discounted = Number(route.discounted_fare);
  const capacity = Number(context.typical_capacity);
  const seatCap = Number(context.pakyaw_seat_cap);
  const seatUnits = input.pakyaw
    ? Math.min(capacity, seatCap)
    : input.passengers;
  const perPassenger = input.discountCode === 'none' ? regular : discounted;
  // Mirror the distance engine: `subtotal` is the undiscounted amount and
  // `exact_fare` is what the passenger pays after the statutory discount.
  const subtotal = roundMoney(regular * seatUnits);
  const exact = roundMoney(perPassenger * seatUnits);
  const discountRate =
    input.discountCode === 'none' ? 0 : Number(context.discount_rate);
  const discountAmount = roundMoney(subtotal - exact);

  return {
    city_id: input.cityId,
    vehicle_id: input.vehicleId,
    matrix_version_id: context.matrix_version_id,
    policy_version_id: context.policy_version_id,
    base_fare: regular,
    base_distance_km: 0,
    per_km_rate: 0,
    distance_component: 0,
    base_rate: regular,
    seat_units: seatUnits,
    subtotal,
    discount_code: input.discountCode,
    discount_rate: discountRate,
    discount_amount: discountAmount,
    exact_fare: exact,
    fare_min: exact,
    fare_max: exact,
    currency: 'PHP',
    provisional: context.provisional,
    distance_km: distanceKm,
    fare_source: 'official_matrix',
    route_row_number: Number(route.row_number),
  };
}
