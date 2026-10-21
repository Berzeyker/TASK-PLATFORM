# T.A.S.K. Backend Documentation

Current state of the backend as of the last update (steps 1 to 6 of the backend plan). Everything here describes code that exists in `backend/`. Items not built yet are listed in section 14.

## 1. Overview

The backend is a REST API for the T.A.S.K. IT service and knowledge management platform. It handles authentication, role-based access, the ticket lifecycle, attachments, notifications, metrics and the knowledge base (KB). The AI/RAG service is not connected yet; the KB has a placeholder hook for it.

| Item | Value |
|---|---|
| Runtime | Node.js 20, TypeScript |
| Framework | Express 4 |
| Database | PostgreSQL on Neon, accessed with Prisma 5 |
| Auth | JWT (15-minute access tokens), bcrypt password hashes |
| Validation | zod |
| Uploads | multer (disk storage) |
| Security middleware | helmet, CORS (single origin), express-rate-limit on login |
| Base path | `/api/v1` |
| Health check | `GET /health` returns `{ "ok": true }` |

## 2. Project structure

```
backend/
  prisma/
    schema.prisma        data model (section 4)
    seed.ts              dev users and categories
    migrations/          Prisma migrations (init)
  src/
    server.ts            starts the HTTP server
    app.ts               middleware and route mounting
    config.ts            environment variables and limits
    prisma.ts            shared PrismaClient
    middleware/auth.ts   authenticate (JWT) and requireRole (RBAC)
    utils/http.ts        HttpError, asyncHandler, asyncGuard, errorHandler
    utils/ticketId.ts    ticket ID generator (TCK-YYYYMMDD-XXXXXX)
    services/vectorStore.ts   placeholder hook for the AI service
    routes/
      auth.ts            login, me
      tickets.ts         tickets, rating, attachments upload, convert to KB
      attachments.ts     attachment download
      admin.ts           categories and admin user management
      users.ts           staff list for assignment
      notifications.ts   in-app notifications
      metrics.ts         dashboard metrics
      kb.ts              knowledge base
```

## 3. Setup and configuration

### Environment variables (`backend/.env`)

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | Yes | Neon pooled connection string (`sslmode=require`), used by the app |
| `DIRECT_URL` | Yes | Neon direct (non-pooled) string, used by Prisma migrations |
| `JWT_SECRET` | Yes | Secret that signs tokens; the server refuses to start without it |
| `CORS_ORIGIN` | No | Allowed frontend origin. Default `http://localhost:5173` |
| `PORT` | No | Default `3000` |
| `UPLOAD_DIR` | No | Where uploaded files are stored. Default `./uploads` |

### Commands

| Command | What it does |
|---|---|
| `npm install` | Installs dependencies |
| `npx prisma migrate dev --name <name>` | Applies the schema to Neon and creates a migration |
| `npm run seed` | Creates dev users and categories |
| `npm run dev` | Starts the API with auto-reload (`tsx watch`) |
| `npm run build` / `npm start` | Generates the Prisma client, compiles to `dist/`, runs `dist/src/server.js` |

### Seed data

All four users share the password `ChangeMe123!` (development only; change it before any real use): `admin@task.local`, `agent@task.local`, `manager@task.local`, `employee@task.local`. Categories: Hardware, Software, Network, Account & Access, Email, Other.

### Fixed limits (`config.ts`)

Access token lifetime 15 minutes. Maximum upload size 10 MB. JSON body limit 1 MB.

## 4. Data model

Defined in `prisma/schema.prisma`.

**Enums**

| Enum | Values |
|---|---|
| Role | EMPLOYEE, AGENT, MANAGER, ADMIN |
| TicketStatus | OPEN, ASSIGNED, IN_PROGRESS, RESOLVED, CLOSED, REOPENED |
| Priority | LOW, MEDIUM, HIGH, CRITICAL |
| TicketOrigin | MANUAL, AI_ESCALATION |
| ArticleStatus | DRAFT, UNDER_REVIEW, APPROVED, PUBLISHED, ARCHIVED |
| ActorType | HUMAN, AI, SYSTEM |
| AiOutcome | DEFLECTED, REJECTED, ESCALATED |

**Models**

| Model | Purpose | Key fields |
|---|---|---|
| User | Accounts | email (unique), passwordHash, fullName, role, isActive, failedLoginCount, lockedUntil |
| Category | Ticket and article categories | name (unique), isActive |
| Ticket | Support requests. The ID is a string like `TCK-20261019-A1B2C3` | title, description, status, priority, origin, categoryId, requesterId, assignedAgentId, affectedDevice, location, resolutionNotes, satisfactionRating, createdAt, assignedAt, resolvedAt, closedAt |
| Attachment | Uploaded evidence | ticketId, fileName, mimeType, sizeBytes, storagePath (random file name on disk), uploadedBy |
| AuditLog | Append-only record of actions on tickets | ticketId, actorType, actorId, action, oldValue, newValue (JSON), createdAt |
| KbArticle | Knowledge base articles | title, content (Markdown), status, categoryId, tags, authorId, reviewerId, sourceTicketId, visibilityRole, version, publishedAt |
| AiInteraction, AiFeedback | AI sessions and ratings. Tables exist and are read by the metrics route; nothing writes to them yet | |
| Notification | In-app notifications | userId, ticketId, message, channel, isRead |

## 5. Authentication and authorization

**Login.** `POST /auth/login` checks the email and password and returns a JWT. The token payload has the user ID (`sub`) and `role`. The server verifies the signature and expiry on every request; it does not look the user up again, so a deactivated user keeps access until the token expires (up to 15 minutes). There are no refresh tokens or revocation list, so users log in again after expiry.

**Brute-force protection.** Two layers: the login route allows 30 requests per 15 minutes per IP, and an account locks for 15 minutes after 5 consecutive failed passwords (HTTP 429). The failure counter resets only after a successful login.

**Roles.** `authenticate` rejects missing, invalid or expired tokens with 401. `requireRole(...)` rejects any other role with 403 (`Access denied. You do not have permissions for this action.`).

### Permission matrix

| Action | Employee | Agent | Manager | Admin |
|---|---|---|---|---|
| Create ticket | Yes | No | No | No |
| List and view tickets | Own only | All | All | All |
| Update ticket (classify, assign, resolve, close) | No | Yes | No | Yes |
| Rate a closed ticket | Own only | No | No | No |
| Upload attachments | Own tickets | Any ticket | Any ticket | Any ticket |
| Download attachments | Own tickets | Yes | Yes | Yes |
| Convert ticket to KB draft | No | Yes | No | Yes |
| List staff (agents) | No | Yes | Yes | Yes |
| View metrics | No | No | Yes | Yes |
| KB search and read | Published, employee-visible | All | All | All |
| KB create and edit draft | No | Own drafts | No | Any draft |
| KB submit for review | No | Own articles | No | Yes |
| KB approve, publish, archive | No | No | Yes | Yes |
| Create categories, manage users | No | No | No | Yes |

## 6. API reference

All paths are under `/api/v1` and, except login, need the header `Authorization: Bearer <token>`.

### 6.1 Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/login` | `{ email, password }` | `{ accessToken, role }` |
| GET | `/auth/me` | None | `{ id, email, fullName, role, isActive }` |

### 6.2 Tickets

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/tickets` | Employee | Body: `title` (5 to 150 chars), `description` (at least 10), `categoryId` (required), optional `affectedDevice`, `location`. Creates the ticket as OPEN with priority MEDIUM. Returns 201 |
| GET | `/tickets` | All roles | Query: `status`, `priority`, `page` (default 1), `pageSize` (default 20, max 100). Employees only get their own. Returns `{ items, total, page, pageSize }`. Items include `category {id,name}`, `requester {id,fullName,email}`, `assignedAgent {id,fullName}` |
| GET | `/tickets/:id` | Owner, staff | Same people fields plus `attachments` and `auditLogs` (oldest first) |
| PUT | `/tickets/:id` | Agent, Admin | Body (all optional): `status`, `agentId`, `priority`, `categoryId`, `resolutionNotes`. See section 7 |
| PUT | `/tickets/:id/rating` | Employee (owner) | Body `{ rating: 1..5 }`. Only for CLOSED tickets |
| POST | `/tickets/:id/attachments` | Owner, staff | `multipart/form-data`, field `files`, up to 5 files. See section 8 |
| POST | `/tickets/:id/convert-to-kb` | Agent, Admin | Creates a DRAFT article from a RESOLVED or CLOSED ticket. Returns 201 |

### 6.3 Attachments

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/attachments/:id` | Owner, staff | Streams the file as a download with its original name |

### 6.4 Categories, users, admin

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/categories` | Any user | Active categories, sorted by name |
| POST | `/categories` | Admin | Body `{ name }` |
| GET | `/users?role=AGENT` | Agent, Manager, Admin | Active users with that role: `{ id, fullName, email, role }`. Only Admin may request roles other than AGENT |
| GET | `/admin/users` | Admin | All users (no password hashes) |
| POST | `/admin/users` | Admin | Body `{ email, fullName, role, password (min 10) }`. 409 if the email exists |

### 6.5 Notifications

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?unread=true` | Current user's latest 50. Returns `{ items, unreadCount }` |
| PUT | `/notifications/:id/read` | Marks one as read |
| PUT | `/notifications/read-all` | Returns `{ updated: n }` |

### 6.6 Metrics

`GET /metrics?from=&to=&categoryId=` (Manager, Admin). Dates are ISO strings; default range is the last 30 days. Returns:

```
{ range, totalTickets, byStatus, byPriority,
  ticketsPerDay: [{ date, count }],
  resolvedCount, mttrHours, deflectedCount, deflectionRate }
```

`mttrHours` is the average time from creation to resolution for tickets created in the range that were resolved (`null` if none). `deflectionRate` is deflected AI sessions divided by (deflected sessions plus tickets created in the range), `null` when both are zero. Until the AI service writes to `AiInteraction`, deflection is 0.

### 6.7 Knowledge base

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/kb/search?q=` | All roles | `q` is 2 to 100 chars. Matches title, content and tags (case-insensitive) in PUBLISHED articles; employees only see employee-visible ones. Returns up to 20 results `{ id, title, tags, categoryId, snippet, score }`, best first |
| GET | `/kb/articles?status=` | Agent, Manager, Admin | List without article bodies |
| GET | `/kb/articles/:id` | All roles | Employees get 404 unless the article is published and employee-visible |
| POST | `/kb/articles` | Agent, Admin | Body: `title` (5 to 200), `content` (at least 10), optional `categoryId`, `tags` (max 10, lowercased and de-duplicated), `visibilityRole`. Creates a DRAFT |
| PUT | `/kb/articles/:id` | Author or Admin | Same fields, all optional. Only DRAFT articles are editable (409 otherwise) |
| PUT | `/kb/articles/:id/status` | See section 9 | Body `{ status }` |

## 7. Ticket workflow and business rules

Allowed status transitions (anything else returns 409):

```
OPEN -> ASSIGNED -> IN_PROGRESS -> RESOLVED -> CLOSED
                \-----------------> RESOLVED
RESOLVED -> REOPENED -> ASSIGNED
```

`CLOSED` is final.

| Rule | How the API enforces it |
|---|---|
| BR-01 mandatory category | Moving to ASSIGNED or IN_PROGRESS without a category returns 400 |
| BR-02 resolution notes | Moving to RESOLVED or CLOSED needs `resolutionNotes` with at least 20 letters or digits; otherwise 400 |
| BR-03 closed tickets are final | Any update, upload or conversion rule that would change a CLOSED ticket returns 409; the only allowed write is the employee's rating |
| Assignment | Sending `agentId` (must be an active AGENT) on an OPEN ticket also moves it to ASSIGNED. Moving to ASSIGNED with no agent assigns the calling agent (self-assign) |
| Timestamps | `assignedAt`, `resolvedAt` and `closedAt` are set automatically |

Every ticket creation, update, attachment upload and KB conversion writes an `AuditLog` row. Every status change also creates a `Notification` for the requester (FR-17). Updates and the log entry happen in one database transaction.

## 8. Attachments

- Allowed types: PDF, PNG, JPG/JPEG, TXT. The MIME type and file extension must both match.
- Limit: 10 MB per file, 5 files per request.
- Authorization is checked before any file is written, and closed tickets reject uploads.
- The server also reads the start of each file and checks its real signature (PDF, PNG, JPEG header; no binary bytes for TXT). If any file fails, all files from that request are deleted and the request returns 400.
- Files are stored on disk in `UPLOAD_DIR` under random names; the original name is kept in the database. Use a persistent volume when deploying, or files are lost on container restart.

## 9. Knowledge base lifecycle

```
DRAFT -> UNDER_REVIEW -> APPROVED -> PUBLISHED -> ARCHIVED
Return to DRAFT is allowed from every other state.
```

| Transition | Who |
|---|---|
| To UNDER_REVIEW | The author, or Admin |
| To APPROVED or PUBLISHED | Manager or Admin, and not the article's author (Admin is exempt) |
| To ARCHIVED | Manager or Admin |
| To DRAFT | The author, Manager or Admin. Increments `version` |

Approving records the reviewer; publishing records `publishedAt`. After publishing, or after unpublishing a published article, the API calls `syncArticleIndex` in `services/vectorStore.ts`. That function currently only logs; it is where the chunking and ChromaDB indexing call to the AI service will go. Articles converted from tickets start as DRAFT with visibility AGENT.

## 10. Error format

Errors return JSON `{ "error": "message" }`:

| Status | When |
|---|---|
| 400 | Validation failure (zod adds `issues`), business rule violations, bad files |
| 401 | Missing, invalid or expired token; wrong credentials |
| 403 | Role not allowed, or accessing another user's ticket or file |
| 404 | Resource not found |
| 409 | Invalid state change, closed ticket, duplicate email or conversion |
| 429 | Login rate limit or locked account |
| 500 | Unexpected error. The details go to the server log only, never to the client |

## 11. Security measures in place

- Passwords hashed with bcrypt; hashes are never returned by any endpoint.
- JWT with a short lifetime; secret taken from the environment.
- `helmet` security headers, CORS limited to one origin, 1 MB JSON limit.
- All database access goes through Prisma (parameterized queries).
- Role checks on every route; ownership checks on tickets and attachments.
- Upload validation by type, extension, size and real file signature.

## 12. Adding a new endpoint

1. Create or extend a file in `src/routes/` and export a `Router`.
2. Call `authenticate` (usually with `router.use`), then `requireRole(...)` per route.
3. Wrap handlers in `asyncHandler` and validate input with zod's `.parse()`; throw `HttpError(status, message)` for known failures.
4. Mount the router in `src/app.ts` under `/api/v1/...`.
5. For multi-step writes, use `prisma.$transaction` and add an `AuditLog` row when the action affects a ticket.

## 13. Known limitations

- No automated tests yet.
- No token refresh or revocation; a deactivated user stays valid until the token expires.
- The failed-login counter resets only on a successful login.
- Uploaded files live on local disk, not in cloud storage.
- Metrics are computed in application code from all tickets in the range, which is fine for the project's scale but would need SQL aggregation for large volumes.
- Neon is a cloud database, so the API cannot run offline unless `DATABASE_URL` points at a local PostgreSQL.

## 14. Not implemented yet

| Item | Related requirement |
|---|---|
| AI endpoints (`POST /ai/query`, `POST /ai/feedback`), the FastAPI RAG service and ChromaDB indexing | FR-10 to FR-14, AIR-01 to AIR-08 |
| AI-to-human escalation creating tickets with origin `AI_ESCALATION` | FR-13 |
| Email notifications (SMTP) | FR-17 optional channel |
| Editing or deactivating users and categories | Admin functions |
| Self-cancel for open tickets | FR-20 (Could) |
| Audit logging for KB actions and logins | NFR-12 |
| Field-level encryption (AES-256-GCM) for sensitive columns | NFR-01 |
| Automated tests (business rules, RBAC) | TC-TICK-02, TC-TICK-03, TC-SEC-01 |
