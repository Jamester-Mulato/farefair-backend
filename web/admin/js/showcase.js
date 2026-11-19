/* Command palette for the admin console.
 * The nav is a handful of routes, so a keyboard-first switcher (Ctrl/Cmd+K)
 * is the cheapest way to make the console feel like a real app rather than a
 * set of pages. It reads the existing sidebar buttons; nothing is duplicated.
 */
(function () {
  'use strict';

  const FF = window.FF;
  if (!FF) return;

  let panel = null;
  let input = null;
  let list = null;
  let items = [];
  let active = 0;

  function routes() {
    return Array.prototype.slice
      .call(document.querySelectorAll('.nav-item[data-route]'))
      .filter(function (button) { return !button.hidden; })
      .map(function (button) {
        const label = button.querySelector('span:not(.nav-count)');
        return {
          route: button.getAttribute('data-route'),
          label: label ? label.textContent.trim() : button.textContent.trim(),
          button: button,
        };
      });
  }

  function build() {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'cmdk';
    panel.innerHTML =
      '<div class="cmdk-panel" role="dialog" aria-label="Command palette">' +
        '<input class="cmdk-input" type="text" placeholder="Jump to…" aria-label="Search pages">' +
        '<div class="cmdk-list" role="listbox"></div>' +
        '<div class="cmdk-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span>' +
        '<span><kbd>↵</kbd> open</span><span><kbd>esc</kbd> close</span></div>' +
      '</div>';
    document.body.appendChild(panel);
    input = panel.querySelector('.cmdk-input');
    list = panel.querySelector('.cmdk-list');

    panel.addEventListener('click', function (event) {
      if (event.target === panel) close();
    });
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
      else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
      else if (event.key === 'Enter') { event.preventDefault(); choose(); }
      else if (event.key === 'Escape') { event.preventDefault(); close(); }
    });
  }

  function open() {
    build();
    const all = routes();
    if (!all.length) return;
    panel.classList.add('open');
    input.value = '';
    render('');
    setTimeout(function () { input.focus(); }, 30);
  }

  function close() {
    if (panel) panel.classList.remove('open');
  }

  function filtered(query) {
    const needle = String(query || '').trim().toLowerCase();
    const all = routes();
    if (!needle) return all;
    return all.filter(function (item) {
      return item.label.toLowerCase().indexOf(needle) !== -1;
    });
  }

  function render(query) {
    items = filtered(query);
    active = 0;
    list.innerHTML = items.length
      ? items.map(function (item, index) {
          return '<div class="cmdk-item" role="option" data-index="' + index + '"' +
            (index === active ? ' data-active="true"' : '') + '>' +
            '<span>' + escapeHtml(item.label) + '</span>' +
            '<small>' + escapeHtml(item.route) + '</small></div>';
        }).join('')
      : '<div class="cmdk-item" style="color:#8a938d;cursor:default">No page matches that.</div>';

    Array.prototype.forEach.call(list.querySelectorAll('.cmdk-item[data-index]'), function (row) {
      row.addEventListener('click', function () {
        const index = Number(row.getAttribute('data-index'));
        active = index;
        choose();
      });
    });
  }

  function move(delta) {
    if (!items.length) return;
    active = (active + delta + items.length) % items.length;
    Array.prototype.forEach.call(list.querySelectorAll('.cmdk-item[data-index]'), function (row) {
      const index = Number(row.getAttribute('data-index'));
      if (index === active) row.setAttribute('data-active', 'true');
      else row.removeAttribute('data-active');
    });
    const current = list.querySelector('[data-active="true"]');
    if (current && current.scrollIntoView) current.scrollIntoView({ block: 'nearest' });
  }

  function choose() {
    const item = items[active];
    if (!item) return;
    close();
    if (typeof FF.navigate === 'function') FF.navigate(item.route);
    else item.button.click();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function addTrigger() {
    const actions = document.querySelector('.topbar-actions');
    if (!actions || document.getElementById('cmdk-trigger')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'cmdk-trigger';
    button.className = 'pill pill-quiet';
    button.style.cssText = 'cursor:pointer;gap:8px';
    button.innerHTML = '<span>Jump to</span><kbd style="font-family:var(--mono);font-size:10px;border:1px solid var(--line);border-radius:4px;padding:0 4px;background:#fff">⌘K</kbd>';
    button.addEventListener('click', open);
    actions.insertBefore(button, actions.firstChild);
  }

  document.addEventListener('keydown', function (event) {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'k') {
      event.preventDefault();
      if (panel && panel.classList.contains('open')) close();
      else open();
    }
    if (event.key === 'Escape') close();
  });

  // The shell is built after login; wait for it instead of assuming.
  const observer = new MutationObserver(function () {
    if (document.querySelector('.topbar-actions')) {
      addTrigger();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  window.FareFairPalette = { open: open, close: close };
})();
