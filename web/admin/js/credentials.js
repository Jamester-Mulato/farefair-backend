/* Embedded administrator accounts for the prototype.
 *
 * Passwords are stored only as salted, iterated SHA-256 digests; the plain
 * text exists solely in README.md and in the opt-in "Demo accounts" panel.
 * Verification runs entirely in the browser (see sha256.js).
 *
 * DEMO ONLY. Client-side credentials are a convenience for this static
 * prototype, not a security boundary. A production deployment must verify
 * credentials on a server (Argon2id / bcrypt) and mint a real session.
 */
(function (global) {
  'use strict';

  const USERS = [
    {
      id: 'usr_jamester',
      name: 'Jamester Mulato',
      username: 'jamestermulato',
      email: 'jamestermulato@csucc.eu.ph',
      role: 'super_admin',
      title: 'Transport Administrator',
      scope: ['cabadbaran', 'davao', 'cagayan_de_oro', 'general_santos', 'zamboanga', 'butuan', 'iligan', 'tagum'],
      password: {
        scheme: 'sha256-iterated',
        iterations: 25000,
        salt: '4d34df687338ade1ac70c5f5b0326521',
        hash: '14699289b8da1fee6540ad9f87e0d3d8fec7d99d841c38060e8bee03d253143c',
      },
    },
    {
      id: 'usr_sam',
      name: 'Sam Yangao',
      username: 'samyangao',
      email: 'samyangao@csucc.eu.ph',
      role: 'super_admin',
      title: 'City Data Steward',
      scope: ['cabadbaran', 'davao', 'cagayan_de_oro', 'general_santos', 'zamboanga', 'butuan', 'iligan', 'tagum'],
      password: {
        scheme: 'sha256-iterated',
        iterations: 25000,
        salt: '13276e83980334b607b993f454639624',
        hash: '05ddbb108e24b140bdd9392a80a7b4fb1093140ec981f2e5157f95ac414a12ce',
      },
    },
    {
      id: 'usr_aira',
      name: 'Aira Sandigan',
      username: 'airasandigan',
      email: 'airasandigan@csucc.eu.ph',
      role: 'super_admin',
      title: 'Fare Data Analyst',
      scope: ['cabadbaran', 'davao', 'cagayan_de_oro', 'general_santos', 'zamboanga', 'butuan', 'iligan', 'tagum'],
      password: {
        scheme: 'sha256-iterated',
        iterations: 25000,
        salt: '2a3ae3f3649f0e46f8e8ce4758f0b01a',
        hash: '8bbd222fd77d7c5f9c7da8b5030d642961629311ffff14a87aedbb2ed36e8250',
      },
    },
  ];

  const ROLES = {
    super_admin: {
      label: 'Super administrator',
      short: 'Super admin',
      description: 'Full access to every city dataset, fare matrix, audit trail and console setting.',
    },
    city_admin: {
      label: 'City administrator',
      short: 'City admin',
      description: 'Edits fare matrices and dataset details for assigned cities only.',
    },
    analyst: {
      label: 'Data analyst',
      short: 'Analyst',
      description: 'Read-only access to datasets and trip records, with CSV exports.',
    },
  };

  // Used to keep failed-login timing roughly constant for unknown usernames.
  const DUMMY_HASH = {
    scheme: 'sha256-iterated',
    iterations: 25000,
    salt: '0000000000000000f00dfeedc0ffee00',
    hash: '0'.repeat(64),
  };

  const crypto = global.FareFairCrypto;

  // Accounts returned by GET /v1/auth/accounts after a server sign-in. When
  // present they replace the embedded demo list everywhere in the console.
  let serverAccounts = null;

  function normalizeLogin(value) {
    return String(value || '').trim().toLowerCase();
  }

  function findUser(login) {
    const needle = normalizeLogin(login);
    if (!needle) return null;
    return USERS.find((user) => user.username === needle || user.email.toLowerCase() === needle) || null;
  }

  function initials(name) {
    return String(name || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('');
  }

  function verify(login, password) {
    const user = findUser(login);
    const record = user ? user.password : DUMMY_HASH;
    const computed = crypto.iteratedSha256Hex(record.salt, String(password == null ? '' : password), record.iterations);
    const matches = crypto.constantTimeEqualHex(computed, record.hash);
    return { ok: Boolean(user) && matches, user: user || null };
  }

  function can(user, action, cityId) {
    if (!user) return false;
    switch (action) {
      case 'city.edit':
      case 'fare.edit':
        return user.role === 'super_admin'
          || (user.role === 'city_admin' && user.scope.indexOf(cityId) !== -1);
      case 'city.activate':
      case 'settings.view':
      case 'settings.reset':
      case 'accounts.view':
        return user.role === 'super_admin';
      case 'audit.view':
        return user.role === 'super_admin' || user.role === 'city_admin';
      case 'export':
      case 'city.view':
      case 'fare.view':
      case 'ordinance.view':
      case 'trip.view':
        return true;
      default:
        return false;
    }
  }

  function inScope(user, cityId) {
    if (!user) return false;
    return user.role === 'super_admin' || user.scope.indexOf(cityId) !== -1;
  }

  function publicAccounts() {
    return USERS.map((user) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
      title: user.title,
      scope: user.scope.slice(),
      initials: initials(user.name),
    }));
  }

  function accounts() {
    if (serverAccounts) return serverAccounts.slice();
    return publicAccounts();
  }

  function setAccounts(list) {
    if (!Array.isArray(list) || !list.length) {
      serverAccounts = null;
      return;
    }
    serverAccounts = list.map((account) => ({
      id: account.id,
      name: account.name || account.displayName || account.email,
      username: account.username || String(account.email || '').split('@')[0],
      email: account.email,
      role: account.role,
      title: account.title || 'Administrator',
      scope: Array.isArray(account.scope) ? account.scope.slice() : [],
      initials: initials(account.name || account.email),
    }));
  }

  global.FareFairAuth = {
    ROLES,
    accounts,
    setAccounts,
    findUser,
    verify,
    can,
    inScope,
    initials,
    roleInfo(role) { return ROLES[role] || { label: role, short: role, description: '' }; },
  };
})(window);
