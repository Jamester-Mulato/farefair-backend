/* Tiny API client for the FareFair Admin Console.
 *
 * The console is served either by the API itself (/admin/) or by a static
 * server (web/admin/serve.mjs). Resolution order for the API origin:
 *   1. ?api=<url>                     (also remembered)
 *   2. previously remembered origin
 *   3. the page origin                (same-origin when served by the API)
 *   4. http://localhost:4000          (this repo's dev server)
 *
 * Session tokens are kept in sessionStorage; the server only stores their
 * SHA-256 digest. Every admin write endpoint requires the bearer token.
 */
(function (global) {
  'use strict';

  const TOKEN_KEY = 'farefair.admin.token.v1';
  const BASE_KEY = 'farefair.admin.api.v1';
  const DEFAULT_BASE = 'http://localhost:4000';

  let base = null;
  let online = false;
  let initializing = null;

  function normalize(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function fromQuery() {
    try {
      return normalize(new URLSearchParams(global.location.search).get('api'));
    } catch {
      return '';
    }
  }

  function remembered() {
    try {
      return normalize(global.localStorage.getItem(BASE_KEY));
    } catch {
      return '';
    }
  }

  function remember(value) {
    try {
      if (value) global.localStorage.setItem(BASE_KEY, value);
    } catch {
      /* storage disabled */
    }
  }

  function candidates() {
    const list = [];
    const push = (value) => {
      const normalized = normalize(value);
      if (normalized && list.indexOf(normalized) === -1) list.push(normalized);
    };
    push(fromQuery());
    push(remembered());
    if (global.location.protocol === 'http:' || global.location.protocol === 'https:') push('');
    push(DEFAULT_BASE);
    return list;
  }

  async function probe(candidate, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 4000);
    try {
      const response = await fetch(candidate + '/health', {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const body = await response.json();
      return body && body.service === 'farefair-api';
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  function init() {
    if (initializing) return initializing;
    initializing = (async () => {
      const queryBase = fromQuery();
      for (const candidate of candidates()) {
        if (await probe(candidate)) {
          base = candidate;
          online = true;
          remember(candidate || global.location.origin);
          return true;
        }
      }
      base = normalize(remembered()) || DEFAULT_BASE;
      online = false;
      return false;
    })();
    return initializing;
  }

  function token() {
    try {
      return global.sessionStorage.getItem(TOKEN_KEY) || '';
    } catch {
      return '';
    }
  }

  function setToken(value) {
    try {
      if (value) global.sessionStorage.setItem(TOKEN_KEY, value);
      else global.sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* storage disabled */
    }
  }

  class ApiClientError extends Error {
    constructor(message, status, code, details) {
      super(message);
      this.name = 'ApiClientError';
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  async function request(method, path, body, options) {
    if (!initializing && !online) await init();
    const opts = options || {};
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const current = token();
    if (current) headers.Authorization = 'Bearer ' + current;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs || 10000);
    let response;
    try {
      response = await fetch(normalize(base) + path, {
        method,
        headers,
        cache: 'no-store',
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ApiClientError(
        'Cannot reach the FareFair API at ' + (base || DEFAULT_BASE) + '.',
        0,
        'NETWORK_ERROR',
        String(error && error.message ? error.message : error)
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const detail = payload && payload.error ? payload.error : {};
      throw new ApiClientError(
        detail.message || 'Request failed with HTTP ' + response.status + '.',
        response.status,
        detail.code || 'HTTP_ERROR',
        detail.details
      );
    }
    return payload;
  }

  async function login(loginValue, password) {
    const result = await request('POST', '/v1/auth/login', {
      login: loginValue,
      password,
    });
    setToken(result.token);
    return result;
  }

  async function logout() {
    try {
      if (token()) await request('POST', '/v1/auth/logout', {});
    } catch {
      /* revocation is best-effort; the token also expires server-side */
    }
    setToken('');
  }

  async function me() {
    if (!token()) return null;
    try {
      const result = await request('GET', '/v1/auth/me');
      return result.user;
    } catch (error) {
      if (error.status === 401) setToken('');
      return null;
    }
  }

  function isLive() {
    return online && Boolean(token());
  }

  global.FareFairApi = {
    init,
    base: () => base,
    online: () => online,
    live: isLive,
    token,
    setToken,
    request,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    put: (path, body) => request('PUT', path, body),
    login,
    logout,
    me,
    ApiClientError,
    DEFAULT_BASE,
  };
})(window);
