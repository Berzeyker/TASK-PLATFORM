# Backend tests

Vitest + supertest, driven through the real Express `app` (`src/app.ts`, separate from `server.ts`).

| Command | Database | Use it for |
|---|---|---|
| `npm test` | A **separate Neon branch** (`.env.test`) | The real check. CI runs this. |
| `npm run test:offline` | None (in-memory fake of Prisma) | Fast feedback while coding; also runs where no database is available |
| `npm run test:watch` | None (offline mode) | TDD loop |
| `npm run typecheck` | n/a | Type-checks `src/` and `tests/` |

## One-time setup for `npm test`

1. In Neon, create a **new branch** of your project (for example `test`). Do not use `main`.
2. `cp .env.test.example .env.test` and paste that branch's pooled and direct connection strings.
3. `npm test`

Before the first test, `tests/support/globalSetup.ts` runs `prisma migrate deploy`, empties every table
(`TRUNCATE ... RESTART IDENTITY CASCADE`, keeping `_prisma_migrations`) and runs `prisma/seed.ts`.
Each test creates its own tickets, so tests do not depend on each other and run serially on the shared branch.

### Safety

`npm test` **wipes the database it points at**, so `tests/support/testEnv.ts` refuses to start when:
- `DATABASE_URL` or `DIRECT_URL` is missing for the test database,
- either one points at the same database (host + database name, ignoring Neon's `-pooler` suffix) as `DATABASE_URL`/`DIRECT_URL` in `backend/.env`,
- `NODE_ENV=production`.

The test URLs are handed to Vitest through `test.env`. `src/config.ts` loads `backend/.env` with `dotenv/config`,
and dotenv never overrides a variable that is already set, so `.env` cannot win. `tests/testEnv.test.ts` covers the guard.

### CI

No `.env.test` in CI. Provide the branch as secrets and run:

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npm ci
  working-directory: backend
- run: npm test
  working-directory: backend
  env:
    TEST_DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
    TEST_DIRECT_URL: ${{ secrets.TEST_DIRECT_URL }}
```

## What B-01 covers (`tickets.rules.test.ts`)

- **FR-01** create: validation, id format, audit row, employees only.
- **BR-01** category required before `ASSIGNED` / `IN_PROGRESS` (400), including "set in the same request".
- **BR-02** notes need 20 letters/digits for `RESOLVED` / `CLOSED` (400): boundaries 19/20, padding, accents, stored notes, no partial writes.
- **Transitions**: all 36 from/to pairs against the spec's workflow (200 or 409).
- **BR-03** a `CLOSED` ticket rejects every edit and uploads (409, nothing written to disk) but accepts the requester's rating.
- **RBAC**: employees and managers cannot update (403); employees cannot read others' tickets (403); list scoping; filters.
- **Assignment**: `assignedAt`, self-assign by agent and admin, reassignment, invalid agents (400).
- **Audit and notifications**: who/before/after, one notification per status move, none on rejected requests, a full lifecycle can be reconstructed.

`src/routes/tickets.ts` was mutation-checked: 12 deliberately planted bugs (removed rules, wrong thresholds, widened roles, missing rows)
are each caught by at least one test. The one exception is "allow `CLOSED -> REOPENED`", an equivalent mutant: the BR-03 guard rejects
every move out of `CLOSED` before the transition table is consulted.

## What B-02 covers (`security.*.test.ts`)

| File | Covers |
|---|---|
| `security.rbac.test.ts` | A **permission matrix over every route x every role + anonymous** (29 routes x 5 principals = 145 cases). A completeness test compares it with the routes Express actually registers, so adding a route without a matrix entry fails the build. Plus: employees reaching each other's notifications, mass assignment (ticket, user, KB article), and the KB review workflow (author cannot approve their own article, only reviewers publish, employees see only published employee-visible articles). |
| `security.auth.test.ts` | Missing, malformed, expired, wrong-secret, tampered, `alg:none`, wrong-algorithm and bad-subject tokens (401). **Revocation**: a deactivated user, a demotion and a promotion apply at once to tokens already issued. Login: generic error for unknown / wrong / inactive (no user enumeration), payload validation, 15-minute tokens. Hardening: headers, CORS, malformed JSON, 1 MB body limit. **No response leaks a password hash** (scans 16 endpoints for the field name, the bcrypt pattern and every stored hash). |
| `security.lockout.test.ts` | 5 failures lock for 15 minutes (even the right password gets 429), a success resets the counter, lock is per account, expiry restores access. |
| `security.ratelimit.test.ts` | The 31st login in 15 minutes gets 429. |
| `security.uploads.test.ts` | Fake PDF / PNG / JPEG, binary "text", MIME vs extension mismatch, executables, HTML and SVG, double extensions, wrong field name, 6 files, a bad file among good ones, 10 MB + 1 byte: all 400 and **nothing left on disk or in the database**. Valid files are stored under random names; traversal in file names; authorization happens before any write; downloads are owner/staff only, forced `attachment`, `nosniff`; internal storage details never reach clients. |

### Decisions and fixes made in B-02

- **`authenticate` now checks the database on every request** (one primary-key lookup) and takes the role from there, not from the token.
  Deactivating an account or changing a role (B-05) applies immediately instead of after the 15-minute token expires.
  Also: the JWT algorithm is pinned to HS256, and a non-integer `sub` is a 401 (it used to reach Prisma and would have been a 500).
  If the extra query ever matters, add a 30-second in-memory cache and clear it in `PUT /admin/users/:id`.
- `PUT /kb/articles/:id/status` checks the role before looking up the article (an employee used to get 404 for a missing article and 403 for a real one, which reveals which ids exist).
- Malformed JSON now returns 400 and an oversized body 413 (both used to be 500).
- Attachment responses no longer include `storagePath` (the server-side file name) or internal user ids.

### Findings (status after B-03)

1. ~~**Login timing**~~ **Fixed in B-03.** Unknown and inactive accounts are compared against a dummy bcrypt hash, so they cost the same as a wrong password.
2. **Lockout is a denial-of-service lever**: anyone who knows an email can lock that account for 15 minutes. **Partly addressed in B-03:** a lock that has expired now starts a fresh count (one wrong guess no longer re-locks it), and every lockout is logged (`ACCOUNT_LOCKED`) and visible at `GET /admin/audit?action=ACCOUNT_LOCKED`. The lever itself remains; fixing it needs per-IP+email throttling or a different policy. A locked account also still answers 429 where an unknown email answers 401, which reveals that the account exists.
3. **The rate limiter is per client IP**. Behind a reverse proxy (Render, Railway, nginx) every user shares the proxy's IP until `app.set('trust proxy', ...)` is configured: an I-01 deployment item.
4. **Managers can upload attachments to any ticket** (`isStaff` includes MANAGER). Probably unintended; the matrix documents the current behaviour.
5. **Existence probing**: `GET /tickets/:id` answers 403 for someone else's ticket and 404 for a missing one (B-01 requires the 403), and attachment ids are sequential. Ticket ids are random; attachment ids are not.
6. `JWT_SECRET` strength is not enforced (consider a minimum length outside development).
7. The plain-text upload check only inspects the first 1 KB for NUL bytes.
8. Unknown routes return Express's default HTML 404 rather than JSON.

## What B-03 covers (`audit.*.test.ts`, see `../AUDIT.md`)

| File | Covers |
|---|---|
| `audit.trail.test.ts` | Each ticket action (create, update, status, upload, rating, convert) writes **exactly one** row with the right actor and before/after; requests that fail write none. **A full ticket story is reconstructed** from `GET /admin/audit` (who did what, in order, including a reassignment between two agents). A ticket's timeline never contains non-ticket events; employees see roles, not names. KB: creation, edits (what changed, never the body; a no-op edit writes nothing), every lifecycle transition with the reviewer, refused transitions write nothing. Admin changes are logged without passwords or hashes. The viewer: filters, paging, newest first, validation (400), admin only. |
| `audit.login.test.ts` | Successful logins; failed logins for unknown email / wrong password / inactive account with a null actor, the lower-cased attempted email and a reason (the response stays generic); lockout (one `ACCOUNT_LOCKED` system event, later attempts logged as `locked`); a fresh count after a lock expires; malformed requests are not logged; a dummy hash is compared for unknown/inactive accounts; no password, hash or token appears in any audit row. |

30 deliberately planted bugs in the audit code (dropped events, wrong actor, leaked password, missing system flag, removed timing equaliser, wrong "from" status, body copied into the log, and so on) were each caught.

Not testable offline: that a failing audit insert rolls the whole change back. That is Prisma's transaction guarantee, and the fake has no rollback.

## Limits

- `test:offline` checks route logic only. Constraints, transactions and Postgres behaviour are exercised only by `npm test`.
- `admin-management.test.ts` (B-05) is mock-based and never touches a database, even under `npm test`.
- The serializable "last active admin" guard in `PUT /admin/users/:id` is now only reachable by two admins removing each other at the same moment, which a sequential test cannot reproduce. It needs a concurrency test on a real database.
- Equivalent mutants (removing one of two overlapping guards changes nothing observable): the 5-file upload limit is enforced twice, `path.basename` on the client file name is redundant with busboy, and `.strict()` on the admin user update only rejects what zod would strip anyway.
- Needs Node 18, 20 or 22 (Vitest is pinned to v3 so the Node 20 Docker image keeps working).

## Dev harness

`npx tsx tests/serve-fake.ts` serves the real routes on `:3000` over the in-memory fake, seeded with 28 demo tickets
(password `ChangeMe123!`), so the dashboard can be tried without a database.
