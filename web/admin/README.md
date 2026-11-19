# FareFair Admin Console

A web dashboard for FareFair. It manages the Cabadbaran City dataset, the official tricycle fare
matrix, ordinances and trip records, and it is wired to the FareFair API and PostgreSQL: what you
see comes from `/v1`, and what you save is written to the database.

Plain HTML, CSS and JavaScript — no build step, no dependencies, no framework.

## Run it

Start the API first (it serves this folder at `/admin/`):

```powershell
cd backend
npm run db:reset     # once, or whenever you want pristine seed data
npm start
```

Then open <http://localhost:4000/admin/>. The console and the API share an origin, so its
requests are same-origin and no CORS setup is needed.

You can also serve the folder separately while editing it:

```powershell
node web/admin/serve.mjs        # http://localhost:8080/web/admin/
```

In that case the console probes `http://localhost:4000` for the API (or `?api=http://host:port`)
and remembers the working origin. The console is API-only: if the API cannot be reached the login
screen reports it and no data or writes are simulated locally.

## Sign in

Authentication happens on the server against `admin_users` (scrypt hashes) and issues an opaque
token that is kept in `sessionStorage` for this tab only. The seeded accounts all use the
password `farefair`:

| Person | Login | Console role | Scope |
| --- | --- | --- | --- |
| FareFair Administrator | `admin@farefair.local` | Super admin | All seeded cities (Cabadbaran) |
| Cabadbaran LGU Editor | `lgu@farefair.local` | City admin | Cabadbaran only |
| FareFair Analyst | `analyst@farefair.local` | Analyst | Read-only, Cabadbaran |

Sessions last 8 hours on the server and end after 30 minutes of inactivity in the UI. Five failed
attempts lock the login for 15 minutes. Signing out revokes the session server-side, so the old
token stops working immediately.

## What is live, and what is local

| Feature | Storage |
| --- | --- |
| City datasets, vehicles, ordinances, fares | `GET /v1/cities`, `/v1/cities/:id` (PostgreSQL) |
| Official fare routes (68 rows) | `GET /v1/cities/:cityId/fare-routes` |
| Trip explorer | `GET /v1/trips` (paginated, up to 200/page) |
| Audit trail | `GET /v1/audit`; writes go through the API |
| Seeded accounts | `GET /v1/auth/accounts` (administrators only) |
| Fare matrix edits | `PUT /v1/admin/cities/:cityId/fare-matrix/:vehicleId` |
| Official fare-route edits | `PUT /v1/admin/cities/:cityId/fare-routes/:rowNumber` |
| Live city | `POST /v1/admin/cities/:cityId/activate` |
| Console events | `POST /v1/admin/audit` |
| Draft values, last-used login, lockout timer | Browser storage (cosmetic only) |

PostgreSQL is the single source of truth. `assets/data/` and `js/snapshot.js` are not read by the
console; there is no offline read path or browser fare override. Edits are either written to
PostgreSQL or refused, and the Fare Routes page reloads the matrix from the API after every save.

## Permissions

| Action | Super admin | City admin (in scope) | Analyst |
| --- | --- | --- | --- |
| Browse cities, trips, analytics, ordinances | yes | yes | yes |
| Edit fare matrix and official routes | yes | yes | no |
| Activate the live city | yes | no | no |
| View accounts / settings | yes | no | no |

The API enforces the same rules; the UI only hides controls.

## Layout

```
web/admin/
  index.html          login + console shell
  css/styles.css
  js/api.js           API discovery, bearer token, fetch wrapper
  js/data.js          API-only loaders (cities, fare routes, trips, audit, accounts)
  js/credentials.js   console role model and the server account cache
  js/app-core.js      state, session, routing, chrome
  js/app-pages.js     cities, fare matrix, official fare routes, lookups
  js/app-pages-2.js   ordinances, trips, analytics, audit, settings
  js/app-boot.js      login, session restore, logout
  serve.mjs           static server for editing the console
```
