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

## Limits

- `test:offline` checks route logic only. Constraints, transactions and Postgres behaviour are exercised only by `npm test`.
- `admin-management.test.ts` (B-05) is mock-based and never touches a database, even under `npm test`.
- Needs Node 18, 20 or 22 (Vitest is pinned to v3 so the Node 20 Docker image keeps working).

## Dev harness

`npx tsx tests/serve-fake.ts` serves the real routes on `:3000` over the in-memory fake, seeded with 28 demo tickets
(password `ChangeMe123!`), so the dashboard can be tried without a database.
