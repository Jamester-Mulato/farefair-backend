/* Fare seeds — one page, one pipeline.
 *
 *   1  Upload the ordinance
 *   2  Confirm the rows, write them to the matrix
 *   3  Validate and compile a seed
 *   4  Publish it (or roll back to an earlier one)
 *
 * The page always says what the next action is, so there is no dead end after
 * an upload and no guessing which button belongs to which step.
 */
(function () {
  'use strict';

  const FF = window.FF;
  const Api = window.FareFairApi;

  const ui = {
    vehicleId: '',
    upload: null,
    pages: [],
    notice: null,
    checks: null,
    artifacts: [],
    events: [],
    reason: '',
    busy: false,
    message: null,
    loaded: false,
  };

  /* ------------------------------------------------------------------ */
  /* data                                                                */
  /* ------------------------------------------------------------------ */

  function cityId() {
    return FF.activeCityId() || 'cabadbaran';
  }

  function vehicles() {
    return FF.getVehicles(cityId()) || [];
  }

  function ensureVehicle() {
    const list = vehicles();
    if (!ui.vehicleId || !list.some((v) => v.vehicleId === ui.vehicleId)) {
      const tricycle = list.find((v) => v.vehicleId === 'tricycle');
      ui.vehicleId = tricycle ? tricycle.vehicleId : (list[0] ? list[0].vehicleId : 'tricycle');
    }
  }

  function describe(error) {
    return error && error.message ? error.message : String(error);
  }

  function blocking(checks) {
    return (checks || []).filter((c) => !c.ok && c.blocking !== false);
  }

  function warnings(checks) {
    return (checks || []).filter((c) => !c.ok && c.blocking === false);
  }

  async function load() {
    ensureVehicle();
    const city = encodeURIComponent(cityId());
    const vehicle = encodeURIComponent(ui.vehicleId);
    ui.message = null;
    try {
      const seeds = await Api.get(
        `/v1/admin/cities/${city}/seeds?vehicleId=${vehicle}`,
      );
      ui.artifacts = seeds.artifacts || [];
      ui.events = seeds.events || [];
    } catch (error) {
      ui.artifacts = [];
      ui.events = [];
      ui.message = { kind: 'warn', text: describe(error) };
    }

    try {
      const list = await Api.get(
        `/v1/admin/cities/${city}/ordinances?vehicleId=${vehicle}`,
      );
      ui.notice = list.notice || null;
      const latest = (list.uploads || [])[0] || null;
      if (latest) {
        const detail = await Api.get(
          `/v1/admin/ordinance-uploads/${encodeURIComponent(latest.id)}`,
        );
        ui.upload = { ...latest, ...detail.upload, rows: detail.rows || [] };
        ui.pages = detail.upload.ocr_text || [];
      } else {
        ui.upload = null;
        ui.pages = [];
      }
    } catch (error) {
      ui.upload = null;
      ui.pages = [];
      ui.notice = null;
    }

    try {
      ui.checks = await validateRemote();
    } catch (_) {
      ui.checks = null;
    }

    ui.loaded = true;
    render();
  }

  async function validateRemote() {
    const result = await Api.post(
      `/v1/admin/cities/${encodeURIComponent(cityId())}/seeds/validate`,
      { vehicleId: ui.vehicleId },
    );
    return result.checks || [];
  }

  /* ------------------------------------------------------------------ */
  /* derived state                                                       */
  /* ------------------------------------------------------------------ */

  function publishedSeed() {
    return ui.artifacts.find((a) => a.status === 'published') || null;
  }

  function draftSeed() {
    return ui.artifacts.find((a) => a.status === 'draft') || null;
  }

  function uploadRows() {
    return (ui.upload && ui.upload.rows) || [];
  }

  function uploadDiffers() {
    const diff = (ui.upload && ui.upload.diff) || {};
    return ((diff.changed || []).length + (diff.missingInMatrix || []).length) > 0;
  }

  function steps() {
    const upload = ui.upload;
    const applied = upload && upload.status === 'applied';
    const bad = blocking(ui.checks);
    const upToDate = (ui.checks || []).some((c) => c.code === 'seed.up_to_date' && c.ok);
    const raw = [
      {
        key: 'upload',
        title: 'Upload the ordinance',
        done: Boolean(upload),
        active: !upload,
        hint: upload
          ? `${upload.filename} · ${upload.status}`
          : 'Word tables are read exactly; a scanned PDF is read with OCR.',
      },
      {
        key: 'matrix',
        title: 'Confirm rows into the matrix',
        done: Boolean(upload && applied),
        active: Boolean(upload) && !applied,
        hint: !upload
          ? 'Waiting for an ordinance.'
          : upload.status === 'scan'
            ? 'This upload has no readable table.'
            : applied
              ? 'The matrix matches this upload.'
              : `${uploadRows().length} row(s) ready to review.`,
      },
      {
        key: 'compile',
        title: 'Validate and compile a seed',
        done: Boolean(draftSeed()) || Boolean(publishedSeed() && upToDate),
        active: Boolean(upload && applied) && !draftSeed(),
        hint: bad.length
          ? `${bad.length} blocking check(s) failed.`
          : draftSeed()
            ? `Seed v${draftSeed().version} compiled, waiting to publish.`
            : publishedSeed()
              ? `Published seed v${publishedSeed().version}.`
              : 'No seed yet.',
      },
      {
        key: 'publish',
        title: 'Publish',
        done: Boolean(publishedSeed()) && upToDate,
        active: Boolean(draftSeed()),
        hint: publishedSeed()
          ? `Seed v${publishedSeed().version} is live for clients.`
          : 'Nothing is live yet.',
      },
    ];

    // A later step cannot be complete while an earlier one is open.
    let blocked = false;
    return raw.map((step) => {
      const done = !blocked && step.done;
      const active = !blocked && !done && step.active;
      if (!done) blocked = true;
      return { ...step, done, active, blocked: !done && !active };
    });
  }

  function nextAction() {
    const upload = ui.upload;
    const bad = blocking(ui.checks);
    const draft = draftSeed();
    const published = publishedSeed();
    const upToDate = (ui.checks || []).some((c) => c.code === 'seed.up_to_date' && c.ok);

    if (!upload) {
      return { label: 'Choose an ordinance file below', action: null };
    }
    if (upload.status === 'scan') {
      return {
        label: 'This upload is a scan with no readable table. Upload the typed document.',
        action: null,
      };
    }
    if (upload.status !== 'applied') {
      return uploadRows().length
        ? { label: `Review ${uploadRows().length} row(s), then apply them`, action: 'apply' }
        : { label: 'No rows were read from this upload.', action: null };
    }
    if (bad.length) {
      return { label: `${bad[0].message}`, action: 'validate' };
    }
    if (draft) {
      return { label: `Seed v${draft.version} is ready. Publish it to reach clients.`, action: 'publish' };
    }
    if (published && upToDate) {
      return { label: `Nothing to do: seed v${published.version} matches the matrix.`, action: 'validate' };
    }
    return { label: 'Compile a seed from the current matrix.', action: 'compile' };
  }

  /* ------------------------------------------------------------------ */
  /* render                                                              */
  /* ------------------------------------------------------------------ */

  function render() {
    if (!FF.state.data) return;
    ensureVehicle();

    const stage = steps();
    const next = nextAction();
    const upload = ui.upload;
    const rows = uploadRows();

    FF.dom.page.innerHTML =
      FF.pageHead(
        'Fare seeds',
        'One pipeline: ordinance file → matrix → validated seed → published to the app.',
        '<span class="pill pill-live pill-dot">Governance enabled</span>',
      ) +
      pipelineHtml(stage) +
      nextHtml(next) +
      stepUpload(upload) +
      (upload && upload.status !== 'scan' ? stepMatrix(upload, rows) : '') +
      stepCompile() +
      stepPublish() +
      eventsHtml();

    wire();
  }

  function pipelineHtml(stage) {
    const parts = stage.map((step, index) => {
      const cls = step.done ? 'is-done' : step.active ? 'is-active' : 'is-blocked';
      return '<div class="pipe-step ' + cls + '">' +
        '<span class="pipe-dot">' + (step.done ? '✓' : index + 1) + '</span>' +
        '<span class="pipe-text"><strong>' + FF.esc(step.title) + '</strong>' +
        '<small>' + FF.esc(step.hint) + '</small></span>' +
      '</div>';
    }).join('<div class="pipe-line"></div>');
    return '<div class="pipe" style="margin-top:16px">' + parts + '</div>';
  }

  function nextHtml(next) {
    return '<div class="card next-card" style="margin-top:16px">' +
      '<div class="card-body" style="display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap">' +
        '<div><div class="lbl">Next action</div>' +
        '<div style="font-size:16px;font-weight:600;margin-top:4px">' + FF.esc(next.label) + '</div></div>' +
        (next.action === 'apply'
          ? '<button class="btn" data-action="apply">Apply ' + uploadRows().length + ' row(s)</button>'
          : next.action === 'compile'
            ? '<button class="btn" data-action="compile">Compile seed</button>'
            : next.action === 'publish' && draftSeed()
              ? '<button class="btn" data-action="publish">Publish v' + draftSeed().version + '</button>'
              : next.action === 'validate'
                ? '<button class="btn btn-ghost" data-action="validate">Re-check</button>'
                : '') +
      '</div>' +
    '</div>';
  }

  function stepUpload(upload) {
    const canEdit = canCompile();
    const notice = ui.notice
      ? FF.notice(
          ui.notice.kind === 'match' || ui.notice.kind === 'applied' ? 'success' : 'warn',
          FF.esc(ui.notice.text),
        )
      : '';
    return '<div class="card step-card" style="margin-top:16px">' +
      '<div class="card-head"><div><h3><span class="step-no">1</span> Ordinance file</h3>' +
        '<p>Upload the signed ordinance as .docx or .pdf. Nothing is applied automatically.</p></div>' +
        (upload ? statusPill(upload.status) : '') +
      '</div>' +
      '<div class="card-body">' +
        notice +
        '<div class="row-actions" style="margin-top:12px">' +
          '<input id="ord-file" type="file" accept=".docx,.pdf"' + (ui.busy ? ' disabled' : '') + '>' +
          '<button class="btn" id="ord-upload"' + (ui.busy || !canEdit ? ' disabled' : '') + '>Upload and read</button>' +
        '</div>' +
        (upload && upload.warning ? '<p class="muted-note">' + FF.esc(upload.warning) + '</p>' : '') +
        pagesHtml() +
      '</div>' +
    '</div>';
  }

  function pagesHtml() {
    if (!ui.pages.length) return '';
    const body = ui.pages.map((page) =>
      '<div class="page-review">' +
        '<div class="lbl">Page ' + FF.esc(String(page.page)) + '</div>' +
        (page.image
          ? '<img alt="Scanned page ' + FF.esc(String(page.page)) + '" ' +
            'src="data:image/jpeg;base64,' + page.image + '">'
          : '') +
        '<pre>' + FF.esc(String(page.text || '').slice(0, 1400)) + '</pre>' +
      '</div>').join('');
    return '<details class="pages"><summary>Review ' + ui.pages.length +
      ' scanned page(s) against the paper</summary>' + body + '</details>';
  }

  function stepMatrix(upload, rows) {
    const applied = upload.status === 'applied';
    const diff = upload.diff || {};
    const changed = diff.changed || [];
    const added = diff.missingInMatrix || [];
    const canEdit = canCompile();

    let diffBlock = '';
    if (applied) {
      diffBlock = FF.notice('success', 'These rows are already in the active matrix.');
    } else if (changed.length || added.length) {
      diffBlock = FF.notice(
        'warn',
        changed.length + ' row(s) differ and ' + added.length + ' are new. ' +
          'Confirm the amounts, then apply them.',
      );
    } else if (rows.length) {
      diffBlock = FF.notice('success', 'Every row matches the active matrix.');
    }

    const table = rows.length ? rowsTable(rows, !applied) : '';

    return '<div class="card step-card" style="margin-top:16px">' +
      '<div class="card-head"><div><h3><span class="step-no">2</span> Confirm rows into the matrix</h3>' +
        '<p>The matrix only takes the amounts you confirm here; applying is audited.</p></div>' +
        (applied
          ? '<span class="pill pill-live pill-dot">Applied</span>'
          : '<span class="pill pill-quiet">' + rows.length + ' row(s)</span>') +
      '</div>' +
      '<div class="card-body">' + diffBlock + table +
        (!applied && rows.length && canEdit
          ? '<div class="row-actions" style="margin-top:12px">' +
              '<button class="btn" data-action="apply">Apply reviewed rows to the matrix</button>' +
              '<span class="muted-note">Applies the amounts shown above.</span>' +
            '</div>'
          : '') +
      '</div>' +
    '</div>';
  }

  function rowsTable(rows, editable) {
    const head = '<tr><th>#</th><th>Origin</th><th>Destination</th>' +
      '<th>Amount A</th><th>Amount B</th><th>Page</th></tr>';
    const body = rows.map((row) => {
      const number = row.row_number;
      return '<tr>' +
        '<td class="mono">' + FF.esc(String(number)) + '</td>' +
        '<td>' + FF.esc(row.from_label || '') + '</td>' +
        '<td>' + FF.esc(row.to_label || '') + '</td>' +
        '<td>' + (editable
          ? '<input class="ord-amount" data-row="' + number + '" data-field="regular" value="' +
            Number(row.regular).toFixed(2) + '">'
          : '<span class="mono">₱' + Number(row.regular).toFixed(2) + '</span>') + '</td>' +
        '<td>' + (editable
          ? '<input class="ord-amount" data-row="' + number + '" data-field="discounted" value="' +
            (row.discounted === null || row.discounted === undefined ? '' : Number(row.discounted).toFixed(2)) + '">'
          : '<span class="mono">' + (row.discounted === null ? '—' : '₱' + Number(row.discounted).toFixed(2)) + '</span>') + '</td>' +
        '<td class="mono">' + (row.page ? FF.esc(String(row.page)) : '—') + '</td>' +
      '</tr>';
    }).join('');
    return '<div class="table-wrap tall"><table class="table"><thead>' + head +
      '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function stepCompile() {
    const checks = ui.checks || [];
    const bad = blocking(checks);
    const canEdit = canCompile();
    const checkRows = checks.map((c) => {
      const tone = c.ok ? 'is-ok' : c.blocking === false ? 'is-warn' : 'is-fail';
      return '<li class="seed-check ' + tone + '"><span class="seed-check-dot"></span>' +
        '<span><strong>' + FF.esc(c.code) + '</strong> — ' + FF.esc(c.message) + '</span></li>';
    }).join('');

    return '<div class="card step-card" style="margin-top:16px">' +
      '<div class="card-head"><div><h3><span class="step-no">3</span> Validate and compile</h3>' +
        '<p>Twelve checks must pass before a seed can be built.</p></div>' +
        (bad.length
          ? '<span class="pill pill-quiet">' + bad.length + ' blocking</span>'
          : '<span class="pill pill-live pill-dot">Ready</span>') +
      '</div>' +
      '<div class="card-body">' +
        (checks.length ? '<ul class="seed-checks">' + checkRows + '</ul>' : '<p class="muted-note">Run the checks to see the state of the matrix.</p>') +
        '<div class="row-actions" style="margin-top:14px">' +
          '<button class="btn btn-ghost" data-action="validate">Re-run checks</button>' +
          '<button class="btn" data-action="compile"' + (canEdit && !bad.length ? '' : ' disabled') + '>Compile a new seed</button>' +
        '</div>' +
        (ui.message ? FF.notice(ui.message.kind, FF.esc(ui.message.text)) : '') +
      '</div>' +
    '</div>';
  }

  function stepPublish() {
    const canPublish = FF.state.user &&
      (FF.state.user.role === 'super_admin' || FF.state.user.role === 'admin');
    const all = ui.artifacts;
    const rows = all.length
      ? all.map((a) => {
          const isPublished = a.status === 'published';
          const isDraft = a.status === 'draft';
          const isSuperseded = a.status === 'superseded';
          return '<tr>' +
            '<td class="mono">v' + FF.esc(String(a.version)) + '</td>' +
            '<td>' + statusPill(a.status) + '</td>' +
            '<td class="mono" title="' + FF.esc(a.sha256 || '') + '">' +
              FF.esc((a.sha256 || '').slice(0, 10)) + '…</td>' +
            '<td>' + FF.esc(a.created_by_name || 'System') + '</td>' +
            '<td class="mono">' + when(a.created_at) + '</td>' +
            '<td>' + (canPublish && isDraft
              ? '<button class="btn btn-sm" data-action="publish" data-seed="' + FF.esc(a.id) + '">Publish</button>'
              : canPublish && isSuperseded
                ? '<button class="btn btn-sm btn-ghost" data-action="rollback" data-seed="' + FF.esc(a.id) + '">Roll back</button>'
                : isPublished
                  ? '<span class="muted-note">Live</span>'
                  : '') + '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="6" class="muted-note">No seeds yet.</td></tr>';

    return '<div class="card step-card" style="margin-top:16px">' +
      '<div class="card-head"><div><h3><span class="step-no">4</span> Publish</h3>' +
        '<p>Published seeds reach the app on its next sync. Rolling back republishes an older one.</p></div></div>' +
      '<div class="card-body">' +
        '<label class="field"><span>Reason for the change (required)</span>' +
          '<input id="seed-reason" type="text" maxlength="500" value="' + FF.esc(ui.reason) +
          '" placeholder="e.g. Posting of 17 Jul 2026, row 6 corrected to ₱40"></label>' +
        '<div class="table-wrap" style="margin-top:12px"><table class="table">' +
        '<thead><tr><th>Seed</th><th>Status</th><th>Hash</th><th>Created by</th><th>Created</th><th></th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
      '</div>' +
    '</div>';
  }

  function eventsHtml() {
    if (!ui.events.length) return '';
    const rows = ui.events.slice(0, 12).map((e) =>
      '<tr><td class="mono">' + when(e.occurred_at) + '</td><td>' + FF.esc(e.action) +
      '</td><td>' + FF.esc(e.actor_name || 'System') + '</td><td>' + FF.esc(e.reason || '—') +
      '</td></tr>').join('');
    return '<div class="card" style="margin-top:16px">' +
      '<div class="card-head"><div><h3>Seed events</h3><p>Every compile, publish and rollback.</p></div></div>' +
      '<div class="card-body"><div class="table-wrap"><table class="table">' +
      '<thead><tr><th>When</th><th>Action</th><th>Account</th><th>Reason</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div></div>';
  }

  /* ------------------------------------------------------------------ */
  /* helpers                                                             */
  /* ------------------------------------------------------------------ */

  function canCompile() {
    const user = FF.state.user;
    const Auth = window.FareFairAuth;
    return Boolean(Auth) && Auth.can(user, 'fare.edit', cityId());
  }

  function statusPill(status) {
    const cls = status === 'published' || status === 'applied'
      ? 'pill-live pill-dot'
      : status === 'draft' || status === 'ocr'
        ? 'pill-quiet'
        : '';
    return '<span class="pill ' + cls + '">' + FF.esc(status) + '</span>';
  }

  function when(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return FF.esc(date.toISOString().slice(0, 16).replace('T', ' '));
  }

  function reasonValue() {
    const input = FF.byId('seed-reason');
    return input ? String(input.value || '').trim() : '';
  }

  function requireReason() {
    const value = reasonValue();
    if (value.length < 5) {
      FF.toast('Write a reason of at least 5 characters first.');
      return null;
    }
    ui.reason = value;
    return value;
  }

  /* ------------------------------------------------------------------ */
  /* actions                                                             */
  /* ------------------------------------------------------------------ */

  function wire() {
    const file = FF.byId('ord-file');
    const upload = FF.byId('ord-upload');
    if (upload) upload.addEventListener('click', runUpload);
    if (file) {
      file.addEventListener('change', function () {
        if (file.files && file.files[0]) ui.filename = file.files[0].name;
      });
    }
    FF.qsa('[data-action]', FF.dom.page).forEach((button) => {
      button.addEventListener('click', function () {
        const action = button.getAttribute('data-action');
        if (action === 'apply') runApply();
        if (action === 'validate') runValidate();
        if (action === 'compile') runCompile();
        if (action === 'publish') runPublish(button.getAttribute('data-seed'));
        if (action === 'rollback') runRollback(button.getAttribute('data-seed'));
      });
    });
    const reason = FF.byId('seed-reason');
    if (reason) {
      reason.addEventListener('input', function () {
        ui.reason = reason.value;
      });
    }
  }

  async function runUpload() {
    const input = FF.byId('ord-file');
    const file = input && input.files && input.files[0];
    if (!file) {
      FF.toast('Choose a .docx or .pdf first.');
      return;
    }
    ui.busy = true;
    render();
    try {
      const buffer = await file.arrayBuffer();
      const url = Api.base().replace(/\/+$/, '') +
        '/v1/admin/cities/' + encodeURIComponent(cityId()) +
        '/ordinances?vehicleId=' + encodeURIComponent(ui.vehicleId) +
        '&filename=' + encodeURIComponent(file.name);
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          authorization: 'Bearer ' + Api.token(),
        },
        body: buffer,
      });
      const json = await response.json().catch(function () { return null; });
      if (!response.ok) {
        throw new Error((json && json.error && json.error.message) || 'Upload failed.');
      }
      await load();
    } catch (error) {
      ui.message = { kind: 'warn', text: describe(error) };
    } finally {
      ui.busy = false;
      render();
    }
  }

  function reviewedRows() {
    const rows = uploadRows();
    const amounts = {};
    FF.qsa('.ord-amount', FF.dom.page).forEach(function (input) {
      const row = input.getAttribute('data-row');
      const field = input.getAttribute('data-field');
      amounts[row] = amounts[row] || {};
      amounts[row][field] = input.value;
    });
    return rows.map(function (row) {
      const values = amounts[String(row.row_number)] || {};
      const regular = Number(String(values.regular || row.regular).replace(',', '.'));
      const discounted = values.discounted
        ? Number(String(values.discounted).replace(',', '.'))
        : null;
      return {
        row: row.row_number,
        from: row.from_label,
        to: row.to_label,
        regular: Number.isFinite(regular) ? regular : Number(row.regular),
        discounted: discounted !== null && Number.isFinite(discounted) ? discounted : null,
        remark: row.remark || '',
      };
    });
  }

  async function runApply() {
    if (!ui.upload) return;
    const reason = requireReason();
    if (!reason) return;
    ui.busy = true;
    render();
    try {
      const result = await Api.post(
        '/v1/admin/ordinance-uploads/' + encodeURIComponent(ui.upload.id) + '/apply',
        { reason: reason, rows: reviewedRows() },
      );
      ui.message = {
        kind: 'success',
        text: 'Applied ' + result.updated + ' update(s) and ' + result.inserted +
          ' new row(s). Next: compile a seed.',
      };
      await load();
    } catch (error) {
      ui.message = { kind: 'warn', text: describe(error) };
    } finally {
      ui.busy = false;
      render();
    }
  }

  async function runValidate() {
    ui.busy = true;
    render();
    try {
      ui.checks = await validateRemote();
      ui.message = null;
    } catch (error) {
      ui.message = { kind: 'warn', text: describe(error) };
    } finally {
      ui.busy = false;
      render();
    }
  }

  async function runCompile() {
    const reason = requireReason();
    if (!reason) return;
    ui.busy = true;
    render();
    try {
      await Api.post(
        `/v1/admin/cities/${encodeURIComponent(cityId())}/seeds/compile`,
        { vehicleId: ui.vehicleId, reason: reason },
      );
      ui.message = { kind: 'success', text: 'Seed compiled. Publish it below.' };
      await load();
    } catch (error) {
      ui.message = { kind: 'warn', text: describe(error) };
    } finally {
      ui.busy = false;
      render();
    }
  }

  async function runPublish(seedId) {
    const reason = requireReason();
    if (!reason || !seedId) return;
    ui.busy = true;
    render();
    try {
      await Api.post(`/v1/admin/seeds/${encodeURIComponent(seedId)}/publish`, { reason });
      ui.message = { kind: 'success', text: 'Published. Clients receive it on their next sync.' };
      await load();
    } catch (error) {
      ui.message = { kind: 'warn', text: describe(error) };
    } finally {
      ui.busy = false;
      render();
    }
  }

  async function runRollback(seedId) {
    const reason = requireReason();
    if (!reason || !seedId) return;
    ui.busy = true;
    render();
    try {
      await Api.post(`/v1/admin/seeds/${encodeURIComponent(seedId)}/rollback`, { reason });
      ui.message = { kind: 'success', text: 'Rolled back. The older seed is live again.' };
      await load();
    } catch (error) {
      ui.message = { kind: 'warn', text: describe(error) };
    } finally {
      ui.busy = false;
      render();
    }
  }

  FF.pages.seeds = function renderSeeds() {
    if (!ui.loaded) {
      FF.dom.page.innerHTML = '<div class="page-loading"><span class="spinner"></span> Reading fare seeds.</div>';
      load();
      return;
    }
    render();
    load();
  };
})();
