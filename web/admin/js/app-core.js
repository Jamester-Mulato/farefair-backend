/* FareFair Admin Console — core runtime.
 * Shared state, storage, data overrides, chrome, dialogs, routing.
 * Page renderers live in app-pages.js; login wiring in app-boot.js.
 */
window.FF = (function () {
  'use strict';

  const Data = window.FareFairData;
  const Auth = window.FareFairAuth;

  const KEYS = {
    session: 'farefair.admin.session.v1',
    overrides: 'farefair.admin.overrides.v1',
    audit: 'farefair.admin.audit.v1',
    lockout: 'farefair.admin.lockout.v1',
    lastUser: 'farefair.admin.lastuser.v1',
  };

  const IDLE_MS = 30 * 60 * 1000;
  const MAX_SESSION_MS = 8 * 60 * 60 * 1000;

  function byId(id) { return document.getElementById(id); }
  function qsa(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }

  const dom = {
    loginView: byId('login-view'),
    appView: byId('app-view'),
    page: byId('page'),
    pageTitle: byId('page-title'),
    pageSubtitle: byId('page-subtitle'),
    sidebar: byId('sidebar'),
    sidebarNav: byId('sidebar-nav'),
    sidebarBackdrop: byId('sidebar-backdrop'),
    menuBtn: byId('menu-btn'),
    navCityCount: byId('nav-city-count'),
    sidebarReview: byId('sidebar-review'),
    reviewTitle: byId('review-title'),
    reviewCopy: byId('review-copy'),
    reviewLink: byId('review-link'),
    sidebarAvatar: byId('sidebar-avatar'),
    sidebarName: byId('sidebar-name'),
    sidebarRole: byId('sidebar-role'),
    sidebarLogout: byId('sidebar-logout'),
    dataSourcePill: byId('data-source-pill'),
    scopePill: byId('scope-pill'),
    accountBtn: byId('account-btn'),
    accountMenu: byId('account-menu'),
    topbarAvatar: byId('topbar-avatar'),
    topbarName: byId('topbar-name'),
    dropdownName: byId('dropdown-name'),
    dropdownEmail: byId('dropdown-email'),
    dropdownMeta: byId('dropdown-meta'),
    dropdownAccount: byId('dropdown-account'),
    dropdownLogout: byId('dropdown-logout'),
    modal: byId('modal'),
    modalEyebrow: byId('modal-eyebrow'),
    modalTitle: byId('modal-title'),
    modalBody: byId('modal-body'),
    modalFoot: byId('modal-foot'),
    modalClose: byId('modal-close'),
    toasts: byId('toasts'),
  };

  /* ------------------------------------------------------------------ */
  /* Storage                                                             */
  /* ------------------------------------------------------------------ */

  function readJson(area, key, fallback) {
    try {
      const store = window[area];
      if (!store) return fallback;
      const raw = store.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function writeJson(area, key, value) {
    try {
      window[area].setItem(key, JSON.stringify(value));
    } catch (error) { /* storage unavailable */ }
  }

  function removeKey(area, key) {
    try { window[area].removeItem(key); } catch (error) { /* ignore */ }
  }

  function normalizeOverrides(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const vehicles = {};
    if (source.vehicles && typeof source.vehicles === 'object') {
      Object.keys(source.vehicles).forEach(function (cityId) {
        const patches = source.vehicles[cityId];
        if (!patches || typeof patches !== 'object') return;
        const clean = {};
        Object.keys(patches).forEach(function (vehicleId) {
          const patch = patches[vehicleId];
          if (!patch || typeof patch !== 'object') return;
          clean[vehicleId] = {
            baseFare: Number(patch.baseFare),
            baseDistanceKm: Number(patch.baseDistanceKm),
            perKmRate: Number(patch.perKmRate),
            minFare: Number(patch.minFare),
            maxCustomary: Number(patch.maxCustomary),
            typicalCapacity: Number(patch.typicalCapacity),
            active: patch.active !== false,
          };
        });
        if (Object.keys(clean).length) vehicles[cityId] = clean;
      });
    }
    return {
      activeCityId: typeof source.activeCityId === 'string' ? source.activeCityId : null,
      vehicles: vehicles,
    };
  }

  function sanitizeAudit(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter(function (entry) { return entry && entry.at && entry.action; })
      .slice(0, 300);
  }

  const state = {
    user: null,
    session: null,
    data: null,
    dataLoading: false,
    dataError: null,
    trips: [],
    audit: sanitizeAudit(readJson('localStorage', KEYS.audit, [])),
    overrides: normalizeOverrides(readJson('localStorage', KEYS.overrides, null)),
    route: 'overview',
    sessionTimer: null,
    ui: {
      cityQuery: '',
      cityStatus: 'all',
      fareCityId: '',
      fareVehicleId: '',
      fareDraft: null,
      fareDraftKey: '',
      routeQuery: '',
      routeVehicleId: '',
      routeDraftRow: 0,
      routeDraft: null,
      lookupOrigin: '',
      lookupDestination: '',
      lookupPassengers: '1',
      lookupDiscount: 'none',
      lookupResult: null,
      lookupError: '',
      ordQuery: '',
      ordCityId: 'all',
      tripQuery: '',
      tripCityId: 'all',
      tripVehicleId: 'all',
      tripStatus: 'all',
      tripPage: 1,
      auditQuery: '',
      auditActor: 'all',
      auditPage: 1,
    },
  };
  const ui = state.ui;

  /* ------------------------------------------------------------------ */
  /* Markup helpers                                                      */
  /* ------------------------------------------------------------------ */

  const esc = Data.escapeHtml;

  function icon(name, extraClass) {
    return '<svg class="icon ' + (extraClass || '') + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  function titleCase(value) {
    return String(value || '')
      .replace(/(^|[\s_-])([a-z])/g, function (_, prefix, letter) {
        return (prefix ? ' ' : '') + letter.toUpperCase();
      })
      .trim();
  }

  function badge(kind, label) {
    return '<span class="badge badge-' + kind + '">' + esc(label) + '</span>';
  }

  function notice(kind, html) {
    const iconName = kind === 'success' ? 'check' : kind === 'danger' ? 'alert' : kind === 'info' ? 'info' : 'alert';
    return '<div class="notice notice-' + kind + '">' + icon(iconName) + '<div>' + html + '</div></div>';
  }

  function emptyState(iconName, title, body) {
    return (
      '<div class="empty">' +
        '<div class="empty-icon">' + icon(iconName || 'search') + '</div>' +
        '<h3>' + esc(title) + '</h3>' +
        '<p>' + esc(body || '') + '</p>' +
      '</div>'
    );
  }

  function sparkline(values) {
    if (!values || values.length < 2) return '';
    const w = 86;
    const h = 30;
    const pad = 3;
    const max = Math.max.apply(null, values);
    const min = Math.min.apply(null, values);
    const span = max - min || 1;
    const points = values.map(function (value, index) {
      return {
        x: pad + (index / (values.length - 1)) * (w - pad * 2),
        y: h - pad - ((value - min) / span) * (h - pad * 2),
      };
    });
    const line = points.map(function (point, index) {
      return (index ? 'L' : 'M') + point.x.toFixed(1) + ' ' + point.y.toFixed(1);
    }).join(' ');
    const last = points[points.length - 1];
    const first = points[0];
    const area = line + ' L' + last.x.toFixed(1) + ' ' + h + ' L' + first.x.toFixed(1) + ' ' + h + ' Z';
    return '<svg class="kpi-spark" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true" focusable="false">' +
      '<path class="spark-area" d="' + area + '"/>' +
      '<path class="spark-line" d="' + line + '"/>' +
      '<circle class="spark-dot" cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="2.1"/>' +
    '</svg>';
  }

  function kpiCard(options) {
    const noteClass = options.noteTone ? ' ' + options.noteTone : '';
    return (
      '<article class="kpi">' +
        '<div class="kpi-top">' +
          '<span class="kpi-label">' + esc(options.label) + '</span>' +
          '<span class="kpi-icon ' + (options.tone || '') + '">' + icon(options.iconName || 'trend') + '</span>' +
        '</div>' +
        '<div class="kpi-value">' + options.value +
          (options.unit ? '<small>' + esc(options.unit) + '</small>' : '') +
        '</div>' +
        '<div class="kpi-note' + noteClass + '">' + options.note + '</div>' +
        sparkline(options.spark) +
      '</article>'
    );
  }

  function statStrip(items) {
    return '<div class="stat-strip">' + items.map(function (item) {
      return '<div><span>' + esc(item.label) + '</span><strong>' + item.value + '</strong></div>';
    }).join('') + '</div>';
  }

  function pageHead(title, subtitle, actions) {
    return (
      '<div class="page-head">' +
        '<div><h2>' + esc(title) + '</h2><p>' + esc(subtitle) + '</p></div>' +
        (actions ? '<div class="page-actions">' + actions + '</div>' : '') +
      '</div>'
    );
  }

  /* ------------------------------------------------------------------ */
  /* Toasts                                                              */
  /* ------------------------------------------------------------------ */

  function toast(message, type, timeout) {
    const kind = type || 'success';
    const iconName = kind === 'error' ? 'alert' : kind === 'info' ? 'info' : 'check';
    const node = document.createElement('div');
    node.className = 'toast ' + kind;
    node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    node.innerHTML = icon(iconName) + '<p>' + esc(message) + '</p>' +
      '<button type="button" aria-label="Dismiss notification">' + icon('x') + '</button>';
    const remove = function () {
      node.classList.add('leaving');
      setTimeout(function () { node.remove(); }, 200);
    };
    node.querySelector('button').addEventListener('click', remove);
    const duration = timeout || (kind === 'error' ? 6000 : 3800);
    node.style.setProperty('--toast-time', duration + 'ms');
    dom.toasts.appendChild(node);
    setTimeout(remove, duration);
  }

  /* ------------------------------------------------------------------ */
  /* Modal                                                               */
  /* ------------------------------------------------------------------ */

  function closeModal() {
    if (dom.modal && dom.modal.open) dom.modal.close();
  }

  function openModal(options) {
    const opts = options || {};
    dom.modalEyebrow.textContent = opts.eyebrow || '';
    dom.modalEyebrow.hidden = !opts.eyebrow;
    dom.modalTitle.textContent = opts.title || '';
    dom.modalBody.innerHTML = opts.body || '';
    dom.modalFoot.innerHTML = opts.footer || '';
    qsa('[data-modal-close]', dom.modal).forEach(function (button) {
      button.addEventListener('click', closeModal);
    });
    if (dom.modal.open) dom.modal.close();
    dom.modal.showModal();
    setTimeout(function () {
      const target = dom.modal.querySelector('[data-autofocus]') || dom.modal.querySelector('.modal-foot .btn, .modal-foot button, .modal-body input, .modal-body select');
      if (target) target.focus({ preventScroll: true });
    }, 20);
    if (opts.onMount) opts.onMount(dom.modal);
  }

  function confirmModal(options) {
    const opts = options || {};
    openModal({
      eyebrow: opts.eyebrow || 'Please confirm',
      title: opts.title,
      body: '<p style="margin:0">' + opts.message + '</p>',
      footer:
        '<button type="button" class="btn btn-outline" data-modal-close>Cancel</button>' +
        '<button type="button" class="btn ' + (opts.tone === 'danger' ? 'btn-danger' : 'btn-primary') + '" id="confirm-modal-action">' + esc(opts.confirmLabel || 'Confirm') + '</button>',
      onMount: function (modal) {
        const button = modal.querySelector('#confirm-modal-action');
        if (button) button.addEventListener('click', function () {
          closeModal();
          if (opts.onConfirm) opts.onConfirm();
        });
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Audit trail                                                         */
  /* ------------------------------------------------------------------ */

  function audit(action, detail, options) {
    const opts = options || {};
    const entry = {
      id: 'evt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      at: new Date().toISOString(),
      actorId: opts.actorId || (state.user && state.user.id) || null,
      actorName: opts.actorName || (state.user && state.user.name) || 'System',
      role: opts.role || (state.user && state.user.role) || 'guest',
      action: action,
      detail: String(detail || ''),
      cityId: opts.cityId || null,
    };
    state.audit.unshift(entry);
    if (state.audit.length > 300) state.audit.length = 300;
    writeJson('localStorage', KEYS.audit, state.audit);

    // Fare/city/auth events are recorded by the API itself. Everything else
    // (exports, exports of filtered lists) is mirrored so the server audit log
    // stays complete.
    const api = window.FareFairApi;
    const serverAudited = /^(auth\.|fare\.update$|fare\.reset$|city\.activate$)/.test(action);
    if (api && api.live() && !serverAudited) {
      api.post('/v1/admin/audit', {
        action: action,
        detail: String(detail || ''),
        cityId: opts.cityId || undefined,
      }).catch(function () { /* keep the local entry */ });
    }
    return entry;
  }

  /* ------------------------------------------------------------------ */
  /* Session                                                             */
  /* ------------------------------------------------------------------ */

  function issueSession(user) {
    const now = Date.now();
    state.session = {
      userId: user.id,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
        title: user.title,
        scope: (user.scope || []).slice(),
      },
      issuedAt: now,
      lastActiveAt: now,
      expiresAt: Math.min(now + MAX_SESSION_MS, now + IDLE_MS),
    };
    writeJson('sessionStorage', KEYS.session, state.session);
  }

  function restoreSession() {
    const saved = readJson('sessionStorage', KEYS.session, null);
    if (!saved || typeof saved !== 'object') return null;
    const account = saved.user && saved.user.id
      ? saved.user
      : Auth.accounts().filter(function (item) { return item.id === saved.userId; })[0];
    const issued = Number(saved.issuedAt) || 0;
    const lastActive = Number(saved.lastActiveAt) || 0;
    const expires = Number(saved.expiresAt) || 0;
    const now = Date.now();
    if (!account || !expires || now >= expires ||
        now - lastActive >= IDLE_MS || now - issued >= MAX_SESSION_MS) {
      removeKey('sessionStorage', KEYS.session);
      return null;
    }
    state.session = {
      userId: account.id,
      user: {
        id: account.id,
        name: account.name,
        username: account.username,
        email: account.email,
        role: account.role,
        title: account.title,
        scope: (account.scope || []).slice(),
      },
      issuedAt: issued,
      lastActiveAt: lastActive,
      expiresAt: expires,
    };
    return account;
  }

  function touchSession() {
    if (!state.user || !state.session) return;
    const now = Date.now();
    if (now - state.session.lastActiveAt < 30000) return;
    state.session.lastActiveAt = now;
    state.session.expiresAt = Math.min(state.session.issuedAt + MAX_SESSION_MS, now + IDLE_MS);
    writeJson('sessionStorage', KEYS.session, state.session);
  }

  function sessionIsExpired() {
    if (!state.session) return true;
    const now = Date.now();
    return now >= state.session.expiresAt ||
      now - state.session.lastActiveAt >= IDLE_MS ||
      now - state.session.issuedAt >= MAX_SESSION_MS;
  }

  function startSessionWatch() {
    if (state.sessionTimer) clearInterval(state.sessionTimer);
    state.sessionTimer = setInterval(function () {
      if (!state.user) return;
      if (sessionIsExpired() && typeof FF.endSession === 'function') {
        FF.endSession('Your session expired after 30 minutes of inactivity. Please sign in again.', 'info');
      }
    }, 15000);
  }

  /* ------------------------------------------------------------------ */
  /* Datasets & overrides                                                */
  /* ------------------------------------------------------------------ */

  function activeCityId() {
    if (!state.data) return null;
    const ids = Object.keys(state.data.cities);
    const chosen = state.overrides.activeCityId;
    if (chosen && ids.indexOf(chosen) !== -1) return chosen;
    const config = state.data.config || {};
    if (config.activeCityId && ids.indexOf(config.activeCityId) !== -1) return config.activeCityId;
    return ids[0] || null;
  }

  function sortedCities() {
    if (!state.data) return [];
    const activeId = activeCityId();
    return Object.keys(state.data.cities)
      .map(function (id) { return state.data.cities[id]; })
      .sort(function (a, b) {
        const aLive = a.id === activeId ? 0 : 1;
        const bLive = b.id === activeId ? 0 : 1;
        return aLive - bLive || String(a.displayName).localeCompare(String(b.displayName));
      });
  }

  function getCity(cityId) {
    const base = state.data && state.data.cities[cityId];
    if (!base) return null;
    const city = JSON.parse(JSON.stringify(base));
    const patches = state.overrides.vehicles[cityId] || {};
    city.vehicles = (city.vehicles || []).map(function (vehicle) {
      const patch = patches[vehicle.vehicleId];
      return patch ? Object.assign({}, vehicle, patch) : vehicle;
    });
    return city;
  }

  function getVehicles(cityId) {
    const city = getCity(cityId);
    return city ? (city.vehicles || []) : [];
  }

  function getVehicle(cityId, vehicleId) {
    return getVehicles(cityId).filter(function (vehicle) {
      return vehicle.vehicleId === vehicleId;
    })[0] || null;
  }

  function hasOverride(cityId, vehicleId) {
    const patches = state.overrides.vehicles[cityId];
    return Boolean(patches && patches[vehicleId]);
  }

  function saveOverrides() {
    writeJson('localStorage', KEYS.overrides, state.overrides);
  }

  async function setActiveCity(cityId) {
    if (!state.data || !Auth.can(state.user, 'city.activate')) return false;
    const city = state.data.cities[cityId];
    if (!city) return false;

    const api = window.FareFairApi;
    if (api && api.live()) {
      try {
        await api.post(
          '/v1/admin/cities/' + encodeURIComponent(cityId) + '/activate',
          {}
        );
        state.overrides.activeCityId = null;
        saveOverrides();
        await reloadDatasets();
        toast(city.displayName + ' is now the live dataset.');
        return true;
      } catch (error) {
        toast(error.message || 'Could not activate this city.', 'error');
        return false;
      }
    }

    state.overrides.activeCityId = cityId;
    saveOverrides();
    audit('city.activate', 'Set ' + city.displayName + ' as the live dataset', { cityId: cityId });
    fillChrome();
    toast(city.displayName + ' is now the live dataset.');
    return true;
  }

  function resetVehicleOverride(cityId, vehicleId) {
    const patches = state.overrides.vehicles[cityId];
    if (!patches || !patches[vehicleId]) return false;
    delete patches[vehicleId];
    if (!Object.keys(patches).length) delete state.overrides.vehicles[cityId];
    saveOverrides();
    return true;
  }

  function resetAllOverrides() {
    state.overrides = { activeCityId: null, vehicles: {} };
    saveOverrides();
  }

  function ensureFareSelection() {
    if (!state.data) return;
    const ids = Object.keys(state.data.cities);
    if (!ui.fareCityId || ids.indexOf(ui.fareCityId) === -1) {
      ui.fareCityId = activeCityId() || ids[0] || '';
    }
    const vehicles = getVehicles(ui.fareCityId);
    const exists = vehicles.some(function (vehicle) { return vehicle.vehicleId === ui.fareVehicleId; });
    if (!exists) {
      ui.fareVehicleId = vehicles.length ? vehicles[0].vehicleId : '';
      ui.fareDraft = null;
      ui.fareDraftKey = '';
    }
  }

  async function loadDataAndRender() {
    if (state.dataLoading) return;
    state.dataLoading = true;
    state.dataError = null;
    setPageLoading();
    try {
      const result = await Data.load();
      state.data = result;
      if (result.source.kind === 'api') {
        // PostgreSQL owns the dataset, active city and tariffs. Drop any
        // browser-only overrides left by earlier console versions.
        state.overrides = { activeCityId: null, vehicles: {} };
        saveOverrides();
      }
      const trips = await Data.loadTrips().catch(function () { return null; });
      state.trips = trips !== null
        ? trips
        : Data.buildTrips(result.cities, function (cityId) { return getVehicles(cityId); });
      const serverAudit = await Data.loadAudit().catch(function () { return null; });
      if (serverAudit) state.audit = serverAudit;
      const accounts = await Data.loadAccounts().catch(function () { return null; });
      if (accounts && accounts.length) Auth.setAccounts(accounts);
      ensureFareSelection();
      state.dataLoading = false;
      setDataSourcePill();
      fillChrome();
      renderRoute();
    } catch (error) {
      state.dataLoading = false;
      state.dataError = error;
      renderFatal();
    }
  }

  async function reloadDatasets() {
    if (state.dataLoading) return;
    state.data = null;
    state.trips = [];
    state.dataError = null;
    await loadDataAndRender();
    if (state.data) toast('Datasets reloaded from the active source.');
  }

  function setPageLoading() {
    if (!state.user) return;
    dom.pageTitle.textContent = 'Loading workspace';
    dom.pageSubtitle.textContent = 'Reading PostgreSQL datasets…';
    const card =
      '<div class="sk-card"><div class="sk-line" style="width:60%"></div>' +
      '<div class="sk-line tall" style="width:35%;margin-top:14px"></div>' +
      '<div class="sk-line" style="width:45%;margin-top:12px"></div></div>';
    dom.page.innerHTML =
      '<div class="sk-stack">' +
        '<div class="sk-grid">' + card + card + card + card + '</div>' +
        '<div class="sk-card"><div class="sk-line" style="width:28%"></div>' +
          '<div class="sk-line" style="margin-top:18px"></div>' +
          '<div class="sk-line" style="width:92%"></div>' +
          '<div class="sk-line" style="width:74%"></div></div>' +
        '<div class="sk-card"><div class="sk-line" style="width:22%"></div>' +
          '<div class="sk-line" style="margin-top:18px"></div>' +
          '<div class="sk-line" style="width:88%"></div></div>' +
      '</div>';
  }

  function renderFatal() {
    if (!state.user) return;
    const message = state.dataError ? String(state.dataError.message || state.dataError) : 'Unknown error';
    dom.pageTitle.textContent = 'Workspace unavailable';
    dom.pageSubtitle.textContent = 'The console could not reach the FareFair API.';
    dom.page.innerHTML =
      '<div class="page-head"><div><h2>We could not reach PostgreSQL</h2>' +
      '<p>The admin console reads every city, fare and trip from the FareFair API. Start the API and try again.</p></div></div>' +
      '<div class="card"><div class="empty">' +
        '<div class="empty-icon">' + icon('alert') + '</div>' +
        '<h3>Connection problem</h3>' +
        '<p>' + esc(message) + '</p>' +
        '<div class="row" style="justify-content:center;margin-top:16px">' +
          '<button type="button" class="btn btn-primary" id="retry-data">' + icon('refresh') + ' Try again</button>' +
        '</div>' +
      '</div></div>';
    const retry = byId('retry-data');
    if (retry) retry.addEventListener('click', function () {
      state.dataError = null;
      loadDataAndRender();
    });
  }

  function setDataSourcePill() {
    const pill = dom.dataSourcePill;
    if (!state.data) {
      pill.className = 'pill pill-quiet';
      pill.textContent = 'Loading datasets…';
      pill.title = 'Reading city datasets';
      return;
    }
    if (state.data.source.kind === 'api') {
      pill.className = 'pill pill-live pill-dot';
      pill.textContent = 'PostgreSQL API';
      pill.title = 'Reading live rows from the FareFair API at ' + state.data.source.base;
    } else if (state.data.source.kind === 'live') {
      pill.className = 'pill pill-live pill-dot';
      pill.textContent = 'Live datasets';
      pill.title = 'Reading live JSON from ' + state.data.source.base;
    } else {
      pill.className = 'pill pill-snapshot pill-dot';
      pill.textContent = 'Embedded snapshot';
      pill.title = 'Live fetch unavailable — using the bundled snapshot. ' + (state.data.source.error || '');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Chrome                                                              */
  /* ------------------------------------------------------------------ */

  function roleBadgeKind(role) {
    if (role === 'super_admin') return 'ok';
    if (role === 'city_admin') return 'info';
    return 'neutral';
  }

  function scopeLabel(user) {
    if (!user) return '—';
    const total = state.data ? Object.keys(state.data.cities).length : user.scope.length;
    if (user.role === 'super_admin') return 'All ' + total + ' cit' + (total === 1 ? 'y' : 'ies');
    if (user.role === 'analyst') {
      const onlyCity = total === 1 && state.data
        ? String(state.data.cities[Object.keys(state.data.cities)[0]].displayName || '').split(',')[0]
        : '';
      return 'Read-only · ' + (onlyCity || 'network-wide');
    }
    return user.scope.length + ' cit' + (user.scope.length === 1 ? 'y' : 'ies') + ' in scope';
  }

  function scopeTitle(user) {
    if (!user) return '';
    if (user.role !== 'city_admin') return 'Access to every city dataset';
    return user.scope.map(function (id) {
      return state.data && state.data.cities[id] ? state.data.cities[id].displayName.split(',')[0] : id;
    }).join(', ');
  }

  function fillChrome() {
    const user = state.user;
    if (!user) return;
    const initials = Auth.initials(user.name);
    dom.sidebarAvatar.textContent = initials;
    dom.topbarAvatar.textContent = initials;
    dom.sidebarName.textContent = user.name;
    dom.sidebarRole.textContent = Auth.roleInfo(user.role).short;
    dom.topbarName.textContent = user.name.split(' ')[0];
    dom.dropdownName.textContent = user.name;
    dom.dropdownEmail.textContent = user.email;
    dom.dropdownMeta.innerHTML =
      '<span class="badge badge-' + roleBadgeKind(user.role) + '">' + esc(Auth.roleInfo(user.role).short) + '</span>' +
      '<span class="pill pill-quiet">' + esc(scopeLabel(user)) + '</span>';
    dom.scopePill.textContent = scopeLabel(user);
    dom.scopePill.title = scopeTitle(user);
    dom.scopePill.hidden = false;

    const cities = state.data ? Object.keys(state.data.cities).length : 0;
    dom.navCityCount.textContent = cities ? String(cities) : '';
    dom.navCityCount.hidden = !cities;

    const provisional = state.data
      ? Object.keys(state.data.cities).map(function (id) { return state.data.cities[id]; })
          .filter(function (city) { return city.provenance && city.provenance.provisional; }).length
      : 0;
    dom.sidebarReview.hidden = !state.data || provisional === 0;
    if (provisional > 0) {
      dom.reviewCopy.textContent = provisional + ' provisional dataset' + (provisional === 1 ? '' : 's') + ' need LGU verification.';
    }

    qsa('.nav-item', dom.sidebarNav).forEach(function (button) {
      const route = button.getAttribute('data-route');
      if (route === 'audit') button.hidden = !Auth.can(user, 'audit.view');
      if (route === 'settings') button.hidden = !Auth.can(user, 'settings.view');
    });
  }

  function updateNav(route) {
    qsa('.nav-item', dom.sidebarNav).forEach(function (button) {
      const isActive = button.getAttribute('data-route') === route;
      button.classList.toggle('active', isActive);
      if (isActive) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Routing                                                             */
  /* ------------------------------------------------------------------ */

  const ROUTES = {
    overview: { title: 'Overview', subtitle: 'Cabadbaran City fare coverage and recent activity.' },
    cities: { title: 'Cities', subtitle: 'The Cabadbaran City dataset and its provenance.' },
    fares: { title: 'Fare Matrix', subtitle: 'Per-kilometre fallback for places outside the published matrix.' },
    routes: { title: 'Fare Routes', subtitle: 'The published Cabadbaran point-to-point tricycle fares.' },
    seeds: { title: 'Fare Seeds', subtitle: 'Validate, compile, publish and roll back the seed clients ingest.' },
    ordinances: { title: 'Ordinances', subtitle: 'The Cabadbaran City tricycle fare matrix and its legal basis.' },
    trips: { title: 'Trip Records', subtitle: 'Estimates recorded across Cabadbaran City in the last seven days.' },
    audit: { title: 'Audit Log', subtitle: 'Sign-ins and dataset changes recorded in PostgreSQL.' },
    settings: { title: 'Settings', subtitle: 'API connection, seeded accounts and PostgreSQL workspace.' },
  };

  const pages = {};

  function routeFromHash() {
    const raw = String(location.hash || '').replace(/^#\/?/, '').split('?')[0].trim();
    return ROUTES[raw] ? raw : 'overview';
  }

  function navigate(route) {
    const target = ROUTES[route] ? route : 'overview';
    if (state.route === target) {
      renderRoute();
    } else {
      location.hash = '#/' + target;
    }
  }

  function renderRoute() {
    if (!state.user) return;
    if (!state.data) {
      if (!state.dataLoading) loadDataAndRender();
      return;
    }
    let route = ROUTES[state.route] ? state.route : 'overview';
    if (route === 'audit' && !Auth.can(state.user, 'audit.view')) route = 'overview';
    if (route === 'settings' && !Auth.can(state.user, 'settings.view')) route = 'overview';
    const routeChanged = state.route !== route;
    state.route = route;
    if (location.hash !== '#/' + route) {
      try { history.replaceState(null, '', '#/' + route); } catch (error) { /* ignore */ }
    }
    const meta = ROUTES[route];
    dom.pageTitle.textContent = meta.title;
    dom.pageSubtitle.textContent = meta.subtitle;
    document.title = meta.title + ' · FareFair Admin';
    updateNav(route);
    fillChrome();
    setDataSourcePill();
    const renderer = pages[route];
    if (typeof renderer === 'function') {
      renderer();
    } else {
      dom.page.innerHTML = emptyState('alert', 'Page unavailable', 'This section has not finished loading.');
    }
    if (dom.page) {
      dom.page.classList.remove('page-enter');
      void dom.page.offsetWidth;
      dom.page.classList.add('page-enter');
    }
    const bar = document.getElementById('route-progress');
    if (bar) {
      bar.classList.remove('is-on');
      void bar.offsetWidth;
      bar.classList.add('is-on');
      setTimeout(function () { bar.classList.remove('is-on'); }, 900);
    }
    if (routeChanged && window.scrollY > 0) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }
  }

  return {
    KEYS: KEYS,
    IDLE_MS: IDLE_MS,
    MAX_SESSION_MS: MAX_SESSION_MS,
    dom: dom,
    state: state,
    ui: ui,
    pages: pages,
    ROUTES: ROUTES,
    esc: esc,
    byId: byId,
    qsa: qsa,
    icon: icon,
    titleCase: titleCase,
    badge: badge,
    notice: notice,
    emptyState: emptyState,
    kpiCard: kpiCard,
    statStrip: statStrip,
    pageHead: pageHead,
    toast: toast,
    openModal: openModal,
    closeModal: closeModal,
    confirmModal: confirmModal,
    audit: audit,
    readJson: readJson,
    writeJson: writeJson,
    removeKey: removeKey,
    issueSession: issueSession,
    restoreSession: restoreSession,
    touchSession: touchSession,
    sessionIsExpired: sessionIsExpired,
    startSessionWatch: startSessionWatch,
    activeCityId: activeCityId,
    sortedCities: sortedCities,
    getCity: getCity,
    getVehicles: getVehicles,
    getVehicle: getVehicle,
    hasOverride: hasOverride,
    saveOverrides: saveOverrides,
    setActiveCity: setActiveCity,
    resetVehicleOverride: resetVehicleOverride,
    resetAllOverrides: resetAllOverrides,
    ensureFareSelection: ensureFareSelection,
    loadDataAndRender: loadDataAndRender,
    reloadDatasets: reloadDatasets,
    renderFatal: renderFatal,
    setDataSourcePill: setDataSourcePill,
    fillChrome: fillChrome,
    updateNav: updateNav,
    scopeLabel: scopeLabel,
    scopeTitle: scopeTitle,
    routeFromHash: routeFromHash,
    navigate: navigate,
    renderRoute: renderRoute,
  };
})();
