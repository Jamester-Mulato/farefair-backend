/* Data access for the admin console.
 *
 * PostgreSQL is the only source of truth. Every city, fare route, trip and
 * audit event is read from the FareFair API; the checked-in Flutter assets
 * and snapshot.js are not used here.
 */
(function (global) {
  'use strict';

  const VEHICLE_META = {
    tricycle: { name: 'Tricycle', short: 'Tricycle' },
    'habal-habal': { name: 'Habal-habal', short: 'Habal-habal' },
    skylab: { name: 'Skylab', short: 'Skylab' },
    jeepney: { name: 'Jeepney', short: 'Jeepney' },
    multicab: { name: 'Multicab', short: 'Multicab' },
    motorela: { name: 'Motorela', short: 'Motorela' },
    trisikad: { name: 'Trisikad', short: 'Trisikad' },
    'bao-bao': { name: 'Bao-bao', short: 'Bao-bao' },
    'modern-puj': { name: 'Modern PUJ', short: 'Modern PUJ' },
  };

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function vehicleMeta(id) {
    return VEHICLE_META[id] || {
      name: String(id || 'Unknown').replace(/(^|-)([a-z])/g, (_, dash, letter) => (dash ? ' ' : '') + letter.toUpperCase()),
      short: String(id || 'Unknown'),
    };
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function number(value, decimals) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return n.toLocaleString('en-PH', {
      minimumFractionDigits: decimals || 0,
      maximumFractionDigits: decimals == null ? 0 : decimals,
    });
  }

  function peso(value, decimals) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '₱—';
    return '₱' + number(n, decimals == null ? 0 : decimals);
  }

  function km(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return number(n, n < 10 ? 1 : 0) + ' km';
  }

  function percent(value, decimals) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return number(n * 100, decimals == null ? 0 : decimals) + '%';
  }

  function parseDate(value) {
    if (value instanceof Date) return value;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value) {
    const date = parseDate(value);
    if (!date) return '—';
    return MONTHS[date.getMonth()] + ' ' + date.getDate() + ', ' + date.getFullYear();
  }

  function formatDateTime(value) {
    const date = parseDate(value);
    if (!date) return '—';
    let hours = date.getHours();
    const suffix = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return formatDate(date) + ' · ' + hours + ':' + minutes + ' ' + suffix;
  }

  function formatTime(value) {
    const date = parseDate(value);
    if (!date) return '—';
    let hours = date.getHours();
    const suffix = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return hours + ':' + String(date.getMinutes()).padStart(2, '0') + ' ' + suffix;
  }

  function relativeTime(value, now) {
    const date = parseDate(value);
    if (!date) return '—';
    const current = now ? parseDate(now) : new Date();
    const diff = Math.max(0, current.getTime() - date.getTime());
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return minutes + 'm ago';
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + 'h ago';
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday';
    if (days < 7) return days + 'd ago';
    return formatDate(date);
  }

  function dateKey(date) {
    const d = parseDate(date);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function startOfDay(date) {
    const d = parseDate(date) || new Date();
    const copy = new Date(d.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function addDays(date, days) {
    const d = new Date((parseDate(date) || new Date()).getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  function ariaDateTime(value) {
    const d = parseDate(value);
    return d ? d.toISOString() : '';
  }

  function csvCell(value) {
    const text = String(value == null ? '' : value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function downloadCsv(filename, rows) {
    const body = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function mulberry32(seed) {
    let state = seed >>> 0;
    return function next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(rand, list) {
    return list[Math.floor(rand() * list.length) % list.length];
  }

  function weighted(rand, entries) {
    const total = entries.reduce((sum, entry) => sum + entry[1], 0);
    let roll = rand() * total;
    for (const entry of entries) {
      roll -= entry[1];
      if (roll <= 0) return entry[0];
    }
    return entries[entries.length - 1][0];
  }

  async function loadFromApi(api) {
    const list = await api.get('/v1/cities');
    if (!list || !Array.isArray(list.data)) {
      throw new Error('Invalid /v1/cities response');
    }
    const details = await Promise.all(
      list.data.map((city) => api.get('/v1/cities/' + encodeURIComponent(city.id)))
    );
    const cities = {};
    details.forEach((city) => {
      if (city && city.id) cities[city.id] = city;
    });
    if (!Object.keys(cities).length) throw new Error('The API returned no city datasets');

    // Official point-to-point fares live in PostgreSQL and are fetched as a
    // first-class collection, not synthesised from the per-km matrix.
    await Promise.all(
      Object.keys(cities).map(async (cityId) => {
        try {
          const result = await api.get(
            '/v1/cities/' + encodeURIComponent(cityId) + '/fare-routes'
          );
          if (!result || !Array.isArray(result.data)) return;
          cities[cityId].fareRoutes = result.data.map(mapFareRoute);
          cities[cityId].fareRouteMeta = {
            matrixVersionId: result.matrixVersionId || null,
            effectiveFrom: result.effectiveFrom || null,
            provisional: result.provisional == null ? null : Boolean(result.provisional),
            source: result.source || '',
            count: Number(result.count || result.data.length),
          };
        } catch (error) {
          cities[cityId].fareRoutes = [];
          cities[cityId].fareRouteMeta = {
            matrixVersionId: null,
            effectiveFrom: null,
            provisional: null,
            source: '',
            count: 0,
            error: String(error.message || error),
          };
        }
      })
    );

    return {
      config: {
        cities: list.data.map((city) => ({
          id: city.id,
          asset: '',
          displayName: city.displayName,
          isFocus: Boolean(city.isFocus),
        })),
        activeCityId: list.activeCityId || null,
      },
      cities,
      source: {
        kind: 'api',
        base: api.base() || global.location.origin,
        error: null,
      },
    };
  }

  async function load() {
    const api = global.FareFairApi;
    if (!api) {
      throw new Error('The FareFair API client is not loaded.');
    }
    await api.init();
    if (!api.online()) {
      throw new Error(
        'The FareFair API is not reachable. Locally, start it with npm start in backend/ and ' +
          'reload. If it is hosted, the first request after idle can take up to a minute - reload then.'
      );
    }
    // PostgreSQL is the only source of truth for the admin console. The
    // checked-in Flutter assets and snapshot.js are not read here.
    return loadFromApi(api);
  }

  /* ------------------------------------------------------------------ */
  /* API-backed trip and audit reads                                     */
  /* ------------------------------------------------------------------ */

  function toNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback || 0;
  }

  function mapRole(role) {
    if (role === 'admin') return 'super_admin';
    if (role === 'lgu_editor') return 'city_admin';
    if (role === 'analyst' || role === 'viewer') return role;
    return role || 'system';
  }

  function mapFareRoute(route) {
    return {
      rowNumber: toNumber(route.rowNumber),
      vehicleId: route.vehicleId,
      vehicleName: route.vehicleName || route.vehicleId,
      from: route.from,
      to: route.to,
      via: route.via || '',
      regularFare: toNumber(route.regularFare),
      discountedFare: toNumber(route.discountedFare),
      remark: route.remark || '',
      bidirectional: route.bidirectional !== false,
    };
  }

  async function loadFareRoutes(cityId) {
    const api = global.FareFairApi;
    if (!api) return null;
    await api.init();
    if (!api.online()) return null;
    const result = await api.get(
      '/v1/cities/' + encodeURIComponent(cityId) + '/fare-routes'
    );
    if (!result || !Array.isArray(result.data)) return null;
    return {
      routes: result.data.map(mapFareRoute),
      meta: {
        matrixVersionId: result.matrixVersionId || null,
        effectiveFrom: result.effectiveFrom || null,
        provisional: result.provisional == null ? null : Boolean(result.provisional),
        source: result.source || '',
        count: Number(result.count || result.data.length),
      },
    };
  }

  function mapTrip(trip) {
    const fare = trip.fare || {};
    const via = trip.recordedVia;
    return {
      id: trip.reference || trip.id,
      // The API addresses trips by UUID; the console shows the human
      // reference. Both are kept so the analysis endpoint can be called.
      uuid: trip.id,
      timestamp: trip.recordedAt,
      cityId: trip.cityId,
      cityName: trip.cityName || trip.cityId,
      vehicleId: trip.vehicleId,
      vehicleName: trip.vehicleName || trip.vehicleId,
      origin: trip.origin,
      destination: trip.destination,
      distanceKm: toNumber(trip.distanceKm),
      durationMin: Math.max(0, Math.round(toNumber(trip.durationMinutes ?? toNumber(trip.durationSeconds) / 60))),
      passengers: toNumber(trip.passengers, 1),
      pakyaw: Boolean(trip.pakyaw),
      discountType: trip.discountCode || 'none',
      estimate: toNumber(fare.exact),
      fareMin: toNumber(fare.min),
      fareMax: toNumber(fare.max),
      status: trip.status,
      flagReason: trip.flagReason || '',
      recordedVia:
        via === 'live_trip_recording' ? 'Live trip recording'
          : via === 'import' ? 'Imported record'
            : 'Fare estimate',
    };
  }

  async function loadTrips() {
    const api = global.FareFairApi;
    if (!api) return null;
    await api.init();
    if (!api.online()) return null;

    const trips = [];
    let offset = 0;
    for (let page = 0; page < 20; page += 1) {
      const result = await api.get('/v1/trips?limit=200&offset=' + offset);
      if (!result || !Array.isArray(result.data)) break;
      trips.push.apply(trips, result.data);
      if (!result.pagination || !result.pagination.hasMore) break;
      offset += result.data.length || 200;
    }
    return trips.map(mapTrip);
  }

  /// Server-side trip analysis. This is the one optional online call in the
  /// console: it returns the deterministic packet plus, if a provider is
  /// configured on the API, a re-worded narrative. When offline, the caller
  /// shows the record without the analysis panel.
  async function loadTripAnalysis(tripId) {
    const api = global.FareFairApi;
    if (!api) return null;
    await api.init();
    if (!api.online()) return null;
    const result = await api.get(
      '/v1/trips/' + encodeURIComponent(tripId) + '/analysis',
    );
    return result && typeof result === 'object' ? result : null;
  }

  async function loadAudit() {
    const api = global.FareFairApi;
    if (!api) return null;
    await api.init();
    if (!api.online()) return null;
    const result = await api.get('/v1/audit?limit=300');
    if (!result || !Array.isArray(result.data)) return null;
    return result.data.map((entry) => ({
      id: entry.id,
      at: entry.occurredAt,
      actorName: entry.actorName,
      role: mapRole(entry.role),
      action: entry.action,
      cityId: entry.cityId,
      detail:
        entry.detail && typeof entry.detail === 'object'
          ? entry.detail.summary || JSON.stringify(entry.detail)
          : String(entry.detail || ''),
    }));
  }

  async function loadAccounts() {
    const api = global.FareFairApi;
    if (!api || !api.live()) return null;
    try {
      const result = await api.get('/v1/auth/accounts');
      if (!result || !Array.isArray(result.data)) return null;
      return result.data.map((account) => ({
        id: account.id,
        name: account.name || account.displayName,
        username: account.username,
        email: account.email,
        role: mapRole(account.role),
        title: account.title,
        scope: Array.isArray(account.cityScope) ? account.cityScope : [],
      }));
    } catch {
      return null;
    }
  }


  function allVehicleIds(cities) {
    const ids = [];
    Object.keys(cities).forEach((cityId) => {
      (cities[cityId].vehicles || []).forEach((vehicle) => {
        if (ids.indexOf(vehicle.vehicleId) === -1) ids.push(vehicle.vehicleId);
      });
    });
    return ids;
  }

  function flattenOrdinances(cities) {
    const list = [];
    Object.keys(cities).forEach((cityId) => {
      const city = cities[cityId];
      (city.ordinances || []).forEach((ordinance) => {
        list.push(Object.assign({}, ordinance, { cityId, cityName: city.displayName, provisional: Boolean(city.provenance && city.provenance.provisional) }));
      });
    });
    return list;
  }

  function tripId(index) {
    return 'FF-' + String(4820 + index);
  }

  const ORIGINS = ['City Hall', 'Public Market', 'Integrated Terminal', 'Barangay Hall', 'Plaza', 'District Hospital', 'State University', 'Port Area', 'Commercial Center'];
  const DESTINATIONS = ['Poblacion', 'Barangay San Jose', 'Barangay Mabini', 'Barangay Rizal', 'Barangay Bonifacio', 'Barangay Luna', 'Barangay Del Pilar', 'Upland Village', 'Farm-to-Market Road'];

  /* Deterministic demo trip records so KPIs, charts and exports stay stable
   * across reloads while still looking like a week of real activity.
   */
  function buildTrips(cities, getVehicles) {
    const rand = mulberry32(20261025);
    const trips = [];
    const today = startOfDay(new Date());
    let counter = 0;

    for (let dayOffset = 6; dayOffset >= 0; dayOffset -= 1) {
      const day = addDays(today, -dayOffset);
      const count = 5 + Math.floor(rand() * 5);
      const cityIds = Object.keys(cities);

      for (let i = 0; i < count; i += 1) {
        const cityId = pick(rand, cityIds);
        const city = cities[cityId];
        const vehicles = getVehicles ? getVehicles(cityId) : (city.vehicles || []);
        const active = vehicles.filter((vehicle) => vehicle.active !== false);
        const vehicle = pick(rand, active.length ? active : vehicles);
        if (!vehicle) continue;

        const hour = 6 + Math.floor(rand() * 14);
        const minute = Math.floor(rand() * 60);
        let timestamp = new Date(day.getTime());
        timestamp.setHours(hour, minute, 0, 0);
        if (dayOffset === 0 && timestamp.getTime() > Date.now()) {
          timestamp = new Date(Date.now() - Math.floor(rand() * 90 + 5) * 60000);
        }

        const distance = Math.round((0.8 + rand() * 12.6) * 10) / 10;
        const baseDistance = Number(vehicle.baseDistanceKm) || 0;
        const baseFare = Number(vehicle.baseFare) || 0;
        const perKm = Number(vehicle.perKmRate) || 0;
        const minFare = Number(vehicle.minFare) || 0;
        const raw = baseFare + Math.max(0, distance - baseDistance) * perKm;
        const discountType = weighted(rand, [['none', 70], ['student', 15], ['senior', 8], ['pwd', 7]]);
        const policy = city.farePolicy || {};
        const discountRate = typeof policy.discountRate === 'number' ? policy.discountRate : 0.2;
        const estimate = Math.max(minFare, raw) * (discountType === 'none' ? 1 : 1 - discountRate);
        const leewayMin = typeof policy.customaryLeewayMin === 'number' ? policy.customaryLeewayMin : 0.92;
        const leewayMax = typeof policy.customaryLeewayMax === 'number' ? policy.customaryLeewayMax : 1.12;
        const passengers = 1 + Math.floor(rand() * 4);
        const pakyaw = rand() < 0.14;
        const status = weighted(rand, [['completed', 82], ['flagged', 12], ['disputed', 6]]);
        const route = {
          origin: rand() < 0.5 ? city.demoRoute.originName : pick(rand, ORIGINS),
          destination: rand() < 0.5 ? city.demoRoute.destinationName : pick(rand, DESTINATIONS),
        };
        if (route.origin === route.destination) route.destination = 'Poblacion';

        const flagReasons = [
          'Reported fare above customary ceiling',
          'GPS breadcrumb gap over 400 m',
          'Passenger count exceeds seat cap',
          'Duplicate trip signature detected',
        ];

        trips.push({
          id: tripId(counter),
          timestamp: timestamp.toISOString(),
          cityId,
          cityName: city.displayName,
          vehicleId: vehicle.vehicleId,
          vehicleName: vehicleMeta(vehicle.vehicleId).name,
          origin: route.origin,
          destination: route.destination,
          distanceKm: distance,
          durationMin: Math.max(3, Math.round((distance / (14 + rand() * 12)) * 60)),
          passengers,
          pakyaw,
          discountType,
          estimate: Math.round(estimate * 100) / 100,
          fareMin: Math.round(estimate * leewayMin * 100) / 100,
          fareMax: Math.round(estimate * leewayMax * 100) / 100,
          status,
          flagReason: status === 'completed' ? '' : pick(rand, flagReasons),
          recordedVia: weighted(rand, [['Fare estimate', 72], ['Live trip recording', 28]]),
        });
        counter += 1;
      }
    }

    return trips.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  }

  function tripCsvRows(trips) {
    const header = [
      'Trip ID', 'Timestamp', 'City', 'Vehicle', 'Origin', 'Destination',
      'Distance (km)', 'Duration (min)', 'Passengers', 'Pakyaw', 'Discount',
      'Estimate (PHP)', 'Range min (PHP)', 'Range max (PHP)', 'Status', 'Notes', 'Recorded via',
    ];
    const rows = trips.map((trip) => [
      trip.id,
      formatDateTime(trip.timestamp),
      trip.cityName,
      trip.vehicleName,
      trip.origin,
      trip.destination,
      trip.distanceKm.toFixed(1),
      trip.durationMin,
      trip.passengers,
      trip.pakyaw ? 'Yes' : 'No',
      trip.discountType === 'none' ? 'None' : trip.discountType,
      trip.estimate.toFixed(2),
      trip.fareMin.toFixed(2),
      trip.fareMax.toFixed(2),
      trip.status,
      trip.flagReason,
      trip.recordedVia,
    ]);
    return [header].concat(rows);
  }

  global.FareFairData = {
    VEHICLE_META,
    load,
    buildTrips,
    loadTrips,
    loadTripAnalysis,
    loadFareRoutes,
    mapFareRoute,
    loadAudit,
    loadAccounts,
    mapRole,
    allVehicleIds,
    flattenOrdinances,
    vehicleMeta,
    escapeHtml,
    number,
    peso,
    km,
    percent,
    formatDate,
    formatDateTime,
    formatTime,
    relativeTime,
    dateKey,
    startOfDay,
    addDays,
    ariaDateTime,
    trim: (text, limit) => (String(text).length > limit ? String(text).slice(0, limit - 1) + '…' : String(text)),
    downloadCsv,
    tripCsvRows,
  };
})(window);
