/* FareFair Admin Console — login and application bootstrap. */
(function () {
  'use strict';

  const FF = window.FF;
  const Auth = window.FareFairAuth;
  const Data = window.FareFairData;
  if (!FF || !Auth || !Data) return;

  const state = FF.state;
  const ui = FF.ui;
  const dom = FF.dom;
  const KEYS = FF.KEYS;

  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 60 * 1000;

  const loginForm = FF.byId('login-form');
  const usernameInput = FF.byId('login-username');
  const passwordInput = FF.byId('login-password');
  const togglePassword = FF.byId('toggle-password');
  const loginError = FF.byId('login-error');
  const loginSubmit = FF.byId('login-submit');
  const loginSubmitLabel = FF.byId('login-submit-label');
  const loginSpinner = FF.byId('login-spinner');
  const demoAccess = FF.byId('demo-access');

  let loginBusy = false;
  let lockoutTimer = null;
  let lockoutNotice = false;
  let passwordVisible = false;

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function setLoginError(message) {
    if (!message) {
      loginError.hidden = true;
      loginError.textContent = '';
      return;
    }
    loginError.hidden = false;
    loginError.textContent = message;
  }

  function setLoginBusy(busy) {
    loginBusy = busy;
    loginSubmit.disabled = busy;
    loginSpinner.hidden = !busy;
    loginSubmitLabel.textContent = busy ? 'Verifying…' : 'Sign in';
    loginForm.setAttribute('aria-busy', busy ? 'true' : 'false');
  }

  function setPasswordVisibility(visible) {
    passwordVisible = visible;
    passwordInput.type = visible ? 'text' : 'password';
    togglePassword.setAttribute('aria-pressed', visible ? 'true' : 'false');
    togglePassword.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
    togglePassword.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-' +
      (visible ? 'eye-off' : 'eye') + '"/></svg>';
  }

  /* ------------------------------------------------------------------ */
  /* Lockout                                                             */
  /* ------------------------------------------------------------------ */

  function getLockout() {
    const raw = FF.readJson('localStorage', KEYS.lockout, null);
    return {
      count: Number(raw && raw.count) || 0,
      until: Number(raw && raw.until) || 0,
    };
  }

  function setLockout(lock) {
    if (!lock.until && !lock.count) FF.removeKey('localStorage', KEYS.lockout);
    else FF.writeJson('localStorage', KEYS.lockout, lock);
  }

  function updateLockoutCountdown() {
    const lock = getLockout();
    const remaining = Math.max(0, Math.ceil((lock.until - Date.now()) / 1000));
    if (remaining > 0) {
      lockoutNotice = true;
      loginSubmit.disabled = true;
      setLoginError('Too many failed attempts. Try again in ' + remaining + 's.');
      return;
    }
    if (lock.until) FF.removeKey('localStorage', KEYS.lockout);
    if (lockoutNotice) {
      lockoutNotice = false;
      setLoginError('');
    }
    if (!loginBusy) loginSubmit.disabled = false;
    if (lockoutTimer) {
      clearInterval(lockoutTimer);
      lockoutTimer = null;
    }
  }

  function startLockoutCountdown() {
    if (lockoutTimer) clearInterval(lockoutTimer);
    updateLockoutCountdown();
    if (getLockout().until > Date.now()) {
      lockoutTimer = setInterval(updateLockoutCountdown, 1000);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Views                                                               */
  /* ------------------------------------------------------------------ */

  function closeAccountMenu() {
    dom.accountMenu.hidden = true;
    dom.accountBtn.setAttribute('aria-expanded', 'false');
  }

  function closeMobileNav() {
    document.body.classList.remove('sidebar-open');
    dom.sidebarBackdrop.hidden = true;
    dom.menuBtn.setAttribute('aria-expanded', 'false');
  }

  function showLogin() {
    dom.appView.hidden = true;
    dom.loginView.hidden = false;
    document.title = 'FareFair Admin Console';
    setLoginBusy(false);
    setLoginError('');
    lockoutNotice = false;
    passwordInput.value = '';
    usernameInput.value = FF.readJson('localStorage', KEYS.lastUser, '') || '';
    setPasswordVisibility(false);
    startLockoutCountdown();
    setTimeout(function () {
      (usernameInput.value ? passwordInput : usernameInput).focus();
    }, 60);
  }

  function endSession(message, tone) {
    const api = window.FareFairApi;
    const live = api && api.live();
    if (state.user && !live) FF.audit('auth.logout', 'Signed out of the admin console');
    if (api) api.logout().catch(function () { /* token expires server-side */ });
    state.user = null;
    state.session = null;
    FF.removeKey('sessionStorage', KEYS.session);
    if (state.sessionTimer) {
      clearInterval(state.sessionTimer);
      state.sessionTimer = null;
    }
    if (lockoutTimer) {
      clearInterval(lockoutTimer);
      lockoutTimer = null;
    }
    closeAccountMenu();
    closeMobileNav();
    FF.closeModal();
    showLogin();
    if (message) FF.toast(message, tone || 'info', 5000);
  }

  function toAdminUser(user) {
    return {
      id: user.id,
      name: user.displayName || user.name || user.email,
      username: user.username || String(user.email || '').split('@')[0],
      email: user.email,
      role: Data.mapRole(user.role),
      title: user.title || 'Administrator',
      scope: Array.isArray(user.cityScope) && user.cityScope.length
        ? user.cityScope.slice()
        : [],
    };
  }

  async function openConsole(user) {
    state.user = user;
    dom.loginView.hidden = true;
    dom.appView.hidden = false;
    closeAccountMenu();
    closeMobileNav();
    FF.fillChrome();
    FF.startSessionWatch();
    FF.setDataSourcePill();
    state.route = FF.routeFromHash();
    if (!state.data) {
      await FF.loadDataAndRender();
    } else {
      FF.renderRoute();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Login                                                               */
  /* ------------------------------------------------------------------ */

  async function handleLogin(event) {
    event.preventDefault();
    if (loginBusy) return;

    const lock = getLockout();
    if (lock.until > Date.now()) {
      startLockoutCountdown();
      return;
    }

    const loginValue = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!loginValue || !password) {
      setLoginError('Enter both your username and password.');
      (loginValue ? passwordInput : usernameInput).focus();
      return;
    }

    setLoginError('');
    setLoginBusy(true);

    const api = window.FareFairApi;
    let online = false;
    try {
      if (api) {
        await api.init();
        online = api.online();
      }
    } catch (error) {
      online = false;
    }

    function registerFailure(reason) {
      const current = getLockout();
      current.count += 1;
      if (current.count >= MAX_ATTEMPTS) {
        setLockout({ count: 0, until: Date.now() + LOCKOUT_MS });
        if (!online) {
          FF.audit(
            'auth.locked',
            'Locked sign-in for 60 seconds after repeated failures for "' + loginValue + '"',
            { actorName: loginValue, role: 'guest' }
          );
        }
        setLoginBusy(false);
        passwordInput.value = '';
        setLoginError('Too many failed attempts. Try again in ' + (LOCKOUT_MS / 1000) + 's.');
        startLockoutCountdown();
        return;
      }
      setLockout(current);
      const left = MAX_ATTEMPTS - current.count;
      if (!online) {
        FF.audit(
          'auth.failed',
          'Failed sign-in attempt for "' + loginValue + '"',
          { actorName: loginValue, role: 'guest' }
        );
      }
      setLoginBusy(false);
      setLoginError(
        (reason || 'Incorrect email or password.') + ' ' +
        left + ' attempt' + (left === 1 ? '' : 's') + ' remaining.'
      );
      passwordInput.value = '';
      passwordInput.focus();
    }

    try {
      let user = null;

      if (online) {
        try {
          const result = await api.login(loginValue, password);
          user = toAdminUser(result.user);
        } catch (error) {
          if (error && error.status === 429) {
            setLockout({ count: 0, until: Date.now() + LOCKOUT_MS });
            setLoginBusy(false);
            passwordInput.value = '';
            setLoginError(error.message || 'Too many attempts. Try again shortly.');
            startLockoutCountdown();
            return;
          }
          if (error && (error.status === 401 || error.status === 0)) {
            registerFailure('Incorrect email or password.');
            return;
          }
          throw error;
        }
      } else {
        setLoginBusy(false);
        setLoginError(
          'The FareFair API is not reachable. Locally, start it with npm start in backend/. ' +
            'If it is hosted, the first request after idle can take up to a minute - try again.'
        );
        return;
      }

      FF.removeKey('localStorage', KEYS.lockout);
      lockoutNotice = false;
      setLoginBusy(false);
      setLoginError('');
      state.user = user;
      FF.issueSession(user);
      FF.writeJson('localStorage', KEYS.lastUser, user.username);
      if (!online) FF.audit('auth.login', 'Signed in to the admin console');
      loginForm.reset();
      passwordInput.value = '';
      await openConsole(user);
      FF.toast('Signed in as ' + user.name + '.');
    } catch (error) {
      setLoginBusy(false);
      setLoginError(
        (error && error.message) ||
        'Something went wrong while verifying your credentials. Please try again.'
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Account dialog                                                      */
  /* ------------------------------------------------------------------ */

  function detailItem(label, value) {
    return '<div class="detail-item"><dt>' + FF.esc(label) + '</dt><dd>' + value + '</dd></div>';
  }

  function openAccountModal() {
    const user = state.user;
    if (!user) return;
    closeAccountMenu();
    const session = state.session;
    const role = Auth.roleInfo(user.role);

    const body =
      '<div class="account-card">' +
        '<div class="avatar">' + FF.esc(Auth.initials(user.name)) + '</div>' +
        '<div><h3>' + FF.esc(user.name) + '</h3><p>' + FF.esc(user.title) + ' · ' + FF.esc(role.short) + '</p></div>' +
      '</div>' +
      '<dl class="detail-grid" style="margin-top:16px">' +
        detailItem('Username', '<span class="mono">' + FF.esc(user.username) + '</span>') +
        detailItem('Email', FF.esc(user.email)) +
        detailItem('Scope', FF.esc(FF.scopeLabel(user))) +
        detailItem('Session issued', FF.esc(session ? Data.formatDateTime(new Date(session.issuedAt)) : '—')) +
        detailItem('Expires', FF.esc(session ? Data.formatDateTime(new Date(session.expiresAt)) : '—')) +
        detailItem('Role', FF.esc(role.label)) +
      '</dl>' +
      '<div style="margin-top:16px">' +
        FF.notice('info',
          'This session was issued by the FareFair API and is stored only in this tab. ' +
          'Sessions end after 30 minutes of inactivity or 8 hours total.') +
      '</div>';

    FF.openModal({
      eyebrow: 'Signed-in account',
      title: user.name,
      body: body,
      footer:
        '<button type="button" class="btn btn-outline" data-modal-close>Close</button>' +
        '<button type="button" class="btn btn-danger" id="account-signout">' + FF.icon('logout') + ' Sign out</button>',
      onMount: function (modal) {
        const button = modal.querySelector('#account-signout');
        if (button) button.addEventListener('click', function () {
          FF.closeModal();
          endSession('You have been signed out.', 'info');
        });
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Event wiring                                                        */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    loginForm.addEventListener('submit', handleLogin);

    togglePassword.addEventListener('click', function () {
      setPasswordVisibility(!passwordVisible);
      passwordInput.focus({ preventScroll: true });
    });

    FF.qsa('.nav-item', dom.sidebarNav).forEach(function (button) {
      button.addEventListener('click', function () {
        closeMobileNav();
        closeAccountMenu();
        FF.navigate(button.getAttribute('data-route'));
        dom.page.focus({ preventScroll: true });
      });
    });

    dom.sidebarLogout.addEventListener('click', function () {
      endSession('You have been signed out.', 'info');
    });

    dom.dropdownLogout.addEventListener('click', function () {
      closeAccountMenu();
      endSession('You have been signed out.', 'info');
    });

    dom.dropdownAccount.addEventListener('click', openAccountModal);

    dom.accountBtn.addEventListener('click', function () {
      const willOpen = dom.accountMenu.hidden;
      closeAccountMenu();
      if (willOpen) {
        dom.accountMenu.hidden = false;
        dom.accountBtn.setAttribute('aria-expanded', 'true');
      }
    });

    document.addEventListener('click', function (event) {
      const wrap = dom.accountBtn.parentElement;
      if (wrap && !wrap.contains(event.target)) closeAccountMenu();
    });

    dom.menuBtn.addEventListener('click', function () {
      const open = !document.body.classList.contains('sidebar-open');
      document.body.classList.toggle('sidebar-open', open);
      dom.sidebarBackdrop.hidden = !open;
      dom.menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    const drawerClose = FF.byId('drawer-close');
    if (drawerClose) drawerClose.addEventListener('click', closeMobileNav);

    const syncScrolled = function () {
      document.body.classList.toggle('is-scrolled', window.scrollY > 6);
    };
    window.addEventListener('scroll', syncScrolled, { passive: true });
    syncScrolled();

    dom.sidebarBackdrop.addEventListener('click', closeMobileNav);

    dom.modalClose.addEventListener('click', FF.closeModal);
    dom.modal.addEventListener('click', function (event) {
      if (event.target === dom.modal) FF.closeModal();
    });

    dom.reviewLink.addEventListener('click', function () {
      ui.cityStatus = 'provisional';
      FF.navigate('cities');
    });

    window.addEventListener('hashchange', function () {
      if (!state.user) return;
      state.route = FF.routeFromHash();
      FF.renderRoute();
      dom.page.focus({ preventScroll: true });
    });

    document.addEventListener('pointerdown', FF.touchSession, { passive: true });
    document.addEventListener('keydown', FF.touchSession);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) FF.touchSession();
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 1024) closeMobileNav();
    });

    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeAccountMenu();
        closeMobileNav();
      }
    });
  }

  FF.showLogin = showLogin;
  FF.endSession = endSession;
  FF.openConsole = openConsole;

  bindEvents();

  try {
    if (new URLSearchParams(window.location.search).get('demo') === '1' && demoAccess) {
      demoAccess.open = true;
    }
  } catch (error) { /* ignore */ }

  const restoredSession = FF.restoreSession();
  if (!restoredSession) {
    showLogin();
  } else {
    (async function resume() {
      let restored = restoredSession;
      const api = window.FareFairApi;
      if (api) {
        try {
          await api.init();
          if (api.online()) {
            const me = await api.me();
            if (!me) {
              FF.removeKey('sessionStorage', KEYS.session);
              showLogin();
              setLoginError('Your session expired. Sign in again.');
              return;
            }
            restored = toAdminUser(me);
            state.user = restored;
            if (state.session) state.session.user = restored;
          }
        } catch (error) {
          /* fall through to the saved session when the API is unreachable */
        }
      }
      try {
        await openConsole(restored);
      } catch (error) {
        showLogin();
        setLoginError('Your saved session could not be restored.');
      }
    })();
  }
})();
