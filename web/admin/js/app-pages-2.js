/* FareFair Admin Console — page renderers, part 2.
 * Ordinances, Trips, Audit Log, Settings.
 */
(function () {
  'use strict';

  const FF = window.FF;
  const Data = window.FareFairData;
  const Auth = window.FareFairAuth;
  if (!FF || !Data || !Auth) return;

  const state = FF.state;
  const ui = FF.ui;
  const pages = FF.pages;
  const esc = FF.esc;
  const icon = FF.icon;
  const badge = FF.badge;
  const notice = FF.notice;

  const TRIPS_PER_PAGE = 10;
  const AUDIT_PER_PAGE = 15;

  const ACTION_LABELS = {
    'auth.login': 'Signed in',
    'auth.failed': 'Failed sign-in',
    'auth.locked': 'Lockout triggered',
    'auth.logout': 'Signed out',
    'city.activate': 'Active city changed',
    'fare.update': 'Fare matrix updated',
    'fare.reset': 'Fare reverted',
    'export.trips': 'Trips exported',
    'export.audit': 'Audit exported',
    'settings.reset': 'Workspace reset',
  };

  function cityShort(city) {
    return city ? String(city.displayName || '').split(',')[0] : '—';
  }

  function detailItem(label, value) {
    return '<div class="detail-item"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>';
  }

  /* ------------------------------------------------------------------ */
  /* Ordinances                                                          */
  /* ------------------------------------------------------------------ */

  function filteredOrdinances() {
    const needle = ui.ordQuery.trim().toLowerCase();
    return Data.flattenOrdinances(state.data.cities)
      .filter(function (ordinance) {
        if (ui.ordCityId !== 'all' && ordinance.cityId !== ui.ordCityId) return false;
        if (!needle) return true;
        const haystack = [
          ordinance.title, ordinance.summary, ordinance.ordinanceNumber,
          ordinance.vehicleApplicability, ordinance.discountTerms, ordinance.cityName,
        ].join(' ').toLowerCase();
        return haystack.indexOf(needle) !== -1;
      })
      .sort(function (a, b) {
        return String(a.cityName).localeCompare(String(b.cityName)) || String(a.title).localeCompare(String(b.title));
      });
  }

  function refreshOrdinances() {
    const results = FF.byId('ord-results');
    const count = FF.byId('ord-count');
    if (!results) return;
    const list = filteredOrdinances();
    if (count) count.textContent = list.length + ' ordinance record' + (list.length === 1 ? '' : 's');

    if (!list.length) {
      results.innerHTML = '<div class="card">' +
        FF.emptyState('doc', 'No ordinances match', 'Try another city or search term.') + '</div>';
      return;
    }

    results.innerHTML = '<div class="ord-grid">' + list.map(function (ordinance) {
      return '<article class="ord-card">' +
        '<div class="ord-top"><div>' +
          '<h3>' + esc(ordinance.title) + '</h3>' +
          '<p class="ord-meta">' + esc(ordinance.cityName) + ' · ' + esc(ordinance.ordinanceNumber) + '</p>' +
        '</div>' +
        (ordinance.provisional ? badge('warn', 'Provisional') : badge('ok', 'Verified')) +
        '</div>' +
        '<p class="ord-summary">' + esc(ordinance.summary) + '</p>' +
        '<div class="ord-rates">' +
          '<div><span>Base fare</span><strong>' + esc(Data.peso(ordinance.baseFare, 2)) + '</strong></div>' +
          '<div><span>Each km</span><strong>' + esc(Data.peso(ordinance.succeedingKmRate, 2)) + '</strong></div>' +
          '<div><span>Enacted</span><strong style="font-size:.76rem">' + esc(ordinance.dateEnacted || 'Pending') + '</strong></div>' +
        '</div>' +
        '<p class="ord-meta">Applies to ' + esc(ordinance.vehicleApplicability || '—') + '</p>' +
        '<div class="ord-foot"><span class="badge badge-neutral badge-plain">' + esc(ordinance.discountTerms || '') + '</span></div>' +
      '</article>';
    }).join('') + '</div>';
  }

  function renderOrdinances() {
    const cityIds = Object.keys(state.data.cities);
    if (ui.ordCityId !== 'all' && cityIds.indexOf(ui.ordCityId) === -1) ui.ordCityId = 'all';
    const total = Data.flattenOrdinances(state.data.cities).length;

    FF.dom.page.innerHTML =
      FF.pageHead(
        'Tariff library',
        'Cabadbaran City ordinance and tariff records recorded in PostgreSQL.',
        '<span class="pill pill-quiet">' + icon('doc') + ' Read-only archive</span>'
      ) +
      '<div class="toolbar">' +
        '<div class="search">' + icon('search') +
          '<input type="search" id="ord-search" placeholder="Search title, number or discount terms" value="' + esc(ui.ordQuery) + '" aria-label="Search ordinances">' +
        '</div>' +
        '<select class="select" id="ord-city" aria-label="Filter by city">' + FF.cityOptions(ui.ordCityId, true) + '</select>' +
        '<span class="spacer"></span>' +
        '<span class="muted" id="ord-count" style="font-size:.73rem"></span>' +
      '</div>' +
      '<div id="ord-results"></div>';

    const search = FF.byId('ord-search');
    search.addEventListener('input', function () {
      ui.ordQuery = search.value;
      refreshOrdinances();
    });
    const city = FF.byId('ord-city');
    city.addEventListener('change', function () {
      ui.ordCityId = city.value;
      refreshOrdinances();
    });
    refreshOrdinances();
  }

  pages.ordinances = renderOrdinances;

  /* ------------------------------------------------------------------ */
  /* Trips                                                               */
  /* ------------------------------------------------------------------ */

  function filteredTrips() {
    const needle = ui.tripQuery.trim().toLowerCase();
    return state.trips.filter(function (trip) {
      if (ui.tripCityId !== 'all' && trip.cityId !== ui.tripCityId) return false;
      if (ui.tripVehicleId !== 'all' && trip.vehicleId !== ui.tripVehicleId) return false;
      if (ui.tripStatus !== 'all' && trip.status !== ui.tripStatus) return false;
      if (!needle) return true;
      const haystack = [trip.id, trip.cityName, trip.vehicleName, trip.origin, trip.destination, trip.status]
        .join(' ').toLowerCase();
      return haystack.indexOf(needle) !== -1;
    });
  }

  function exportTrips() {
    const list = filteredTrips();
    if (!list.length) {
      FF.toast('No trip records match the current filters.', 'info');
      return;
    }
    Data.downloadCsv('farefair-trips-' + Data.dateKey(new Date()) + '.csv', Data.tripCsvRows(list));
    FF.audit('export.trips', 'Exported ' + list.length + ' trip records to CSV');
    FF.toast('Exported ' + list.length + ' trip records.');
  }

  function refreshTripsResults() {
    const results = FF.byId('trips-results');
    const count = FF.byId('trips-count');
    if (!results) return;
    const list = filteredTrips();
    if (count) count.textContent = list.length + ' matching record' + (list.length === 1 ? '' : 's');

    if (!list.length) {
      results.innerHTML = '<div class="card">' +
        FF.emptyState('route', 'No trip records match', 'Clear a filter or try another search term.') + '</div>';
      return;
    }

    const totalPages = Math.max(1, Math.ceil(list.length / TRIPS_PER_PAGE));
    ui.tripPage = Math.min(Math.max(1, ui.tripPage), totalPages);
    const start = (ui.tripPage - 1) * TRIPS_PER_PAGE;
    const slice = list.slice(start, start + TRIPS_PER_PAGE);

    let rows = '';
    slice.forEach(function (trip) {
      rows += '<tr>' +
        '<td><div class="primary-cell"><strong>' + esc(trip.id) + '</strong><span>' +
          esc(Data.formatDateTime(trip.timestamp)) + '</span></div></td>' +
        '<td class="cell-span" data-label="Route"><div class="primary-cell"><strong>' + esc(trip.origin) + ' → ' + esc(trip.destination) + '</strong><span>' +
          esc(Data.km(trip.distanceKm)) + ' · ' + esc(trip.durationMin + ' min') + ' · ' +
          esc(String(trip.passengers)) + ' pax' + (trip.pakyaw ? ' · pakyaw' : '') + '</span></div></td>' +
        '<td data-label="City / vehicle"><div class="primary-cell"><strong>' + esc(FF.cityShort({ displayName: trip.cityName })) + '</strong><span>' +
          esc(trip.vehicleName) + '</span></div></td>' +
        '<td class="num" data-label="Estimate"><strong>' + esc(Data.peso(trip.estimate, 2)) + '</strong><br>' +
          '<span class="muted" style="font-size:.67rem">' + esc(FF.discountLabel(trip.discountType)) + '</span></td>' +
        '<td data-label="Status"><span title="' + esc(trip.flagReason || 'Within customary range') + '">' +
          FF.tripStatusBadge(trip.status) + '</span></td>' +
        '<td class="actions-col"><button type="button" class="btn btn-outline btn-sm" data-trip-view="' + esc(trip.id) + '">View</button></td>' +
      '</tr>';
    });

    results.innerHTML = '<div class="card"><div class="table-wrap"><table class="data-table table-stack"><thead><tr>' +
      '<th>Trip</th><th>Route</th><th>City / vehicle</th><th class="num">Estimate</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="pagination"><span>Showing ' + (start + 1) + '–' + Math.min(start + TRIPS_PER_PAGE, list.length) +
        ' of ' + list.length + '</span>' +
        '<div class="pagination-btns">' +
          '<button type="button" class="btn btn-outline btn-sm" data-trip-page="prev"' + (ui.tripPage <= 1 ? ' disabled' : '') + '>Previous</button>' +
          '<span class="pill pill-quiet">Page ' + ui.tripPage + ' of ' + totalPages + '</span>' +
          '<button type="button" class="btn btn-outline btn-sm" data-trip-page="next"' + (ui.tripPage >= totalPages ? ' disabled' : '') + '>Next</button>' +
        '</div>' +
      '</div></div>';

    FF.qsa('[data-trip-view]', results).forEach(function (button) {
      button.addEventListener('click', function () { FF.openTripModal(button.getAttribute('data-trip-view')); });
    });
    FF.qsa('[data-trip-page]', results).forEach(function (button) {
      button.addEventListener('click', function () {
        ui.tripPage += button.getAttribute('data-trip-page') === 'next' ? 1 : -1;
        refreshTripsResults();
      });
    });
  }

  function renderTrips() {
    const cityIds = Object.keys(state.data.cities);
    if (ui.tripCityId !== 'all' && cityIds.indexOf(ui.tripCityId) === -1) ui.tripCityId = 'all';
    if (ui.tripVehicleId !== 'all' && Data.allVehicleIds(state.data.cities).indexOf(ui.tripVehicleId) === -1) {
      ui.tripVehicleId = 'all';
    }
    if (['all', 'completed', 'flagged', 'disputed'].indexOf(ui.tripStatus) === -1) ui.tripStatus = 'all';

    const trips = state.trips;
    const avg = trips.length
      ? trips.reduce(function (sum, trip) { return sum + Number(trip.estimate || 0); }, 0) / trips.length
      : 0;
    const discounted = trips.filter(function (trip) { return trip.discountType !== 'none'; }).length;
    const review = trips.filter(function (trip) { return trip.status !== 'completed'; }).length;

    FF.dom.page.innerHTML =
      FF.pageHead(
        'Recorded trips',
        'Fare estimates from the last seven days. Filter, inspect and export the dataset.',
        '<button type="button" class="btn btn-primary" id="trips-export">' + icon('download') + ' Export CSV</button>'
      ) +
      FF.statStrip([
        { label: 'Records', value: String(trips.length) },
        { label: 'Avg estimate', value: esc(Data.peso(avg, 2)) },
        { label: 'Discounted', value: esc(Data.percent(trips.length ? discounted / trips.length : 0, 0)) },
        { label: 'Need review', value: String(review) },
      ]) +
      '<div class="toolbar">' +
        '<div class="search">' + icon('search') +
          '<input type="search" id="trip-search" placeholder="Search trip ID, route or city" value="' + esc(ui.tripQuery) + '" aria-label="Search trip records">' +
        '</div>' +
        '<select class="select" id="trip-city" aria-label="Filter by city">' + FF.cityOptions(ui.tripCityId, true) + '</select>' +
        '<select class="select" id="trip-vehicle" aria-label="Filter by vehicle">' + FF.vehicleOptions(ui.tripVehicleId, true) + '</select>' +
        '<select class="select" id="trip-status" aria-label="Filter by status">' +
          '<option value="all"' + (ui.tripStatus === 'all' ? ' selected' : '') + '>All statuses</option>' +
          '<option value="completed"' + (ui.tripStatus === 'completed' ? ' selected' : '') + '>Completed</option>' +
          '<option value="flagged"' + (ui.tripStatus === 'flagged' ? ' selected' : '') + '>Flagged</option>' +
          '<option value="disputed"' + (ui.tripStatus === 'disputed' ? ' selected' : '') + '>Disputed</option>' +
        '</select>' +
        '<span class="spacer"></span>' +
        '<span class="muted" id="trips-count" style="font-size:.73rem"></span>' +
      '</div>' +
      '<div id="trips-results"></div>';

    const search = FF.byId('trip-search');
    search.addEventListener('input', function () {
      ui.tripQuery = search.value;
      ui.tripPage = 1;
      refreshTripsResults();
    });
    const city = FF.byId('trip-city');
    city.addEventListener('change', function () {
      ui.tripCityId = city.value;
      ui.tripPage = 1;
      refreshTripsResults();
    });
    const vehicle = FF.byId('trip-vehicle');
    vehicle.addEventListener('change', function () {
      ui.tripVehicleId = vehicle.value;
      ui.tripPage = 1;
      refreshTripsResults();
    });
    const status = FF.byId('trip-status');
    status.addEventListener('change', function () {
      ui.tripStatus = status.value;
      ui.tripPage = 1;
      refreshTripsResults();
    });
    FF.byId('trips-export').addEventListener('click', exportTrips);
    refreshTripsResults();
  }

  pages.trips = renderTrips;

  /* ------------------------------------------------------------------ */
  /* Audit log                                                           */
  /* ------------------------------------------------------------------ */

  function actionLabel(action) {
    return ACTION_LABELS[action] || FF.titleCase(String(action || '').replace(/\./g, ' '));
  }

  function actionKind(action) {
    if (action === 'auth.failed' || action === 'auth.locked') return 'danger';
    if (action === 'auth.login') return 'ok';
    if (action === 'fare.update' || action === 'city.activate') return 'info';
    if (String(action).indexOf('reset') !== -1) return 'warn';
    return 'neutral';
  }

  function sortedAudit() {
    return state.audit.slice().sort(function (a, b) {
      return new Date(b.at) - new Date(a.at);
    });
  }

  function filteredAudit() {
    const needle = ui.auditQuery.trim().toLowerCase();
    return sortedAudit().filter(function (entry) {
      if (ui.auditActor !== 'all' && entry.actorName !== ui.auditActor) return false;
      if (!needle) return true;
      const haystack = [entry.actorName, entry.detail, actionLabel(entry.action), entry.role].join(' ').toLowerCase();
      return haystack.indexOf(needle) !== -1;
    });
  }

  function exportAudit() {
    const list = filteredAudit();
    if (!list.length) {
      FF.toast('There are no audit entries to export.', 'info');
      return;
    }
    const rows = [['Timestamp', 'Actor', 'Role', 'Action', 'Detail']].concat(list.map(function (entry) {
      return [
        Data.formatDateTime(entry.at),
        entry.actorName,
        Auth.roleInfo(entry.role).short,
        actionLabel(entry.action),
        entry.detail,
      ];
    }));
    Data.downloadCsv('farefair-audit-' + Data.dateKey(new Date()) + '.csv', rows);
    FF.audit('export.audit', 'Exported ' + list.length + ' audit entries to CSV');
    FF.toast('Exported ' + list.length + ' audit entries.');
  }

  function refreshAuditResults() {
    const results = FF.byId('audit-results');
    const count = FF.byId('audit-count');
    if (!results) return;
    const list = filteredAudit();
    if (count) count.textContent = list.length + ' event' + (list.length === 1 ? '' : 's');

    if (!list.length) {
      results.innerHTML = '<div class="card">' +
        FF.emptyState('shield', 'No audit events yet', 'Sign-ins and dataset changes will appear here.') + '</div>';
      return;
    }

    const totalPages = Math.max(1, Math.ceil(list.length / AUDIT_PER_PAGE));
    ui.auditPage = Math.min(Math.max(1, ui.auditPage), totalPages);
    const start = (ui.auditPage - 1) * AUDIT_PER_PAGE;
    const slice = list.slice(start, start + AUDIT_PER_PAGE);

    let rows = '';
    slice.forEach(function (entry) {
      rows += '<tr>' +
        '<td class="time-cell"><div class="primary-cell"><strong title="' + esc(Data.formatDateTime(entry.at)) + '">' +
          esc(Data.relativeTime(entry.at)) + '</strong><span>' + esc(Data.formatTime(entry.at)) + '</span></div></td>' +
        '<td data-label="Actor"><div class="primary-cell"><strong>' + esc(entry.actorName) + '</strong><span>' +
          esc(Auth.roleInfo(entry.role).short) + '</span></div></td>' +
        '<td data-label="Action">' + badge(actionKind(entry.action), actionLabel(entry.action)) + '</td>' +
        '<td class="cell-span" data-label="Detail">' + esc(entry.detail) + '</td>' +
      '</tr>';
    });

    results.innerHTML = '<div class="card"><div class="table-wrap"><table class="data-table table-stack"><thead><tr>' +
      '<th>When</th><th>Actor</th><th>Action</th><th>Detail</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="pagination"><span>Showing ' + (start + 1) + '–' + Math.min(start + AUDIT_PER_PAGE, list.length) +
        ' of ' + list.length + '</span>' +
        '<div class="pagination-btns">' +
          '<button type="button" class="btn btn-outline btn-sm" data-audit-page="prev"' + (ui.auditPage <= 1 ? ' disabled' : '') + '>Previous</button>' +
          '<span class="pill pill-quiet">Page ' + ui.auditPage + ' of ' + totalPages + '</span>' +
          '<button type="button" class="btn btn-outline btn-sm" data-audit-page="next"' + (ui.auditPage >= totalPages ? ' disabled' : '') + '>Next</button>' +
        '</div>' +
      '</div></div>';

    FF.qsa('[data-audit-page]', results).forEach(function (button) {
      button.addEventListener('click', function () {
        ui.auditPage += button.getAttribute('data-audit-page') === 'next' ? 1 : -1;
        refreshAuditResults();
      });
    });
  }

  function renderAudit() {
    if (!Auth.can(state.user, 'audit.view')) return;
    const actors = [];
    state.audit.forEach(function (entry) {
      if (actors.indexOf(entry.actorName) === -1) actors.push(entry.actorName);
    });
    actors.sort();
    if (ui.auditActor !== 'all' && actors.indexOf(ui.auditActor) === -1) ui.auditActor = 'all';

    const actorOptions = '<option value="all">All actors</option>' + actors.map(function (name) {
      return '<option value="' + esc(name) + '"' + (ui.auditActor === name ? ' selected' : '') + '>' + esc(name) + '</option>';
    }).join('');

    FF.dom.page.innerHTML =
      FF.pageHead(
        'Access & change log',
        'Every sign-in, edit and export recorded by the FareFair API.',
        '<button type="button" class="btn btn-outline" id="audit-export">' + icon('download') + ' Export CSV</button>'
      ) +
      '<div style="margin-bottom:16px">' +
        notice('info', 'This trail is stored in PostgreSQL and written by the API. Console-side events such as exports are mirrored to the same table.') +
      '</div>' +
      '<div class="toolbar">' +
        '<div class="search">' + icon('search') +
          '<input type="search" id="audit-search" placeholder="Search actor, action or detail" value="' + esc(ui.auditQuery) + '" aria-label="Search audit log">' +
        '</div>' +
        '<select class="select" id="audit-actor" aria-label="Filter by actor">' + actorOptions + '</select>' +
        '<span class="spacer"></span>' +
        '<span class="muted" id="audit-count" style="font-size:.73rem"></span>' +
      '</div>' +
      '<div id="audit-results"></div>';

    const search = FF.byId('audit-search');
    search.addEventListener('input', function () {
      ui.auditQuery = search.value;
      ui.auditPage = 1;
      refreshAuditResults();
    });
    const actor = FF.byId('audit-actor');
    actor.addEventListener('change', function () {
      ui.auditActor = actor.value;
      ui.auditPage = 1;
      refreshAuditResults();
    });
    FF.byId('audit-export').addEventListener('click', exportAudit);
    refreshAuditResults();
  }

  pages.audit = renderAudit;

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  function renderSettings() {
    if (!Auth.can(state.user, 'settings.view')) return;
    const source = state.data.source;
    const live = source.kind === 'api' || source.kind === 'live';
    const accounts = Auth.accounts();
    const activeId = FF.activeCityId();
    const active = state.data.cities[activeId];
    const cities = Object.keys(state.data.cities).map(function (id) { return state.data.cities[id]; });
    const vehicles = cities.reduce(function (sum, city) { return sum + (city.vehicles || []).length; }, 0);
    const ordinances = Data.flattenOrdinances(state.data.cities).length;
    const session = state.session;

    const sourcePill = '<span class="pill pill-live pill-dot">PostgreSQL API</span>';
    const sourceCopy = 'Reading live rows from <code>' + esc(source.base) + '</code>';

    const accountRows = accounts.map(function (account) {
      const scope = account.role === 'super_admin'
        ? 'All ' + cities.length + ' cit' + (cities.length === 1 ? 'y' : 'ies')
        : account.role === 'analyst'
          ? 'Read-only · ' + (cities.length === 1 ? cityShort(cities[0]) : 'all cities')
          : account.scope.map(function (id) {
              const city = state.data.cities[id];
              return city ? cityShort(city) : id;
            }).join(', ') || '—';
      return '<tr>' +
        '<td><div class="primary-cell"><strong>' + esc(account.name) + '</strong><span>' + esc(account.email) + '</span></div></td>' +
        '<td class="mono">' + esc(account.username) + '</td>' +
        '<td>' + badge(account.role === 'super_admin' ? 'ok' : account.role === 'city_admin' ? 'info' : 'neutral', Auth.roleInfo(account.role).short) + '</td>' +
        '<td>' + esc(scope) + '</td>' +
      '</tr>';
    }).join('');

    const user = state.user;

    FF.dom.page.innerHTML =
      FF.pageHead(
        'Workspace configuration',
        'Dataset source, seeded accounts and the PostgreSQL working state.',
        '<span class="pill pill-quiet">' + icon('gear') + ' Super admin only</span>'
      ) +
      '<div class="grid-2">' +
        '<div class="stack">' +
          '<div class="card">' +
            '<div class="card-head"><div><h3>Dataset source</h3><p>Where the console reads city data</p></div>' +
              '<button type="button" class="btn btn-outline btn-sm" id="reload-data">' + icon('refresh') + ' Reload</button></div>' +
            '<div class="card-body">' +
              '<div class="source-banner">' + sourcePill + '<span>' + sourceCopy + '</span></div>' +
              (!live && source.error
                ? '<div style="margin-top:12px">' + notice('info', 'Fetch note: ' + esc(source.error)) + '</div>'
                : '') +
              '<dl class="detail-grid" style="margin-top:14px">' +
                detailItem('City datasets', esc(String(cities.length))) +
                detailItem('Fare routes', esc(String(active && active.fareRoutes ? active.fareRoutes.length : 0))) +
                detailItem('Vehicles', esc(String(vehicles))) +
                detailItem('Ordinance records', esc(String(ordinances))) +
                detailItem('Trip records', esc(String(state.trips.length))) +
              '</dl>' +
            '</div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-head"><div><h3>Seeded accounts</h3><p>' +
              accounts.length + ' people · scrypt · PostgreSQL</p></div>' +
              badge('neutral', 'API') + '</div>' +
            '<div class="table-wrap"><table class="data-table"><thead><tr>' +
              '<th>Person</th><th>Username</th><th>Role</th><th>Scope</th>' +
            '</tr></thead><tbody>' + accountRows + '</tbody></table></div>' +
            '<div class="card-body" style="padding-top:12px">' +
              '<p class="field-hint">Passwords are verified by the API against scrypt hashes stored in <span class="mono">admin_users</span>. The console never stores the plain-text password.</p>' +
            '</div>' +
          '</div>' +
          '<div class="card card-pad">' +
            '<h3 style="font-size:.94rem;font-weight:650">PostgreSQL workspace</h3>' +
            '<p class="muted" style="margin-top:3px;font-size:.77rem">' +
              (active && active.fareRoutes ? active.fareRoutes.length : 0) + ' published fare route' +
              ((active && active.fareRoutes ? active.fareRoutes.length : 0) === 1 ? '' : 's') + ' · ' +
              state.audit.length + ' audit event' + (state.audit.length === 1 ? '' : 's') + ' read from the API.</p>' +
            '<div style="margin-top:12px">' +
              notice('info', 'PostgreSQL is the single source of truth. The console no longer caches fare overrides in this browser.') +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="stack">' +
          '<div class="card card-pad">' +
            '<h3 style="font-size:.94rem;font-weight:650">Live dataset</h3>' +
            '<p class="muted" style="margin-top:3px;font-size:.77rem">The city the passenger app opens by default. Writes cities.is_focus in PostgreSQL.</p>' +
            '<div class="row" style="margin-top:12px">' +
              '<select class="select" id="active-city" style="flex:1" aria-label="Active city dataset">' +
                FF.cityOptions(activeId, false) +
              '</select>' +
              '<button type="button" class="btn btn-primary btn-sm" id="apply-active">Apply</button>' +
            '</div>' +
            '<p class="field-hint" style="margin-top:8px">Current: ' + esc(active ? active.displayName : '—') + '</p>' +
          '</div>' +
          '<div class="card card-pad">' +
            '<div class="account-card">' +
              '<div class="avatar">' + esc(Auth.initials(user.name)) + '</div>' +
              '<div><h3>' + esc(user.name) + '</h3><p>' + esc(user.title) + ' · ' + esc(Auth.roleInfo(user.role).short) + '</p></div>' +
            '</div>' +
            '<dl class="detail-grid" style="margin-top:14px">' +
              detailItem('Username', '<span class="mono">' + esc(user.username) + '</span>') +
              detailItem('Email', esc(user.email)) +
              detailItem('Scope', esc(FF.scopeLabel(user))) +
              detailItem('Session issued', esc(session ? Data.formatDateTime(new Date(session.issuedAt)) : '—')) +
              detailItem('Expires', esc(session ? Data.formatDateTime(new Date(session.expiresAt)) : '—')) +
              detailItem('Role', esc(Auth.roleInfo(user.role).label)) +
            '</dl>' +
            '<div class="row" style="margin-top:14px">' +
              '<button type="button" class="btn btn-outline btn-sm" id="settings-signout">' + icon('logout') + ' Sign out</button>' +
            '</div>' +
          '</div>' +
          '<div class="card card-pad">' +
            '<h3 style="font-size:.94rem;font-weight:650">Server authentication</h3>' +
            '<p class="muted" style="margin-top:3px;font-size:.77rem">Three people are seeded in <code class="mono">admin_users</code>. Passwords are scrypt hashes; sessions are opaque bearer tokens stored as SHA-256 digests in <code class="mono">admin_sessions</code> with an eight-hour lifetime.</p>' +
            '<div style="margin-top:12px">' +
              notice('success', 'Every admin write is authorised by the API and recorded in the PostgreSQL audit trail.') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    const reload = FF.byId('reload-data');
    if (reload) reload.addEventListener('click', function () {
      reload.disabled = true;
      FF.reloadDatasets();
    });

    const apply = FF.byId('apply-active');
    const activeSelect = FF.byId('active-city');
    if (apply && activeSelect) apply.addEventListener('click', function () {
      FF.setActiveCity(activeSelect.value)
        .then(function (ok) { if (ok) FF.renderRoute(); });
    });

    const signOut = FF.byId('settings-signout');
    if (signOut) signOut.addEventListener('click', function () {
      if (typeof FF.endSession === 'function') FF.endSession('You have been signed out.', 'info');
    });
  }

  pages.settings = renderSettings;
})();
