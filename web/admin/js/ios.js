/* FareFair Admin — iOS motion module.
 *
 * Deliberately small and defensive: it never reads or writes application
 * state, only decorates what the console already renders. If Lottie fails to
 * load, or the browser lacks any API used here, the console behaves exactly
 * as it did before.
 */
(function (global) {
  'use strict';

  var reduceMotion =
    global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var animations = null; // { pulse, check }
  var loading = null;
  var lastRoute = null;

  function asset(name) {
    return new URL('animations/' + name + '.json', document.baseURI).href;
  }

  function loadAnimations() {
    if (loading) return loading;
    loading = Promise.all([
      fetch(asset('pulse')).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch(asset('check')).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    ]).then(function (pair) {
      animations = { pulse: pair[0], check: pair[1] };
      decorate();
      return animations;
    });
    return loading;
  }

  function mount(target, data, opts) {
    if (!target || !data || !global.lottie) return null;
    var box = document.createElement('div');
    box.className = 'ios-lottie';
    box.setAttribute('aria-hidden', 'true');
    if (opts && opts.size) {
      box.style.width = opts.size + 'px';
      box.style.height = opts.size + 'px';
    }
    target.insertBefore(box, target.firstChild);
    try {
      return global.lottie.loadAnimation({
        container: box,
        renderer: 'svg',
        loop: Boolean(opts && opts.loop),
        autoplay: true,
        animationData: data,
      });
    } catch (error) {
      box.remove();
      return null;
    }
  }

  /* ---- KPI numbers count up once per render ------------------------- */
  function countUp(el) {
    var first = el.firstChild;
    if (!first || first.nodeType !== 3) return;
    var raw = first.nodeValue.trim();
    if (!/^[0-9]{1,6}$/.test(raw)) return;
    var target = Number(raw);
    if (target === 0) return;

    el.dataset.iosCounted = '1';
    var started = null;
    var duration = 760;

    function frame(now) {
      if (started === null) started = now;
      var t = Math.min(1, (now - started) / duration);
      var eased = 1 - Math.pow(1 - t, 3);
      first.nodeValue = String(Math.round(target * eased));
      if (t < 1) requestAnimationFrame(frame);
      else first.nodeValue = raw;
    }
    requestAnimationFrame(frame);
  }

  function animatePage() {
    var page = document.getElementById('page');
    if (!page || reduceMotion) return;
    page.classList.remove('ios-enter');
    // Force a style flush so the animation can be replayed on the same node.
    void page.offsetWidth;
    page.classList.add('ios-enter');
  }

  function decorate() {
    if (!animations) return;

    var page = document.getElementById('page');
    if (page) {
      var route = global.location.hash || '#overview';
      var changed = route !== lastRoute;
      if (changed) {
        lastRoute = route;
        if (!reduceMotion) animatePage();
        Array.prototype.forEach.call(page.querySelectorAll('.kpi-value'), function (el) {
          if (!el.dataset.iosCounted) countUp(el);
        });
      }

      Array.prototype.forEach.call(page.querySelectorAll('.empty:not([data-ios-orb])'), function (el) {
        el.setAttribute('data-ios-orb', '1');
        mount(el, animations.pulse, { loop: true, size: 84 });
      });
    }

    var pill = document.getElementById('data-source-pill');
    if (pill && !pill.querySelector('.ios-lottie')) {
      pill.classList.add('has-lottie');
      mount(pill, animations.pulse, { loop: true, size: 15 });
    }
  }

  /* ---- toasts: a drawn check for success ---------------------------- */
  function watchToasts() {
    var host = document.getElementById('toasts');
    if (!host) return;
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes, function (node) {
          if (!node || node.nodeType !== 1) return;
          if (!/toast/.test(node.className)) return;
          if (/ok|success/.test(node.className) && animations && animations.check) {
            mount(node, animations.check, { loop: false, size: 20 });
          }
        });
      });
    }).observe(host, { childList: true });
  }

  /* ---- wiring -------------------------------------------------------- */
  function start() {
    loadAnimations();
    watchToasts();

    var host = document.getElementById('app-view') || document.body;
    var timer = null;
    new MutationObserver(function (records) {
      // Lottie rewrites its own SVG constantly; those mutations are noise.
      var relevant = records.some(function (r) {
        return !(r.target && r.target.closest && r.target.closest('.ios-lottie'));
      });
      if (!relevant) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(decorate, 60);
    }).observe(host, { childList: true, subtree: true });
    global.addEventListener('hashchange', function () {
      setTimeout(decorate, 60);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  global.FareFairIos = { decorate: decorate };
})(window);
