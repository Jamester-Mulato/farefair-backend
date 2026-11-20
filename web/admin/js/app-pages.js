/* FareFair Admin Console — page renderers, part 1.
 * Overview, Cities, Fare Matrix.
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

  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DISCOUNTS = {
    none: 'None',
    student: 'Student · 20%',
    senior: 'Senior · 20%',
    pwd: 'PWD · 20%',
  };

  function cityShort(city) {
    return city ? String(city.displayName || '').split(',')[0] : '—';
  }

  function discountLabel(type) {
    return DISCOUNTS[type] || 'None';
  }

  function tripStatusBadge(status) {
    const map = {
      completed: ['ok', 'Completed'],
      flagged: ['warn', 'Flagged'],
      disputed: ['danger', 'Disputed'],
    };
    const entry = map[status] || ['neutral', FF.titleCase(status)];
    return badge(entry[0], entry[1]);
  }

  function detailItem(label, value) {
    return '<div class="detail-item"><dt>' + esc(label) + '</dt><dd>' + value + '</dd></div>';
  }

  function cityOptions(selected, includeAll) {
    let html = includeAll ? '<option value="all"' + (selected === 'all' ? ' selected' : '') + '>All cities</option>' : '';
    FF.sortedCities().forEach(function (city) {
      html += '<option value="' + esc(city.id) + '"' + (city.id === selected ? ' selected' : '') + '>' +
        esc(city.displayName) + '</option>';
    });
    return html;
  }

  function vehicleOptions(selected, includeAll) {
    let html = includeAll ? '<option value="all"' + (selected === 'all' ? ' selected' : '') + '>All vehicles</option>' : '';
    Data.allVehicleIds(state.data.cities).forEach(function (id) {
      html += '<option value="' + esc(id) + '"' + (id === selected ? ' selected' : '') + '>' +
        esc(Data.vehicleMeta(id).name) + '</option>';
    });
    return html;
  }

  /* ------------------------------------------------------------------ */
  /* Trip analysis panel (server-side rules + optional narrative)        */
  /* ------------------------------------------------------------------ */

  const RISK_BADGE = {
    clear: ['ok', 'Clear'],
    watch: ['info', 'Watch'],
    review: ['warn', 'Review'],
    serious: ['danger', 'Serious'],
  };
  const SEVERITY_BADGE = { low: 'neutral', medium: 'warn', high: 'danger' };
  const ACTION_LABEL = {
    none: 'No action needed',
    monitor: 'Monitor this record',
    verify_record: 'Verify the record',
    escalate: 'Escalate for review',
  };

  function analysisNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return value == null ? '—' : String(value);
    }
    return Math.abs(value - Math.round(value)) < 0.005
      ? String(Math.round(value))
      : value.toFixed(2).replace(/0$/, '');
  }

  function analysisEngineChip(engine) {
    if (engine && engine.mode === 'llm') {
      const parts = ['Model', engine.model || 'provider'];
      if (engine.latencyMs) parts.push(engine.latencyMs + ' ms');
      return badge('info', parts.join(' · '));
    }
    return badge('neutral', 'Rules only');
  }

  function analysisFact(label, value) {
    if (value == null || value === '') return '';
    return '<div class="analysis-fact"><span>' + esc(label) + '</span><strong>' +
      esc(value) + '</strong></div>';
  }

  function analysisEvidence(evidence) {
    if (!Array.isArray(evidence) || !evidence.length) return '';
    const items = evidence.map(function (item) {
      if (!item || !item.path) return '';
      return '<span><code>' + esc(item.path) + '</code> ' +
        esc(analysisNumber(item.value)) + '</span>';
    }).filter(Boolean);
    if (!items.length) return '';
    return '<div class="analysis-evidence">' + items.join('') + '</div>';
  }

  function analysisPanel(analysis) {
    const verdict = analysis.verdict || {};
    const facts = analysis.facts || {};
    const fare = facts.fare || {};
    const gps = facts.gps || {};
    const tripFacts = facts.trip || {};
    const engine = analysis.engine || {};
    const findings = Array.isArray(analysis.findings) ? analysis.findings : [];
    const risk = RISK_BADGE[verdict.risk] || ['neutral', FF.titleCase(verdict.risk || 'unknown')];

    let html = '<div class="analysis" id="trip-analysis">' +
      '<div class="analysis-head">' +
        '<div class="analysis-head-main">' +
          '<p class="eyebrow">Trip analysis</p>' +
          '<div class="analysis-tags">' +
            badge(risk[0], risk[1] + ' risk') +
            badge('neutral', 'Confidence ' + Data.percent(verdict.confidence, 0)) +
            analysisEngineChip(engine) +
          '</div>' +
        '</div>' +
      '</div>' +
      '<p class="analysis-headline">' + esc(verdict.headline || 'No headline returned.') + '</p>' +
      (verdict.summary
        ? '<p class="analysis-summary">' + esc(verdict.summary) + '</p>'
        : '');

    const factsHtml = [
      analysisFact('Recorded amount', Data.peso(fare.estimate, 2)),
      analysisFact('Matrix band', Data.peso(fare.rangeMin, 2) + ' – ' + Data.peso(fare.rangeMax, 2)),
      analysisFact('Fare basis', fare.published
        ? 'Published row ' + (fare.routeRow == null ? '—' : fare.routeRow)
        : 'Distance engine'),
      analysisFact('Distance', Data.km(tripFacts.distanceKm)),
      analysisFact('Duration', tripFacts.durationMinutes == null
        ? ''
        : analysisNumber(tripFacts.durationMinutes) + ' min'),
      analysisFact('Breadcrumbs', analysisNumber(gps.points)),
      analysisFact('Largest gap', gps.maxGapMeters == null
        ? ''
        : analysisNumber(gps.maxGapMeters) + ' m'),
      analysisFact('Max speed', gps.maxSpeedKph == null
        ? ''
        : analysisNumber(gps.maxSpeedKph) + ' km/h'),
    ].join('');
    if (factsHtml) {
      html += '<div class="analysis-facts">' + factsHtml + '</div>';
    }

    if (findings.length) {
      html += '<p class="eyebrow analysis-subhead">Findings</p>' +
        '<div class="analysis-findings">';
      findings.forEach(function (row, index) {
        const tone = SEVERITY_BADGE[row.severity] || 'neutral';
        const label = row.informational ? 'Note' : FF.titleCase(row.severity || 'rule');
        html += '<div class="analysis-finding' + (row.informational ? ' is-note' : '') + '">' +
          '<div class="analysis-finding-head">' +
            '<span class="analysis-rank">' + (index + 1) + '</span>' +
            '<strong>' + esc(row.label || row.code) + '</strong>' +
            badge(tone, label) +
          '</div>' +
          '<p>' + esc(row.detail || '') + '</p>' +
          analysisEvidence(row.evidence) +
        '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class="analysis-note">' +
        notice('success', 'No rule fired: the amount sits inside the published band and the record is complete.') +
        '</div>';
    }

    if (Array.isArray(analysis.checks) && analysis.checks.length) {
      html += '<p class="eyebrow analysis-subhead">Checks</p>' +
        '<ul class="analysis-checks">' +
        analysis.checks.map(function (check) {
          return '<li>' + esc(check) + '</li>';
        }).join('') +
        '</ul>';
    }

    html += '<div class="analysis-action">' +
      '<div>' +
        '<p class="eyebrow">Recommended action</p>' +
        '<strong>' + esc(ACTION_LABEL[verdict.recommendedAction] ||
          FF.titleCase(verdict.recommendedAction || 'monitor')) + '</strong>' +
      '</div>' +
      '<div class="analysis-engine">' + analysisEngineChip(engine) + '</div>' +
    '</div>';

    if (engine.note) {
      html += '<p class="field-hint analysis-engine-note">' + esc(engine.note) + '</p>';
    }
    if (Array.isArray(analysis.basis) && analysis.basis.length) {
      html += '<p class="analysis-basis">' + esc(analysis.basis.join(' · ')) + '</p>';
    }
    html += '<p class="field-hint analysis-disclaimer">' +
      esc(analysis.disclaimer || 'Fare amounts come from the published matrix.') +
      (analysis.generatedAt
        ? ' Generated ' + esc(Data.formatDateTime(analysis.generatedAt)) + '.'
        : '') +
      '</p>';

    return html + '</div>';
  }

  function analysisState(kind, title, body, retry) {
    return '<div class="analysis" id="trip-analysis">' +
      '<p class="eyebrow">Trip analysis</p>' +
      notice(kind, '<strong>' + esc(title) + '</strong><br>' + esc(body)) +
      (retry ? '<button type="button" class="btn btn-outline btn-sm analysis-retry" data-analysis-retry>Try again</button>' : '') +
      '</div>';
  }

  function analysisLoading() {
    return '<div class="analysis" id="trip-analysis">' +
      '<p class="eyebrow">Trip analysis</p>' +
      '<p class="analysis-loading"><span class="spinner"></span> Running the fare rules…</p>' +
      '<p class="field-hint">The rule engine is authoritative. A configured provider may only re-word the narrative, and fares are never generated here.</p>' +
      '</div>';
  }

  function mountTripAnalysis(modal, trip) {
    const mount = modal.querySelector('[data-trip-analysis]');
    if (!mount) return;
    const load = function () {
      mount.innerHTML = analysisLoading();
      Data.loadTripAnalysis(trip.uuid || trip.id)
        .then(function (analysis) {
          if (!analysis) {
            mount.innerHTML = analysisState(
              'info',
              'Analysis unavailable offline',
              'The console could not reach the API. The trip record above is still complete.',
              true
            );
            bindAnalysisRetry(mount, load);
            return;
          }
          mount.innerHTML = analysisPanel(analysis);
        })
        .catch(function (error) {
          mount.innerHTML = analysisState(
            'danger',
            'Could not analyse this record',
            String((error && error.message) || error || 'Unknown error'),
            true
          );
          bindAnalysisRetry(mount, load);
        });
    };
    load();
  }

  function bindAnalysisRetry(mount, load) {
    const button = mount.querySelector('[data-analysis-retry]');
    if (button) button.addEventListener('click', load);
  }

  /* ------------------------------------------------------------------ */
  /* Trip modal (also used by the Trips page)                            */
  /* ------------------------------------------------------------------ */

  function openTripModal(tripId) {
    const trip = state.trips.filter(function (item) { return item.id === tripId; })[0];
    if (!trip) return;
    const body =
      '<div class="row" style="margin-bottom:14px">' + tripStatusBadge(trip.status) +
        '<span class="muted" style="font-size:.75rem">' + esc(trip.recordedVia) + '</span>' +
      '</div>' +
      (trip.flagReason ? notice('warn', esc(trip.flagReason)) + '<div style="height:12px"></div>' : '') +
      '<dl class="detail-grid">' +
        detailItem('Date & time', esc(Data.formatDateTime(trip.timestamp))) +
        detailItem('City', esc(trip.cityName)) +
        detailItem('Vehicle', esc(trip.vehicleName)) +
        detailItem('Distance', esc(Data.km(trip.distanceKm))) +
        detailItem('Duration', esc(trip.durationMin + ' min')) +
        detailItem('Passengers', esc(String(trip.passengers)) + (trip.pakyaw ? ' · pakyaw' : '')) +
        detailItem('Discount', esc(discountLabel(trip.discountType))) +
        detailItem('Estimate', '<strong>' + esc(Data.peso(trip.estimate, 2)) + '</strong>') +
        detailItem('Customary range', esc(Data.peso(trip.fareMin, 2) + ' – ' + Data.peso(trip.fareMax, 2))) +
        detailItem('Recorded via', esc(trip.recordedVia)) +
      '</dl>' +
      '<hr class="divider">' +
      '<p class="eyebrow">Route</p>' +
      '<p style="margin-top:6px;font-size:.9rem;color:var(--ink)">' +
        esc(trip.origin) + ' <span class="muted">→</span> ' + esc(trip.destination) +
      '</p>' +
      (trip.discountType !== 'none'
        ? '<p class="field-hint" style="margin-top:10px">A statutory 20% discount was applied to this estimate.</p>'
        : '') +
      '<div data-trip-analysis></div>';
    FF.openModal({
      eyebrow: 'Trip record',
      title: trip.id,
      body: body,
      footer: '<button type="button" class="btn btn-outline" data-modal-close>Close</button>',
      onMount: function (modal) {
        mountTripAnalysis(modal, trip);
      },
    });
  }

  FF.openTripModal = openTripModal;
  FF.discountLabel = discountLabel;
  FF.tripStatusBadge = tripStatusBadge;
  FF.cityShort = cityShort;
  FF.cityOptions = cityOptions;
  FF.vehicleOptions = vehicleOptions;

  /* ------------------------------------------------------------------ */
  /* Overview                                                            */
  /* ------------------------------------------------------------------ */

  function tripDays(trips) {
    const days = [];
    const today = Data.startOfDay(new Date());
    for (let i = 6; i >= 0; i -= 1) {
      const date = Data.addDays(today, -i);
      days.push({ date: date, key: Data.dateKey(date), count: 0 });
    }
    const index = {};
    days.forEach(function (day) { index[day.key] = day; });
    trips.forEach(function (trip) {
      const day = index[Data.dateKey(trip.timestamp)];
      if (day) day.count += 1;
    });
    return days;
  }

  function smoothPath(points) {
    if (!points.length) return '';
    if (points.length === 1) return 'M' + points[0].x.toFixed(1) + ' ' + points[0].y.toFixed(1);
    let path = 'M' + points[0].x.toFixed(1) + ' ' + points[0].y.toFixed(1);
    for (let i = 0; i < points.length - 1; i += 1) {
      const prev = points[i - 1] || points[i];
      const current = points[i];
      const next = points[i + 1];
      const after = points[i + 2] || next;
      const tension = 0.16;
      const c1x = current.x + (next.x - prev.x) * tension;
      const c1y = current.y + (next.y - prev.y) * tension;
      const c2x = next.x - (after.x - current.x) * tension;
      const c2y = next.y - (after.y - current.y) * tension;
      path += ' C' + c1x.toFixed(1) + ' ' + c1y.toFixed(1) + ', ' +
        c2x.toFixed(1) + ' ' + c2y.toFixed(1) + ', ' +
        next.x.toFixed(1) + ' ' + next.y.toFixed(1);
    }
    return path;
  }

  function tripChartSvg(trips) {
    const days = tripDays(trips);

    const peak = Math.max.apply(null, days.map(function (day) { return day.count; }).concat([1]));
    const step = Math.max(1, Math.ceil(peak / 4));
    const yMax = step * 4;
    const W = 700;
    const H = 208;
    const L = 34;
    const R = 22;
    const T = 12;
    const B = 28;
    const innerW = W - L - R;
    const innerH = H - T - B;
    const baseline = T + innerH;

    const points = days.map(function (day, i) {
      return {
        x: L + (days.length === 1 ? innerW / 2 : (i / (days.length - 1)) * innerW),
        y: T + innerH * (1 - day.count / yMax),
        count: day.count,
        day: day,
      };
    });

    const line = smoothPath(points);
    const area = line +
      ' L' + points[points.length - 1].x.toFixed(1) + ' ' + baseline +
      ' L' + points[0].x.toFixed(1) + ' ' + baseline + ' Z';

    let grid = '';
    for (let i = 0; i <= 4; i += 1) {
      const value = step * i;
      const y = T + innerH * (1 - value / yMax);
      grid += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '"' +
        ' stroke="#E4EBF3" stroke-width="1"' + (i === 0 ? '' : ' stroke-dasharray="2 6"') + '/>';
      grid += '<text x="' + (L - 8) + '" y="' + (y + 3).toFixed(1) + '" text-anchor="end" fill="#8A9690" font-size="9.5" font-family="Segoe UI, system-ui, sans-serif">' + value + '</text>';
    }

    let labels = '';
    let hits = '';
    points.forEach(function (point) {
      const isLast = point === points[points.length - 1];
      labels += '<text x="' + point.x.toFixed(1) + '" y="' + (H - 6) + '" text-anchor="middle" fill="' +
        (isLast ? '#3C4A43' : '#8A9690') + '" font-size="9.5" font-weight="' + (isLast ? '600' : '400') + '"' +
        ' font-family="Segoe UI, system-ui, sans-serif">' +
        DAY_NAMES[point.day.date.getDay()] + ' ' + point.day.date.getDate() + '</text>';
      hits += '<g class="chart-hit">' +
        '<title>' + point.count + ' trip' + (point.count === 1 ? '' : 's') + ' on ' + Data.formatDate(point.day.date) + '</title>' +
        '<line class="chart-guide" x1="' + point.x.toFixed(1) + '" y1="' + T + '" x2="' + point.x.toFixed(1) + '" y2="' + baseline + '"/>' +
        '<rect x="' + (point.x - 16).toFixed(1) + '" y="' + T + '" width="32" height="' + innerH + '" fill="transparent"/>' +
        '<circle class="chart-dot" cx="' + point.x.toFixed(1) + '" cy="' + point.y.toFixed(1) + '" r="3.6" fill="#fff" stroke="#23422A" stroke-width="2.2"/>' +
      '</g>';
    });

    const total = days.reduce(function (sum, day) { return sum + day.count; }, 0);

    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Trip estimates per day over the last seven days">' +
      '<desc>' + total + ' trips recorded across the seven-day window.</desc>' +
      '<defs><linearGradient id="tripArea" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#6FA276" stop-opacity=".34"/>' +
        '<stop offset="62%" stop-color="#ABD0AF" stop-opacity=".14"/>' +
        '<stop offset="100%" stop-color="#ABD0AF" stop-opacity="0"/>' +
      '</linearGradient></defs>' +
      grid +
      '<path d="' + area + '" fill="url(#tripArea)"/>' +
      '<path d="' + line + '" fill="none" stroke="#23422A" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      hits + labels +
    '</svg>';
  }

  function renderOverview() {
    const user = state.user;
    const active = FF.getCity(FF.activeCityId());
    const cities = FF.sortedCities();
    const provisional = cities.filter(function (city) {
      return city.provenance && city.provenance.provisional;
    }).length;
    const activeVehicles = cities.reduce(function (sum, city) {
      return sum + FF.getVehicles(city.id).filter(function (vehicle) { return vehicle.active !== false; }).length;
    }, 0);
    const classes = Data.allVehicleIds(state.data.cities).length;
    const routeCount = active && Array.isArray(active.fareRoutes) ? active.fareRoutes.length : 0;
    const trips = state.trips;
    const avg = trips.length
      ? trips.reduce(function (sum, trip) { return sum + Number(trip.estimate || 0); }, 0) / trips.length
      : 0;
    const flagged = trips.filter(function (trip) { return trip.status !== 'completed'; }).length;
    const days = tripDays(trips);
    const peakDay = days.reduce(function (best, day) { return day.count > best.count ? day : best; }, days[0]);

    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const firstName = user.name.split(' ')[0];
    const activeName = active ? cityShort(active) : '—';

    const vehicles = active
      ? FF.getVehicles(active.id).slice().sort(function (a, b) { return Number(b.baseFare) - Number(a.baseFare); })
      : [];
    const maxBase = Math.max.apply(null, vehicles.map(function (vehicle) { return Number(vehicle.baseFare) || 0; }).concat([1]));
    const bars = vehicles.map(function (vehicle) {
      const width = Math.max(4, Math.round((Number(vehicle.baseFare) || 0) / maxBase * 100));
      return '<div class="bar-row">' +
        '<span class="bar-label" title="' + esc(Data.vehicleMeta(vehicle.vehicleId).name) + '">' + esc(Data.vehicleMeta(vehicle.vehicleId).name) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="width:' + width + '%"></span></span>' +
        '<span class="bar-value">' + esc(Data.peso(vehicle.baseFare)) + '</span>' +
      '</div>';
    }).join('');

    const snapshot = vehicles[0];
    const fareMeta = snapshot
      ? '<div class="fare-mini">' +
          '<div><span>Base fare</span><strong>' + esc(Data.peso(snapshot.baseFare)) + '</strong></div>' +
          '<div><span>Per kilometre</span><strong>' + esc(Data.peso(snapshot.perKmRate)) + '</strong></div>' +
          '<div><span>Minimum</span><strong>' + esc(Data.peso(snapshot.minFare)) + '</strong></div>' +
          '<div><span>Customary cap</span><strong>' + esc(Data.peso(snapshot.maxCustomary)) + '</strong></div>' +
        '</div>'
      : '';

    const matrix = active && active.fareMatrix ? active.fareMatrix : null;
    const ordCount = active && Array.isArray(active.ordinances) ? active.ordinances.length : 0;
    const verifiedAt = active && active.provenance ? active.provenance.lastVerified : null;
    const readinessItems = [
      {
        ok: !!(matrix && matrix.entries && matrix.entries.length),
        title: 'Official fare matrix',
        copy: matrix
          ? (matrix.entries ? matrix.entries.length : 0) + ' vehicle tariff' + ((matrix.entries && matrix.entries.length === 1) ? '' : 's') +
            (matrix.effectiveFrom ? ' · effective ' + Data.formatDate(matrix.effectiveFrom) : '')
          : 'No published matrix for this city yet',
      },
      {
        ok: ordCount > 0,
        title: 'Enacted ordinance',
        copy: ordCount > 0
          ? ordCount + ' record' + (ordCount === 1 ? '' : 's') + ' on file · legal basis linked'
          : 'Awaiting an LGU ordinance',
      },
      {
        ok: !!verifiedAt,
        title: 'Provenance verified',
        copy: verifiedAt
          ? 'Last checked ' + Data.formatDate(verifiedAt) + ' against the LGU source'
          : 'Pending LGU verification',
      },
    ];
    const readiness = '<div class="readiness-list">' + readinessItems.map(function (item) {
      return '<div class="readiness-item' + (item.ok ? '' : ' pending') + '">' +
        '<span class="readiness-mark">' + icon(item.ok ? 'check' : 'alert') + '</span>' +
        '<div><strong>' + esc(item.title) + '</strong><span>' + esc(item.copy) + '</span></div>' +
      '</div>';
    }).join('') + '</div>';

    let recentRows = '';
    trips.slice(0, 6).forEach(function (trip) {
      recentRows += '<tr>' +
        '<td><div class="primary-cell"><strong>' + esc(trip.id) + '</strong><span>' + esc(Data.formatTime(trip.timestamp)) + '</span></div></td>' +
        '<td class="cell-span" data-label="Route"><div class="primary-cell"><strong>' + esc(trip.origin) + ' → ' + esc(trip.destination) + '</strong><span>' + esc(cityShort({ displayName: trip.cityName })) + ' · ' + esc(Data.km(trip.distanceKm)) + '</span></div></td>' +
        '<td data-label="Vehicle">' + esc(trip.vehicleName) + '</td>' +
        '<td class="num" data-label="Estimate">' + esc(Data.peso(trip.estimate, 2)) + '</td>' +
        '<td data-label="Status">' + tripStatusBadge(trip.status) + '</td>' +
        '<td class="actions-col"><button type="button" class="btn btn-outline btn-sm" data-trip-view="' + esc(trip.id) + '">View</button></td>' +
      '</tr>';
    });

    let cityRows = '';
    cities.forEach(function (city) {
      const cityVehicles = FF.getVehicles(city.id);
      const activeCount = cityVehicles.filter(function (vehicle) { return vehicle.active !== false; }).length;
      const isLive = city.id === FF.activeCityId();
      const dot = isLive ? 'ok' : 'warn';
      cityRows += '<div class="city-row">' +
        '<span class="status-dot ' + dot + '"></span>' +
        '<div class="city-row-main"><strong>' + esc(cityShort(city)) + '</strong><span>' +
          activeCount + '/' + cityVehicles.length + ' vehicles · ' + esc(city.region || city.province || '') +
        '</span></div>' +
        (isLive ? badge('ok', 'Live') : badge('warn', 'Candidate')) +
      '</div>';
    });

    const readinessOk = readinessItems.filter(function (item) { return item.ok; }).length;
    const readinessPct = Math.round((readinessOk / Math.max(1, readinessItems.length)) * 100);
    const bandPct = trips.length
      ? Math.round((Math.max(0, trips.length - flagged) / trips.length) * 100)
      : 100;
    const ring = function (pct, cls) {
      const circumference = 2 * Math.PI * 52;
      const filled = (Math.max(0, Math.min(100, pct)) / 100) * circumference;
      return '<svg class="ov-ring ' + cls + '" viewBox="0 0 120 120" aria-hidden="true">' +
        '<circle class="ov-ring-track" cx="60" cy="60" r="52"/>' +
        '<circle class="ov-ring-fill" cx="60" cy="60" r="52" ' +
          'stroke-dasharray="' + filled.toFixed(1) + ' ' + circumference.toFixed(1) + '"/></svg>';
    };

    let recentCards = '';
    trips.slice(0, 6).forEach(function (trip) {
      recentCards += '<div class="ov-trip">' +
        '<div class="ov-trip-time"><strong>' + esc(Data.formatTime(trip.timestamp)) + '</strong>' +
          '<span>' + esc(Data.km(trip.distanceKm)) + '</span></div>' +
        '<div class="ov-trip-main"><strong>' + esc(trip.origin) + ' → ' + esc(trip.destination) + '</strong>' +
          '<span>' + esc(trip.vehicleName) + ' · ' + esc(cityShort({ displayName: trip.cityName })) + '</span></div>' +
        '<div class="ov-trip-fare">' + esc(Data.peso(trip.estimate, 2)) + '</div>' +
        '<div class="ov-trip-state">' + tripStatusBadge(trip.status) + '</div>' +
        '<button type="button" class="ov-trip-btn" data-trip-view="' + esc(trip.id) + '">View</button>' +
      '</div>';
    });

    const html =
      '<section class="ov-hero">' +
        '<div class="ov-hero-top">' +
          '<div class="ov-hero-copy">' +
            '<span class="ov-eyebrow">' + esc(activeName) + ' · fare oversight</span>' +
            '<h2>' + greeting + ', ' + esc(firstName) + '</h2>' +
            '<p>' + routeCount + ' official routes · ' + trips.length + ' trips recorded · ' +
              (flagged ? flagged + ' awaiting review' : 'all within the customary band') + '</p>' +
          '</div>' +
          '<div class="ov-hero-actions">' +
            '<button type="button" class="ov-btn ov-btn-ghost" id="overview-routes">' + icon('route') + routeCount + ' fare routes</button>' +
            '<button type="button" class="ov-btn ov-btn-solid" id="overview-trips">' + icon('route') + ' Trip records</button>' +
          '</div>' +
        '</div>' +
        '<div class="ov-hero-chart">' + tripChartSvg(trips) + '</div>' +
        '<div class="ov-hero-foot">' +
          '<span><i class="ov-dot"></i> Recorded trips</span>' +
          '<span>Peak <strong>' + peakDay.count + '</strong> · ' + DAY_NAMES[peakDay.date.getDay()] + ' ' + peakDay.date.getDate() + '</span>' +
          '<span class="ov-foot-flag' + (flagged ? '' : ' clear') + '">' + icon(flagged ? 'alert' : 'check') +
            (flagged ? flagged + ' need review' : 'All within range') + '</span>' +
        '</div>' +
      '</section>' +

      '<div class="ov-strip">' +
        '<div class="ov-stat"><span>City dataset</span><strong>' + cities.length + '</strong><small>' + esc(activeName) + '</small></div>' +
        '<div class="ov-stat"><span>Fare routes</span><strong>' + routeCount + '</strong><small>published</small></div>' +
        '<div class="ov-stat"><span>Vehicles</span><strong>' + activeVehicles + '</strong><small>' + classes + ' class' + (classes === 1 ? '' : 'es') + '</small></div>' +
        '<div class="ov-stat"><span>Trips</span><strong>' + trips.length + '</strong><small>avg ' + esc(Data.peso(avg, 2)) + '</small></div>' +
      '</div>' +

      '<div class="ov-bento">' +
        '<section class="ov-card ov-span-5">' +
          '<header class="ov-card-head"><div><span class="ov-label">Fare snapshot</span>' +
            '<h3>' + esc(activeName) + '</h3></div>' +
            '<span class="pill pill-quiet">' + vehicles.length + ' vehicle' + (vehicles.length === 1 ? '' : 's') + '</span></header>' +
          '<div class="ov-fare-body">' +
            (vehicles.length
              ? '<div class="ov-bars">' + bars + '</div>' + fareMeta
              : '<p class="ov-muted">No vehicles configured for this city.</p>') +
            '<div class="ov-meter">' +
              '<div class="ov-meter-track"><span style="width:' + bandPct + '%"></span></div>' +
              '<div class="ov-meter-copy"><strong>' + bandPct + '%</strong> of recorded trips sit inside the customary band</div>' +
            '</div>' +
          '</div>' +
          '<footer class="ov-card-foot"><button type="button" class="btn btn-outline btn-sm" id="overview-fares">Open fare matrix</button>' +
            '<span class="ov-muted">Per-km rates and caps live in the editor.</span></footer>' +
        '</section>' +

        '<section class="ov-card ov-span-4">' +
          '<header class="ov-card-head"><div><span class="ov-label">Readiness</span><h3>Ordinance chain</h3></div>' +
            (provisional ? badge('warn', provisional + ' provisional') : badge('ok', 'All verified')) + '</header>' +
          '<div class="ov-gauge">' + ring(readinessPct, 'ov-ring-sage') +
            '<div class="ov-gauge-copy"><strong>' + readinessPct + '%</strong><span>' + readinessOk + ' of ' + readinessItems.length + ' checks</span></div>' +
          '</div>' +
          '<div class="ov-checks">' + readiness + '</div>' +
        '</section>' +

        '<section class="ov-card ov-span-3 ov-review">' +
          '<span class="ov-label">Review queue</span>' +
          '<div class="ov-review-number">' + flagged + '</div>' +
          '<p class="ov-muted">' + (flagged ? 'trips sit outside the customary band and need a second look.' : 'Nothing waiting. Every recorded fare sits inside the band.') + '</p>' +
          '<button type="button" class="btn btn-primary btn-sm" id="overview-all-trips">' + (flagged ? 'Open trip records' : 'Browse trips') + '</button>' +
          '<div class="ov-split">' +
            '<div><span>Inside band</span><strong>' + Math.max(0, trips.length - flagged) + '</strong></div>' +
            '<div><span>Flagged</span><strong>' + flagged + '</strong></div>' +
            '<div><span>Avg fare</span><strong>' + esc(Data.peso(avg, 2)) + '</strong></div>' +
          '</div>' +
        '</section>' +

        '<section class="ov-card ov-span-8">' +
          '<header class="ov-card-head"><div><span class="ov-label">Latest activity</span><h3>Recent trip records</h3></div>' +
            '<button type="button" class="btn btn-ghost btn-sm" id="overview-see-all">View all</button></header>' +
          (recentCards ? '<div class="ov-trips">' + recentCards + '</div>'
            : FF.emptyState('route', 'No trips recorded yet', 'Trip estimates will appear here once passengers record fares.')) +
        '</section>' +

        '<section class="ov-card ov-span-4">' +
          '<header class="ov-card-head"><div><span class="ov-label">Coverage</span><h3>City datasets</h3></div>' +
            '<span class="pill pill-live pill-dot">Live</span></header>' +
          '<div class="card-body ov-cities">' + cityRows + '</div>' +
          '<footer class="ov-card-foot"><button type="button" class="btn btn-ghost btn-sm" id="overview-cities">Open city datasets</button></footer>' +
        '</section>' +
      '</div>';

    FF.dom.page.innerHTML = html;

    const routesButton = FF.byId('overview-routes');
    if (routesButton) routesButton.addEventListener('click', function () { FF.navigate('routes'); });
    const tripsButton = FF.byId('overview-trips');
    if (tripsButton) tripsButton.addEventListener('click', function () { FF.navigate('trips'); });
    const allTrips = FF.byId('overview-all-trips');
    if (allTrips) allTrips.addEventListener('click', function () { FF.navigate('trips'); });
    const seeAll = FF.byId('overview-see-all');
    if (seeAll) seeAll.addEventListener('click', function () { FF.navigate('trips'); });
    const cityButton = FF.byId('overview-cities');
    if (cityButton) cityButton.addEventListener('click', function () { FF.navigate('cities'); });
    const faresButton = FF.byId('overview-fares');
    if (faresButton) faresButton.addEventListener('click', function () {
      FF.ensureFareSelection();
      FF.navigate('fares');
    });
    FF.qsa('[data-trip-view]', FF.dom.page).forEach(function (button) {
      button.addEventListener('click', function () { openTripModal(button.getAttribute('data-trip-view')); });
    });
  }

  pages.overview = renderOverview;

  /* ------------------------------------------------------------------ */
  /* Cities                                                              */
  /* ------------------------------------------------------------------ */

  function filteredCities() {
    const needle = ui.cityQuery.trim().toLowerCase();
    const activeId = FF.activeCityId();
    return FF.sortedCities().filter(function (city) {
      if (needle) {
        const haystack = [city.displayName, city.province, city.region, city.id].join(' ').toLowerCase();
        if (haystack.indexOf(needle) === -1) return false;
      }
      const isActive = city.id === activeId;
      if (ui.cityStatus === 'active') return isActive;
      if (ui.cityStatus === 'candidate') return !isActive;
      if (ui.cityStatus === 'provisional') return Boolean(city.provenance && city.provenance.provisional);
      return true;
    });
  }

  function accessTag(cityId) {
    const user = state.user;
    if (!user) return '';
    if (user.role === 'analyst') return '<span class="muted" style="font-size:.7rem">Read-only</span>';
    if (user.role === 'super_admin') return '<span class="muted" style="font-size:.7rem">Full access</span>';
    return Auth.inScope(user, cityId) ? badge('info', 'In scope') : badge('neutral', 'Outside scope');
  }

  function openCityModal(cityId) {
    const city = FF.getCity(cityId);
    if (!city) return;
    const vehicles = city.vehicles || [];
    const activeCount = vehicles.filter(function (vehicle) { return vehicle.active !== false; }).length;
    const policy = city.farePolicy || {};
    const provenance = city.provenance || {};
    const isLive = city.id === FF.activeCityId();
    const canActivate = Auth.can(state.user, 'city.activate') && !isLive;

    const vehicleRows = vehicles.map(function (vehicle) {
      return '<tr><td>' + esc(Data.vehicleMeta(vehicle.vehicleId).name) + '</td>' +
        '<td class="num">' + esc(Data.peso(vehicle.baseFare, 2)) + '</td>' +
        '<td class="num">' + esc(Data.km(vehicle.baseDistanceKm)) + '</td>' +
        '<td class="num">' + esc(Data.peso(vehicle.perKmRate, 2)) + '</td>' +
        '<td>' + (vehicle.active !== false ? badge('ok', 'Active') : badge('neutral', 'Inactive')) + '</td></tr>';
    }).join('');

    const body =
      (provenance.provisional
        ? notice('warn', '<strong>Provisional dataset.</strong> ' + esc(provenance.source || 'Awaiting official LGU fare ordinance.'))
        : notice('success', esc(provenance.source || 'Verified LGU dataset.'))) +
      '<div style="height:14px"></div>' +
      '<dl class="detail-grid">' +
        detailItem('Dataset ID', '<span class="mono">' + esc(city.id) + '</span>') +
        detailItem('Province', esc(city.province || '—')) +
        detailItem('Region', esc(city.region || '—')) +
        detailItem('Last verified', esc(provenance.lastVerified ? Data.formatDate(provenance.lastVerified) : 'Not verified')) +
        detailItem('Centre', esc(Number(city.center && city.center.lat).toFixed(4) + ', ' + Number(city.center && city.center.lng).toFixed(4))) +
        detailItem('Centro label', esc(city.centroLabel || '—')) +
      '</dl>' +
      '<hr class="divider">' +
      '<p class="eyebrow">Fare policy</p>' +
      '<dl class="detail-grid" style="margin-top:10px">' +
        detailItem('Statutory discount', esc(Data.percent(policy.discountRate, 0))) +
        detailItem('Customary band', esc(Data.percent(policy.customaryLeewayMin, 0) + ' – ' + Data.percent(policy.customaryLeewayMax, 0))) +
        detailItem('Passenger range', esc((policy.minPassengers || 1) + ' – ' + (policy.maxPassengers || 6))) +
        detailItem('Pakyaw seat cap', esc(String(policy.pakyawSeatCap || '—'))) +
      '</dl>' +
      '<hr class="divider">' +
      '<p class="eyebrow">Vehicles · ' + activeCount + ' of ' + vehicles.length + ' active</p>' +
      '<div style="border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:10px">' +
        '<div class="table-wrap"><table class="data-table"><thead><tr>' +
          '<th>Vehicle</th><th class="num">Base</th><th class="num">Covered</th><th class="num">Per km</th><th>Status</th>' +
        '</tr></thead><tbody>' + vehicleRows + '</tbody></table></div>' +
      '</div>';

    const footer =
      '<button type="button" class="btn btn-outline" data-modal-close>Close</button>' +
      (Auth.can(state.user, 'fare.edit', city.id)
        ? '<button type="button" class="btn btn-outline" id="city-edit-fares">' + icon('edit') + ' Edit fares</button>'
        : '') +
      (canActivate ? '<button type="button" class="btn btn-primary" id="city-set-live">Make live dataset</button>' : '') +
      (isLive ? '<span class="badge badge-ok" style="align-self:center">Live dataset</span>' : '');

    FF.openModal({
      eyebrow: 'City dataset',
      title: city.displayName,
      body: body,
      footer: footer,
      onMount: function (modal) {
        const edit = modal.querySelector('#city-edit-fares');
        if (edit) edit.addEventListener('click', function () {
          ui.fareCityId = city.id;
          ui.fareVehicleId = '';
          ui.fareDraft = null;
          ui.fareDraftKey = '';
          FF.closeModal();
          FF.navigate('fares');
        });
        const live = modal.querySelector('#city-set-live');
        if (live) live.addEventListener('click', function () {
          FF.closeModal();
          FF.setActiveCity(city.id).then(function (ok) { if (ok) FF.renderRoute(); });
        });
      },
    });
  }

  function refreshCitiesResults() {
    const results = FF.byId('cities-results');
    const count = FF.byId('cities-count');
    if (!results) return;
    const list = filteredCities();
    const total = Object.keys(state.data.cities).length;
    if (count) count.textContent = list.length + ' of ' + total + ' datasets';

    if (!list.length) {
      results.innerHTML = '<div class="card">' +
        FF.emptyState('search', 'No datasets match', 'Try a different city, province or status filter.') + '</div>';
      return;
    }

    let rows = '';
    list.forEach(function (city) {
      const vehicles = FF.getVehicles(city.id);
      const activeCount = vehicles.filter(function (vehicle) { return vehicle.active !== false; }).length;
      const isLive = city.id === FF.activeCityId();
      const provisional = city.provenance && city.provenance.provisional;
      rows += '<tr>' +
        '<td><div class="primary-cell"><strong>' + esc(city.displayName) + '</strong><span>' +
          esc(city.province || '') + (provisional ? ' · provisional' : '') + '</span></div></td>' +
        '<td data-label="Region">' + esc(city.region || '—') + '</td>' +
        '<td data-label="Access">' + accessTag(city.id) + '</td>' +
        '<td data-label="Status">' + (isLive ? badge('ok', 'Active') : badge('warn', 'Candidate')) + '</td>' +
        '<td class="num" data-label="Vehicles">' + activeCount + '/' + vehicles.length + '</td>' +
        '<td class="num" data-label="Ordinances">' + ((city.ordinances || []).length) + '</td>' +
        '<td data-label="Last verified">' + esc(city.provenance && city.provenance.lastVerified ? Data.formatDate(city.provenance.lastVerified) : 'Not verified') + '</td>' +
        '<td class="actions-col"><div class="table-actions">' +
          '<button type="button" class="btn btn-outline btn-sm" data-city-view="' + esc(city.id) + '">View</button>' +
          (Auth.can(state.user, 'city.activate') && !isLive
            ? '<button type="button" class="btn btn-ghost btn-sm" data-city-live="' + esc(city.id) + '">Set live</button>'
            : '') +
        '</div></td>' +
      '</tr>';
    });

    results.innerHTML = '<div class="card"><div class="table-wrap"><table class="data-table table-stack"><thead><tr>' +
      '<th>City</th><th>Region</th><th>Access</th><th>Status</th><th class="num">Vehicles</th>' +
      '<th class="num">Ordinances</th><th>Last verified</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    FF.qsa('[data-city-view]', results).forEach(function (button) {
      button.addEventListener('click', function () { openCityModal(button.getAttribute('data-city-view')); });
    });
    FF.qsa('[data-city-live]', results).forEach(function (button) {
      button.addEventListener('click', function () {
        FF.setActiveCity(button.getAttribute('data-city-live'))
          .then(function (ok) { if (ok) FF.renderRoute(); });
      });
    });
  }

  function renderCities() {
    const cities = FF.sortedCities();
    const provisional = cities.filter(function (city) { return city.provenance && city.provenance.provisional; }).length;
    const activeVehicles = cities.reduce(function (sum, city) {
      return sum + FF.getVehicles(city.id).filter(function (vehicle) { return vehicle.active !== false; }).length;
    }, 0);
    const active = FF.getCity(FF.activeCityId());
    const canReview = Auth.can(state.user, 'city.view');

    FF.dom.page.innerHTML =
      FF.pageHead(
        'Dataset directory',
        'The Cabadbaran City dataset read from PostgreSQL. Open it to inspect policy, vehicles and provenance.',
        provisional && canReview
          ? '<button type="button" class="btn btn-outline" id="cities-provisional">' + icon('alert') + ' Review provisional</button>'
          : ''
      ) +
      FF.statStrip([
        { label: 'Datasets', value: String(cities.length) },
        { label: 'Live dataset', value: esc(active ? cityShort(active) : '—') },
        { label: 'Fare routes', value: String(active && active.fareRoutes ? active.fareRoutes.length : 0) },
        { label: 'Active vehicles', value: String(activeVehicles) },
      ]) +
      '<div class="toolbar">' +
        '<div class="search">' + icon('search') +
          '<input type="search" id="city-search" placeholder="Search city, province or region" value="' + esc(ui.cityQuery) + '" aria-label="Search city datasets">' +
        '</div>' +
        '<select class="select" id="city-status" aria-label="Filter by status">' +
          '<option value="all"' + (ui.cityStatus === 'all' ? ' selected' : '') + '>All statuses</option>' +
          '<option value="active"' + (ui.cityStatus === 'active' ? ' selected' : '') + '>Active dataset</option>' +
          '<option value="candidate"' + (ui.cityStatus === 'candidate' ? ' selected' : '') + '>Candidates</option>' +
          '<option value="provisional"' + (ui.cityStatus === 'provisional' ? ' selected' : '') + '>Provisional</option>' +
        '</select>' +
        '<span class="spacer"></span>' +
        '<span class="muted" id="cities-count" style="font-size:.73rem"></span>' +
      '</div>' +
      '<div id="cities-results"></div>';

    const search = FF.byId('city-search');
    search.addEventListener('input', function () {
      ui.cityQuery = search.value;
      refreshCitiesResults();
    });
    const status = FF.byId('city-status');
    status.addEventListener('change', function () {
      ui.cityStatus = status.value;
      refreshCitiesResults();
    });
    const provisionalButton = FF.byId('cities-provisional');
    if (provisionalButton) provisionalButton.addEventListener('click', function () {
      ui.cityStatus = 'provisional';
      status.value = 'provisional';
      refreshCitiesResults();
    });
    refreshCitiesResults();
  }

  pages.cities = renderCities;

  /* ------------------------------------------------------------------ */
  /* Fare Matrix                                                         */
  /* ------------------------------------------------------------------ */

  function ensureDraft(cityId, vehicleId) {
    const key = cityId + '::' + vehicleId;
    if (ui.fareDraftKey !== key || !ui.fareDraft) {
      const vehicle = FF.getVehicle(cityId, vehicleId);
      if (!vehicle) return null;
      ui.fareDraftKey = key;
      ui.fareDraft = {
        baseFare: String(vehicle.baseFare),
        baseDistanceKm: String(vehicle.baseDistanceKm),
        perKmRate: String(vehicle.perKmRate),
        minFare: String(vehicle.minFare),
        maxCustomary: String(vehicle.maxCustomary),
        typicalCapacity: String(vehicle.typicalCapacity),
        active: vehicle.active !== false,
      };
    }
    return ui.fareDraft;
  }

  function fareDirty() {
    const vehicle = FF.getVehicle(ui.fareCityId, ui.fareVehicleId);
    const draft = ui.fareDraft;
    if (!vehicle || !draft) return false;
    const numeric = ['baseFare', 'baseDistanceKm', 'perKmRate', 'minFare', 'maxCustomary', 'typicalCapacity'];
    const changed = numeric.some(function (key) { return Number(draft[key]) !== Number(vehicle[key]); });
    return changed || Boolean(draft.active) !== (vehicle.active !== false);
  }

  function showFareError(message) {
    const box = FF.byId('fare-error');
    if (!box) return;
    if (!message) {
      box.hidden = true;
      box.textContent = '';
      return;
    }
    box.hidden = false;
    box.textContent = message;
  }

  function updatePreview() {
    const draft = ui.fareDraft;
    if (!draft) return;
    const base = Number(draft.baseFare);
    const perKm = Number(draft.perKmRate);
    const covered = Number(draft.baseDistanceKm);
    const minimum = Number(draft.minFare);
    const cap = Number(draft.maxCustomary);
    const set = function (id, text) {
      const node = FF.byId(id);
      if (node) node.textContent = text;
    };
    if ([base, perKm, covered, minimum].every(Number.isFinite)) {
      set('preview-fare', Data.peso(Math.max(minimum, base + Math.max(0, 3 - covered) * perKm), 2));
    } else {
      set('preview-fare', '₱—');
    }
    set('preview-covered', Number.isFinite(covered) ? Data.km(covered) : '—');
    set('preview-rate', Number.isFinite(perKm) ? Data.peso(perKm, 2) + '/km' : '—');
    set('preview-min', Number.isFinite(minimum) ? Data.peso(minimum, 2) : '—');
    set('preview-cap', Number.isFinite(cap) ? Data.peso(cap, 2) : '—');
  }

  function syncFareControls(cityId, canEdit) {
    const save = FF.byId('fare-save');
    const reset = FF.byId('fare-reset');
    const dirty = fareDirty();
    if (save) save.disabled = !canEdit || !dirty;
    if (reset) reset.disabled = !canEdit || (!FF.hasOverride(cityId, ui.fareVehicleId) && !dirty);
    updatePreview();
  }

  function fareContext(city, canEdit) {
    const parts = [canEdit ? badge('ok', 'Editing enabled') : badge('neutral', 'Read-only')];
    if (state.user.role === 'city_admin' && !Auth.inScope(state.user, city.id)) parts.push(badge('warn', 'Outside scope'));
    if (city.provenance && city.provenance.provisional) parts.push(badge('warn', 'Provisional'));
    return parts.join(' ');
  }

  function fareField(label, key, unit, step, draft, disabled) {
    return '<div class="input-group">' +
      '<label for="fare-' + key + '">' + esc(label) + '</label>' +
      '<input class="input num" id="fare-' + key + '" data-fare-field="' + key + '" type="number" inputmode="decimal" min="0" step="' + step + '" value="' + esc(draft[key]) + '"' + disabled + '>' +
      (unit ? '<span class="field-hint">' + esc(unit) + '</span>' : '') +
    '</div>';
  }

  function visibleNotice(city) {
    if (state.user.role === 'analyst') {
      return notice('info', 'Read-only access: analyst accounts can review fares but not edit them.');
    }
    if (!Auth.inScope(state.user, city.id)) {
      return notice('warn', 'This city is outside your assigned scope. You can review the matrix but not edit it.');
    }
    if (city.provenance && city.provenance.provisional) {
      return notice('warn', 'Provisional matrix pending an LGU ordinance. Saves are written to the PostgreSQL fare matrix.');
    }
    return '';
  }

  function renderFareChips(city, canEdit) {
    const container = FF.byId('fare-chips');
    if (!container) return;
    container.innerHTML = city.vehicles.map(function (vehicle) {
      const selected = vehicle.vehicleId === ui.fareVehicleId;
      const patched = FF.hasOverride(city.id, vehicle.vehicleId);
      return '<button type="button" class="chip' + (selected ? ' active' : '') + '" data-fare-chip="' + esc(vehicle.vehicleId) + '"' +
        (patched ? ' title="Saved to PostgreSQL"' : '') + '>' +
        '<span class="chip-dot"></span>' + esc(Data.vehicleMeta(vehicle.vehicleId).name) +
        '<span class="chip-count">' + esc(Data.peso(vehicle.baseFare)) + '</span>' +
      '</button>';
    }).join('');
    FF.qsa('[data-fare-chip]', container).forEach(function (chip) {
      chip.addEventListener('click', function () {
        ui.fareVehicleId = chip.getAttribute('data-fare-chip');
        ui.fareDraft = null;
        ui.fareDraftKey = '';
        refreshFareView();
      });
    });
  }

  function renderFareEditor(city, draft, canEdit) {
    const vehicle = FF.getVehicle(city.id, ui.fareVehicleId);
    if (!vehicle) return;
    const patched = FF.hasOverride(city.id, vehicle.vehicleId);
    const disabled = canEdit ? '' : ' disabled';
    const readOnly = visibleNotice(city);
    const container = FF.byId('fare-editor');
    if (!container) return;

    container.innerHTML = '<div class="card">' +
      '<div class="card-head"><div><h3>' + esc(Data.vehicleMeta(vehicle.vehicleId).name) + ' tariff</h3>' +
        '<p>' + esc(city.displayName) + '</p></div>' +
        (patched ? badge('info', 'Saved override') : badge('neutral', 'PostgreSQL value')) +
      '</div>' +
      '<div class="card-body">' +
        (readOnly ? readOnly + '<div style="height:14px"></div>' : '') +
        '<div class="form-grid">' +
          fareField('Base fare', 'baseFare', '₱', '0.5', draft, disabled) +
          fareField('Covered distance', 'baseDistanceKm', 'km included in base fare', '0.1', draft, disabled) +
          fareField('Per-kilometre rate', 'perKmRate', '₱ per km after coverage', '0.25', draft, disabled) +
          fareField('Minimum fare', 'minFare', '₱ floor for any trip', '0.5', draft, disabled) +
          fareField('Customary cap', 'maxCustomary', '₱ upper benchmark', '0.5', draft, disabled) +
          fareField('Passenger capacity', 'typicalCapacity', 'seats per vehicle', '1', draft, disabled) +
        '</div>' +
        '<p class="field-hint" style="margin-top:10px">' + esc(vehicle.regulationMatrix || 'No regulation note in this dataset.') + '</p>' +
        '<div class="row" style="margin-top:14px">' +
          '<label class="toggle"><input type="checkbox" id="fare-active"' + (draft.active ? ' checked' : '') + disabled + '>' +
            '<span class="toggle-track"></span><span class="toggle-label">Available in fare estimates</span></label>' +
        '</div>' +
        '<div id="fare-error" class="form-error" style="margin-top:14px" hidden></div>' +
        '<div class="row" style="margin-top:16px;justify-content:flex-end">' +
          '<button type="button" class="btn btn-outline" id="fare-reset"' + (canEdit ? '' : ' disabled') + '>Reset</button>' +
          '<button type="button" class="btn btn-primary" id="fare-save"' + (canEdit ? '' : ' disabled') + '>Save changes</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    FF.qsa('[data-fare-field]', container).forEach(function (input) {
      input.addEventListener('input', function () {
        if (!ui.fareDraft) return;
        ui.fareDraft[input.getAttribute('data-fare-field')] = input.value;
        showFareError('');
        syncFareControls(city.id, canEdit);
      });
    });

    const active = FF.byId('fare-active');
    if (active) active.addEventListener('change', function () {
      if (!ui.fareDraft) return;
      ui.fareDraft.active = active.checked;
      syncFareControls(city.id, canEdit);
    });

    const save = FF.byId('fare-save');
    if (save) save.addEventListener('click', function () { saveFareDraft(city.id, canEdit); });
    const reset = FF.byId('fare-reset');
    if (reset) reset.addEventListener('click', function () { resetSelectedFare(city.id); });

    syncFareControls(city.id, canEdit);
  }

  function validateDraft(draft) {
    const fields = [
      ['baseFare', 'base fare'],
      ['baseDistanceKm', 'covered distance'],
      ['perKmRate', 'per-kilometre rate'],
      ['minFare', 'minimum fare'],
      ['maxCustomary', 'customary cap'],
      ['typicalCapacity', 'passenger capacity'],
    ];
    const values = {};
    for (let i = 0; i < fields.length; i += 1) {
      const key = fields[i][0];
      const label = fields[i][1];
      const raw = String(draft[key] == null ? '' : draft[key]).trim();
      const value = Number(raw);
      if (raw === '' || !Number.isFinite(value)) {
        return { ok: false, message: 'Enter a valid number for the ' + label + '.' };
      }
      if (key === 'typicalCapacity') {
        if (!Number.isInteger(value) || value < 1 || value > 30) {
          return { ok: false, message: 'Passenger capacity must be a whole number between 1 and 30.' };
        }
        values[key] = value;
      } else {
        if (value < 0) return { ok: false, message: FF.titleCase(label) + ' cannot be negative.' };
        values[key] = Math.round(value * 100) / 100;
      }
    }
    if (values.minFare > values.baseFare) {
      return { ok: false, message: 'Minimum fare cannot exceed the base fare.' };
    }
    if (values.maxCustomary < values.baseFare) {
      return { ok: false, message: 'Customary cap must be at least the base fare.' };
    }
    return { ok: true, values: values };
  }

  async function saveFareDraft(cityId, canEdit) {
    if (!canEdit || !Auth.can(state.user, 'fare.edit', cityId)) {
      FF.toast('You do not have permission to edit this fare matrix.', 'error');
      return;
    }
    const result = validateDraft(ui.fareDraft || {});
    if (!result.ok) {
      showFareError(result.message);
      return;
    }
    const vehicleId = ui.fareVehicleId;
    const vehicle = FF.getVehicle(cityId, vehicleId);
    const city = FF.getCity(cityId);
    if (!vehicle || !city) return;

    const patch = {
      baseFare: result.values.baseFare,
      baseDistanceKm: result.values.baseDistanceKm,
      perKmRate: result.values.perKmRate,
      minFare: result.values.minFare,
      maxCustomary: result.values.maxCustomary,
      typicalCapacity: result.values.typicalCapacity,
      active: Boolean((ui.fareDraft || {}).active),
    };

    const api = window.FareFairApi;
    if (api && api.live()) {
      const saveButton = FF.byId('fare-save');
      if (saveButton) {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving…';
      }
      try {
        await api.patch(
          '/v1/admin/cities/' + encodeURIComponent(cityId) +
            '/fare-matrix/' + encodeURIComponent(vehicleId),
          patch
        );
        ui.fareDraft = null;
        ui.fareDraftKey = '';
        FF.toast(
          Data.vehicleMeta(vehicleId).name + ' tariff saved to PostgreSQL.'
        );
        await FF.reloadDatasets();
      } catch (error) {
        if (saveButton) {
          saveButton.disabled = false;
          saveButton.textContent = 'Save changes';
        }
        showFareError(error.message || 'The API rejected this fare change.');
      }
      return;
    }

    showFareError('The fare matrix is stored in PostgreSQL. Start the API to save changes.');
    FF.toast('The API is offline. Nothing was saved.', 'error');
  }

  async function resetSelectedFare(cityId) {
    const vehicleId = ui.fareVehicleId;
    const name = Data.vehicleMeta(vehicleId).name;

    const api = window.FareFairApi;
    if (!api || !api.live()) {
      FF.toast('The API is offline. Reload the matrix once it is running.', 'error');
      return;
    }
    ui.fareDraft = null;
    ui.fareDraftKey = '';
    await FF.reloadDatasets();
    FF.toast(name + ' reloaded from PostgreSQL.');
  }

  function renderFareSide(city, draft) {
    const policy = city.farePolicy || {};
    const discount = typeof policy.discountRate === 'number' ? policy.discountRate : 0.2;
    const leewayMin = typeof policy.customaryLeewayMin === 'number' ? policy.customaryLeewayMin : 0.92;
    const leewayMax = typeof policy.customaryLeewayMax === 'number' ? policy.customaryLeewayMax : 1.12;
    const container = FF.byId('fare-side');
    if (!container) return;

    container.innerHTML = '<div class="card">' +
      '<div class="card-head"><div><h3>Live estimate preview</h3><p>3.0 km · 1 passenger · no discount</p></div></div>' +
      '<div class="card-body">' +
        '<div class="kpi-value" id="preview-fare">₱—</div>' +
        '<p class="muted" style="font-size:.73rem;margin-top:4px">Base fare plus the per-kilometre rate after the covered distance.</p>' +
        '<hr class="divider">' +
        '<dl class="detail-grid">' +
          '<div class="detail-item"><dt>Covered distance</dt><dd id="preview-covered">—</dd></div>' +
          '<div class="detail-item"><dt>Per-km rate</dt><dd id="preview-rate">—</dd></div>' +
          '<div class="detail-item"><dt>Minimum fare</dt><dd id="preview-min">—</dd></div>' +
          '<div class="detail-item"><dt>Customary cap</dt><dd id="preview-cap">—</dd></div>' +
        '</dl>' +
        '<hr class="divider">' +
        (city.provenance && city.provenance.provisional
          ? notice('warn', 'Provisional matrix pending LGU ordinance.')
          : notice('success', 'Read from the PostgreSQL fare matrix.')) +
        '<p class="field-hint" style="margin-top:10px">Statutory discount ' + esc(Data.percent(discount, 0)) +
          ' · customary band ' + esc(Data.percent(leewayMin, 0)) + '–' + esc(Data.percent(leewayMax, 0)) + '.</p>' +
      '</div>' +
    '</div>';
  }

  function renderFareTable(city, canEdit) {
    const container = FF.byId('fare-table');
    if (!container) return;
    const patchedCount = city.vehicles.filter(function (vehicle) {
      return FF.hasOverride(city.id, vehicle.vehicleId);
    }).length;

    let rows = '';
    city.vehicles.forEach(function (vehicle) {
      const patched = FF.hasOverride(city.id, vehicle.vehicleId);
      rows += '<tr>' +
        '<td><div class="primary-cell"><strong>' + esc(Data.vehicleMeta(vehicle.vehicleId).name) +
          (patched ? ' ' + badge('info', 'Override') : '') + '</strong><span class="mono">' + esc(vehicle.vehicleId) + '</span></div></td>' +
        '<td class="num">' + esc(Data.peso(vehicle.baseFare, 2)) + '</td>' +
        '<td class="num">' + esc(Data.km(vehicle.baseDistanceKm)) + '</td>' +
        '<td class="num">' + esc(Data.peso(vehicle.perKmRate, 2)) + '</td>' +
        '<td class="num">' + esc(Data.peso(vehicle.minFare, 2)) + '</td>' +
        '<td class="num">' + esc(Data.peso(vehicle.maxCustomary, 2)) + '</td>' +
        '<td class="num">' + esc(String(vehicle.typicalCapacity)) + '</td>' +
        '<td>' + (vehicle.active !== false ? badge('ok', 'Active') : badge('neutral', 'Inactive')) + '</td>' +
        '<td class="actions-col"><div class="table-actions">' +
          '<button type="button" class="btn btn-outline btn-sm" data-fare-edit="' + esc(vehicle.vehicleId) + '">' +
            (canEdit ? icon('edit') + ' Edit' : icon('eye') + ' Inspect') + '</button>' +
          (patched && canEdit
            ? '<button type="button" class="btn btn-ghost btn-sm" data-fare-clear="' + esc(vehicle.vehicleId) + '" title="Revert to dataset value">' + icon('refresh') + '</button>'
            : '') +
        '</div></td>' +
      '</tr>';
    });

    container.innerHTML = '<div class="card">' +
      '<div class="card-head"><div><h3>All vehicle tariffs</h3><p>' + city.vehicles.length + ' vehicles · ' +
        patchedCount + ' saved override' + (patchedCount === 1 ? '' : 's') + '</p></div>' +
        badge('neutral', cityShort(city)) + '</div>' +
      '<div class="table-wrap"><table class="data-table"><thead><tr>' +
        '<th>Vehicle</th><th class="num">Base</th><th class="num">Covered</th><th class="num">Per km</th>' +
        '<th class="num">Minimum</th><th class="num">Cap</th><th class="num">Seats</th><th>Status</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '</div>';

    FF.qsa('[data-fare-edit]', container).forEach(function (button) {
      button.addEventListener('click', function () {
        ui.fareVehicleId = button.getAttribute('data-fare-edit');
        ui.fareDraft = null;
        ui.fareDraftKey = '';
        refreshFareView();
        const editor = FF.byId('fare-editor');
        if (editor) editor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    FF.qsa('[data-fare-clear]', container).forEach(function (button) {
      button.addEventListener('click', function () {
        const vehicleId = button.getAttribute('data-fare-clear');
        if (!FF.resetVehicleOverride(city.id, vehicleId)) return;
        FF.audit('fare.reset', 'Reverted ' + Data.vehicleMeta(vehicleId).name + ' to the bundled dataset', { cityId: city.id });
        if (ui.fareVehicleId === vehicleId) {
          ui.fareDraft = null;
          ui.fareDraftKey = '';
        }
        FF.toast(Data.vehicleMeta(vehicleId).name + ' reverted to the dataset value.');
        refreshFareView();
      });
    });
  }

  function refreshFareView() {
    if (!state.data) return;
    FF.ensureFareSelection();
    const city = FF.getCity(ui.fareCityId);
    if (!city) return;
    const canEdit = Auth.can(state.user, 'fare.edit', city.id);

    const context = FF.byId('fare-context');
    if (context) context.innerHTML = fareContext(city, canEdit);

    renderFareChips(city, canEdit);
    const draft = ensureDraft(city.id, ui.fareVehicleId);
    if (!draft) return;
    renderFareEditor(city, draft, canEdit);
    renderFareSide(city, draft);
    renderFareTable(city, canEdit);
    updatePreview();
  }

  function renderFares() {
    if (!state.data) return;
    FF.ensureFareSelection();
    const city = FF.getCity(ui.fareCityId);
    if (!city) {
      FF.dom.page.innerHTML = FF.emptyState('city', 'No city datasets', 'Add a city dataset to begin editing fares.');
      return;
    }
    const canEdit = Auth.can(state.user, 'fare.edit', city.id);
    const citySelect = '<select class="select" id="fare-city" aria-label="City dataset">' +
      cityOptions(ui.fareCityId, false) + '</select>';

    FF.dom.page.innerHTML =
      FF.pageHead(
        'Fare matrix editor',
        'The per-kilometre fallback behind in-app estimates. Saves are written to PostgreSQL.',
        canEdit ? '<span class="pill pill-live pill-dot">Editing enabled</span>' : '<span class="pill pill-quiet">Read-only</span>'
      ) +
      '<div class="toolbar">' +
        '<div class="input-group" style="min-width:240px;flex:0 1 360px">' +
          '<label for="fare-city">City dataset</label>' + citySelect +
        '</div>' +
        '<span class="spacer"></span>' +
        '<span id="fare-context"></span>' +
      '</div>' +
      '<div class="chips" id="fare-chips" style="margin-bottom:16px"></div>' +
      '<div class="grid-2 grid-2-even">' +
        '<div id="fare-editor"></div>' +
        '<div id="fare-side"></div>' +
      '</div>' +
      '<div style="margin-top:16px" id="fare-table"></div>';

    const select = FF.byId('fare-city');
    select.addEventListener('change', function () {
      ui.fareCityId = select.value;
      ui.fareVehicleId = '';
      ui.fareDraft = null;
      ui.fareDraftKey = '';
      refreshFareView();
    });
    refreshFareView();
  }

  pages.fares = renderFares;

  /* ------------------------------------------------------------------ */
  /* Official fare routes                                                */
  /* ------------------------------------------------------------------ */

  function routeCity() {
    const cityId = FF.activeCityId();
    return cityId ? FF.getCity(cityId) : null;
  }

  function routeRows(city) {
    return (city && city.fareRoutes) || [];
  }

  function routeMatches(route, query) {
    if (!query) return true;
    return (
      String(route.rowNumber) + ' ' + route.from + ' ' + route.to + ' ' +
      (route.via || '') + ' ' + (route.remark || '')
    ).toLowerCase().indexOf(query) !== -1;
  }

  function filteredRoutes(city) {
    const query = String(ui.routeQuery || '').trim().toLowerCase();
    return routeRows(city).filter(function (route) {
      if (ui.routeVehicleId && route.vehicleId !== ui.routeVehicleId) return false;
      return routeMatches(route, query);
    });
  }

  function routeVehicles(city) {
    const seen = {};
    const list = [];
    routeRows(city).forEach(function (route) {
      if (seen[route.vehicleId]) return;
      seen[route.vehicleId] = true;
      list.push({ id: route.vehicleId, name: route.vehicleName || Data.vehicleMeta(route.vehicleId).name });
    });
    return list;
  }

  function routePlaceLabels(city) {
    const seen = {};
    const list = [];
    routeRows(city).forEach(function (route) {
      [route.from, route.to].forEach(function (label) {
        String(label || '').split(/\s+or\s+/i).forEach(function (part) {
          const value = part.trim();
          const key = value.toLowerCase();
          if (!value || seen[key]) return;
          seen[key] = true;
          list.push(value);
        });
      });
    });
    return list.sort(function (a, b) { return a.localeCompare(b); });
  }

  function renderRouteRows(city, canEdit) {
    const tbody = FF.byId('route-rows');
    if (!tbody) return;
    const rows = filteredRoutes(city);
    const count = FF.byId('route-count');
    if (count) {
      count.textContent = rows.length + ' of ' + routeRows(city).length + ' rows';
    }
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty" style="padding:26px 10px">' +
        '<h3>No routes match this filter</h3>' +
        '<p>Clear the search or choose a different vehicle class.</p>' +
      '</div></td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(function (route) {
      return '<tr>' +
        '<td class="num mono">' + esc(String(route.rowNumber)) + '</td>' +
        '<td><div class="primary-cell"><strong>' + esc(route.from) + '</strong>' +
          (route.via ? '<span class="muted">via ' + esc(route.via) + '</span>' : '') +
        '</div></td>' +
        '<td><div class="primary-cell"><strong>' + esc(route.to) + '</strong>' +
          (route.bidirectional ? '<span class="muted">Same fare both ways</span>' : '') +
        '</div></td>' +
        '<td class="num">' + esc(Data.peso(route.regularFare, 2)) + '</td>' +
        '<td class="num">' + esc(Data.peso(route.discountedFare, 2)) + '</td>' +
        '<td>' + esc(route.remark || '—') + '</td>' +
        '<td class="actions-col"><div class="table-actions">' +
          '<button type="button" class="btn btn-outline btn-sm" data-route-edit="' + esc(String(route.rowNumber)) + '">' +
            (canEdit ? icon('edit') + ' Edit' : icon('eye') + ' Inspect') +
          '</button>' +
        '</div></td>' +
      '</tr>';
    }).join('');

    FF.qsa('[data-route-edit]', tbody).forEach(function (button) {
      button.addEventListener('click', function () {
        const rowNumber = Number(button.getAttribute('data-route-edit'));
        const route = routeRows(city).filter(function (item) {
          return item.rowNumber === rowNumber && (!ui.routeVehicleId || item.vehicleId === ui.routeVehicleId);
        })[0];
        if (route) openRouteEditor(city, route, canEdit);
      });
    });
  }

  function routeField(label, id, value, step, hint) {
    return '<div class="input-group">' +
      '<label for="' + id + '">' + esc(label) + '</label>' +
      '<input class="input num" id="' + id + '" type="number" inputmode="decimal" min="0" step="' + step + '" value="' + esc(String(value)) + '">' +
      (hint ? '<span class="field-hint">' + esc(hint) + '</span>' : '') +
    '</div>';
  }

  function openRouteEditor(city, route, canEdit) {
    if (!canEdit) {
      FF.toast('Your account can review this route but not edit it.', 'error');
      return;
    }
    FF.openModal({
      eyebrow: 'Official route #' + route.rowNumber,
      title: route.from + ' → ' + route.to,
      body:
        '<p class="muted" style="margin:0 0 14px">Published per-passenger fare for ' +
          esc(Data.vehicleMeta(route.vehicleId).name) + ' in ' + esc(city.displayName) + '.</p>' +
        '<div class="form-grid">' +
          routeField('Regular fare', 'route-regular', route.regularFare, '0.5', '₱ per passenger') +
          routeField('Discounted fare', 'route-discounted', route.discountedFare, '0.5', 'Students, seniors and PWDs') +
        '</div>' +
        '<div class="input-group" style="margin-top:12px">' +
          '<label for="route-remark">Remark</label>' +
          '<input class="input" id="route-remark" maxlength="500" value="' + esc(route.remark || '') + '">' +
        '</div>' +
        '<div class="row" style="margin-top:12px">' +
          '<label class="toggle"><input type="checkbox" id="route-reverse"' + (route.bidirectional ? ' checked' : '') + '>' +
            '<span class="toggle-track"></span><span class="toggle-label">Same fare applies in both directions</span></label>' +
        '</div>' +
        '<div id="route-error" class="form-error" style="margin-top:12px" hidden></div>',
      footer:
        '<button type="button" class="btn btn-outline" data-modal-close>Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="route-save">Save to PostgreSQL</button>',
      onMount: function (modal) {
        const save = modal.querySelector('#route-save');
        const regularInput = modal.querySelector('#route-regular');
        const discountedInput = modal.querySelector('#route-discounted');
        const remarkInput = modal.querySelector('#route-remark');
        const reverseInput = modal.querySelector('#route-reverse');
        const errorBox = modal.querySelector('#route-error');
        const showError = function (message) {
          errorBox.hidden = !message;
          errorBox.textContent = message || '';
        };
        if (regularInput) regularInput.setAttribute('data-autofocus', '');
        if (save) save.addEventListener('click', async function () {
          const regular = Number(regularInput.value);
          const discounted = Number(discountedInput.value);
          if (!Number.isFinite(regular) || regular < 0) {
            showError('Enter a valid regular fare.');
            return;
          }
          if (!Number.isFinite(discounted) || discounted < 0) {
            showError('Enter a valid discounted fare.');
            return;
          }
          if (discounted > regular) {
            showError('The discounted fare cannot exceed the regular fare.');
            return;
          }
          save.disabled = true;
          save.textContent = 'Saving…';
          try {
            await window.FareFairApi.put(
              '/v1/admin/cities/' + encodeURIComponent(city.id) +
                '/fare-routes/' + encodeURIComponent(route.rowNumber) +
                '?vehicleId=' + encodeURIComponent(route.vehicleId),
              {
                regularFare: regular,
                discountedFare: discounted,
                remark: remarkInput.value,
                bidirectional: reverseInput.checked,
              }
            );
            FF.closeModal();
            FF.toast('Route #' + route.rowNumber + ' saved to PostgreSQL.');
            await FF.reloadDatasets();
          } catch (error) {
            save.disabled = false;
            save.textContent = 'Save to PostgreSQL';
            showError(error.message || 'The API rejected this fare route.');
          }
        });
      },
    });
  }

  function renderRouteLookup(city) {
    const container = FF.byId('route-lookup-result');
    if (!container) return;
    if (ui.lookupError) {
      container.innerHTML = notice('warn', esc(ui.lookupError));
      return;
    }
    const result = ui.lookupResult;
    if (!result) {
      container.innerHTML =
        '<div class="empty" style="padding:22px 10px">' +
          '<div class="empty-icon">' + icon('search') + '</div>' +
          '<h3>Check the published tariff</h3>' +
          '<p>Enter an origin and destination to read the official fare row.</p>' +
        '</div>';
      return;
    }
    if (result.fareSource !== 'official_matrix' || !result.route) {
      container.innerHTML = notice('warn',
        'This pair is not in the published table. The distance formula needs an explicit distance before it can quote a fare.'
      );
      return;
    }
    const route = result.route;
    container.innerHTML = '<div class="kpi-value">' + esc(Data.peso(result.fare.exact, 2)) + '</div>' +
      '<p class="muted" style="font-size:.73rem;margin-top:4px">' +
        esc(result.passengers) + ' passenger' + (result.passengers === 1 ? '' : 's') +
        ' · ' + esc(result.discountCode === 'none' ? 'no discount' : result.discountCode) +
      '</p>' +
      '<hr class="divider">' +
      '<dl class="detail-grid">' +
        '<div class="detail-item"><dt>Official row</dt><dd>#' + esc(String(route.rowNumber)) + (route.reversed ? ' · reverse' : '') + '</dd></div>' +
        '<div class="detail-item"><dt>Published regular</dt><dd>' + esc(Data.peso(route.regularFare, 2)) + '</dd></div>' +
        '<div class="detail-item"><dt>Published discounted</dt><dd>' + esc(Data.peso(route.discountedFare, 2)) + '</dd></div>' +
        '<div class="detail-item"><dt>Matched pair</dt><dd>' + esc(route.matchedOrigin) + ' → ' + esc(route.matchedDestination) + '</dd></div>' +
        '<div class="detail-item"><dt>Distance</dt><dd>' + esc(Data.km(result.distanceKm)) + '</dd></div>' +
        '<div class="detail-item"><dt>Distance source</dt><dd>' + esc(result.distanceKmSource === 'derived_from_published_fare' ? 'Derived from fare' : 'Requested') + '</dd></div>' +
      '</dl>' +
      (route.remark ? '<p class="field-hint" style="margin-top:10px">' + esc(route.remark) + '</p>' : '');
  }

  async function runRouteLookup(city) {
    ui.lookupOrigin = FF.byId('lookup-origin').value;
    ui.lookupDestination = FF.byId('lookup-destination').value;
    ui.lookupPassengers = FF.byId('lookup-passengers').value;
    ui.lookupDiscount = FF.byId('lookup-discount').value;
    ui.lookupError = '';
    ui.lookupResult = null;

    const origin = ui.lookupOrigin.trim();
    const destination = ui.lookupDestination.trim();
    const button = FF.byId('lookup-run');
    if (!origin || !destination) {
      ui.lookupError = 'Enter both an origin and a destination.';
      renderRouteLookup(city);
      return;
    }
    const api = window.FareFairApi;
    if (!api || !api.online()) {
      ui.lookupError = 'The official fare lookup reads PostgreSQL through the API. Start the API and reload this page.';
      renderRouteLookup(city);
      return;
    }
    if (button) {
      button.disabled = true;
      button.textContent = 'Checking…';
    }
    try {
      const fallbackVehicle = routeVehicles(city)[0];
      ui.lookupResult = await api.post('/v1/fare/estimate', {
        cityId: city.id,
        vehicleId: ui.routeVehicleId || (fallbackVehicle ? fallbackVehicle.id : 'tricycle'),
        origin: origin,
        destination: destination,
        passengers: Number(ui.lookupPassengers) || 1,
        discountCode: ui.lookupDiscount || 'none',
        pakyaw: false,
      });
    } catch (error) {
      ui.lookupError = error.status === 400 && error.code === 'DISTANCE_REQUIRED'
        ? 'This pair is not in the published table. The distance formula needs an explicit distance before it can quote a fare.'
        : (error.message || 'The lookup failed.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Check published fare';
      }
      renderRouteLookup(city);
    }
  }

  function renderRoutes() {
    if (!state.data) return;
    const city = routeCity();
    if (!city) {
      FF.dom.page.innerHTML = FF.emptyState('city', 'No city dataset', 'Cabadbaran City has not been seeded yet.');
      return;
    }
    const routes = routeRows(city);
    const meta = city.fareRouteMeta || {};
    const canEdit = Auth.can(state.user, 'fare.edit', city.id);
    const vehicles = routeVehicles(city);
    const places = routePlaceLabels(city);

    if (!ui.routeVehicleId || !vehicles.some(function (v) { return v.id === ui.routeVehicleId; })) {
      ui.routeVehicleId = vehicles.length ? vehicles[0].id : '';
    }

    const vehicleOptions = vehicles.map(function (vehicle) {
      return '<option value="' + esc(vehicle.id) + '"' + (vehicle.id === ui.routeVehicleId ? ' selected' : '') + '>' +
        esc(vehicle.name) + '</option>';
    }).join('');

    const placeOptions = places.map(function (place) {
      return '<option value="' + esc(place) + '"></option>';
    }).join('');

    const discountOptions = [
      ['none', 'No discount'],
      ['student', 'Student'],
      ['senior', 'Senior citizen'],
      ['pwd', 'Person with disability'],
    ].map(function (entry) {
      return '<option value="' + entry[0] + '"' + (ui.lookupDiscount === entry[0] ? ' selected' : '') + '>' + entry[1] + '</option>';
    }).join('');

    const sourceNotice = routes.length
      ? notice('success',
          'Reading ' + routes.length + ' published rows from PostgreSQL' +
          (meta.effectiveFrom ? ' · effective ' + esc(Data.formatDate(meta.effectiveFrom)) : '') +
          (meta.provisional ? ' · provisional' : ' · official'))
      : notice('warn',
          'No official fare rows were returned. Seed the database with <code>npm run db:reset</code> and reload.');

    FF.dom.page.innerHTML =
      FF.pageHead(
        'Official fare routes',
        city.displayName + ' point-to-point tricycle fares from the LGU matrix.',
        canEdit ? '<span class="pill pill-live pill-dot">Editing enabled</span>' : '<span class="pill pill-quiet">Read-only</span>'
      ) +
      FF.statStrip([
        { label: 'Published rows', value: esc(String(routes.length)) },
        { label: 'Vehicle classes', value: esc(String(vehicles.length)) },
        { label: 'Effective', value: esc(meta.effectiveFrom ? Data.formatDate(meta.effectiveFrom) : '—') },
        { label: 'Minimum fare', value: esc(routes.length ? Data.peso(Math.min.apply(null, routes.map(function (r) { return r.regularFare; })), 2) : '—') },
      ]) +
      '<div style="margin-top:16px">' + sourceNotice + '</div>' +
      '<div class="grid-2" style="margin-top:16px">' +
        '<div class="card">' +
          '<div class="card-head"><div><h3>Published fare lookup</h3><p>Reads the active matrix through the API.</p></div></div>' +
          '<div class="card-body">' +
            '<div class="form-grid">' +
              '<div class="input-group"><label for="lookup-origin">Origin</label>' +
                '<input class="input" id="lookup-origin" list="route-places" placeholder="Poblacion" value="' + esc(ui.lookupOrigin) + '"></div>' +
              '<div class="input-group"><label for="lookup-destination">Destination</label>' +
                '<input class="input" id="lookup-destination" list="route-places" placeholder="Bayabas" value="' + esc(ui.lookupDestination) + '"></div>' +
              '<div class="input-group"><label for="lookup-passengers">Passengers</label>' +
                '<input class="input num" id="lookup-passengers" type="number" min="1" max="60" step="1" value="' + esc(ui.lookupPassengers) + '"></div>' +
              '<div class="input-group"><label for="lookup-discount">Discount</label>' +
                '<select class="select" id="lookup-discount">' + discountOptions + '</select></div>' +
            '</div>' +
            '<div class="row" style="margin-top:14px;justify-content:flex-end">' +
              '<button type="button" class="btn btn-primary" id="lookup-run">Check published fare</button>' +
            '</div>' +
            '<datalist id="route-places">' + placeOptions + '</datalist>' +
          '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-head"><div><h3>Official result</h3><p>The exact fare returned for this pair.</p></div></div>' +
          '<div class="card-body" id="route-lookup-result"></div>' +
        '</div>' +
      '</div>' +
      '<div class="card" style="margin-top:16px">' +
        '<div class="card-head"><div><h3>Published route matrix</h3><p id="route-count">' + routes.length + ' of ' + routes.length + ' rows</p></div>' +
          '<div class="row">' +
            '<div class="input-group" style="min-width:220px"><label for="route-search">Search</label>' +
              '<input class="input" id="route-search" type="search" placeholder="Barangay, place or row number" value="' + esc(ui.routeQuery) + '"></div>' +
            '<div class="input-group" style="min-width:170px"><label for="route-vehicle">Vehicle</label>' +
              '<select class="select" id="route-vehicle">' + vehicleOptions + '</select></div>' +
          '</div>' +
        '</div>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr>' +
          '<th class="num">#</th><th>From</th><th>To</th><th class="num">Regular</th>' +
          '<th class="num">Discounted</th><th>Remark</th><th></th>' +
        '</tr></thead><tbody id="route-rows"></tbody></table></div>' +
        '<div class="card-body" style="border-top:1px solid var(--line)">' +
          '<p class="field-hint" style="margin:0">Rows apply both ways unless a different origin is named. ' +
            'Discounts are 20% for students, senior citizens and PWDs with a valid ID. ' +
            'Beyond the Poblacion, ₱2.00 is added per kilometre or fraction of a kilometre.</p>' +
        '</div>' +
      '</div>';

    renderRouteRows(city, canEdit);
    renderRouteLookup(city);

    const search = FF.byId('route-search');
    if (search) search.addEventListener('input', function () {
      ui.routeQuery = search.value;
      renderRouteRows(city, canEdit);
    });

    const vehicleSelect = FF.byId('route-vehicle');
    if (vehicleSelect) vehicleSelect.addEventListener('change', function () {
      ui.routeVehicleId = vehicleSelect.value;
      renderRouteRows(city, canEdit);
      if (ui.lookupResult) runRouteLookup(city);
    });

    const run = FF.byId('lookup-run');
    if (run) run.addEventListener('click', function () { runRouteLookup(city); });
    ['lookup-origin', 'lookup-destination', 'lookup-passengers', 'lookup-discount'].forEach(function (id) {
      const input = FF.byId(id);
      if (input) input.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          runRouteLookup(city);
        }
      });
    });
  }

  pages.routes = renderRoutes;
})();
