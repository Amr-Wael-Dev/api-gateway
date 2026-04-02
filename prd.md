# Product Requirements Document

## Distributed API Gateway & Microservices Platform

**Type:** Personal Portfolio Project  
**Stack:** Node.js · TypeScript · Docker · Kubernetes  
**Version:** 1.0  
**Status:** Draft

---

## 1. Project Overview

This project is a production-grade, learning-first distributed backend system built entirely in Node.js/TypeScript. The goal is to implement patterns found in real large-scale systems — not as a toy, but as a genuinely deployable platform demonstrating deep backend competence. It will serve as a strong portfolio piece and a hands-on laboratory for distributed systems engineering.

The system revolves around a **custom-built API Gateway** that fronts a set of independently deployable microservices. It will showcase authentication, authorization, rate limiting, load balancing, async messaging, observability, and resilience patterns — all orchestrated via Kubernetes and containerized with Docker.

---

## 2. Goals & Non-Goals

### Goals

- Build a custom API Gateway from scratch (not use a third-party product like Kong or NGINX)
- Implement real distributed systems patterns (circuit breaker, event-driven messaging, saga, etc.)
- Make each microservice independently deployable, scalable, and observable
- Demonstrate strong TypeScript discipline: typed contracts, shared libraries, strict config
- Deploy everything on Kubernetes with proper manifests (Deployments, Services, Ingress, HPA)
- Include a working observability stack (Prometheus + Grafana dashboards)

### Non-Goals

- A production SaaS business — the domain is intentionally generic/sandbox
- A frontend UI (REST API consumers only; Swagger UI is sufficient)
- GraphQL (REST-first; gRPC between services is a stretch goal)
- Managed cloud services (keep it self-hostable for the portfolio)

---

## 3. System Architecture

```
                          ┌──────────────────────────────────────────┐
                          │              Kubernetes Cluster           │
                          │                                           │
  Client Requests ──────► │  ┌─────────────────────────────────┐     │
                          │  │          API Gateway             │     │
                          │  │  - Rate Limiting (Redis)         │     │
                          │  │  - JWT Verification              │     │
                          │  │  - Request Routing               │     │
                          │  │  - Circuit Breaker               │     │
                          │  │  - Load Balancing (K8s)          │     │
                          │  │  - Correlation ID Injection      │     │
                          │  │  - Response Caching              │     │
                          │  └────────────┬────────────────────┘     │
                          │               │                           │
                          │    ┌──────────┼──────────────┐           │
                          │    ▼          ▼              ▼            │
                          │ ┌──────┐  ┌──────┐  ┌─────────────┐     │
                          │ │Auth  │  │User  │  │  Resource   │     │
                          │ │Svc   │  │Svc   │  │  Service    │     │
                          │ └──────┘  └──────┘  └─────────────┘     │
                          │                                           │
                          │      BullMQ Queues (via Redis)            │
                          │    ┌──────────┬─────────────┐            │
                          │    ▼          ▼             ▼             │
                          │ ┌──────┐  ┌──────┐  ┌──────────┐        │
                          │ │Notif │  │Audit │  │ Scheduler│        │
                          │ │Svc   │  │Svc   │  │ Service  │        │
                          │ └──────┘  └──────┘  └──────────┘        │
                          │                                           │
                          │  PostgreSQL (Admin/Meta) + MongoDB/Svc    │
                          │  Redis (Cache + Rate Limiter + BullMQ)    │
                          │  Prometheus + Grafana                     │
                          └──────────────────────────────────────────┘
```

All inter-service communication uses **HTTP/REST** (synchronous) or **BullMQ** (asynchronous). Services never talk to each other's databases directly. Each service owns its own MongoDB database. PostgreSQL is used for the admin meta-layer only.

---

## 4. Services Specification

---

### 4.1 API Gateway

The single entry point for all external traffic. Built from scratch using **Express + TypeScript**, not a pre-built gateway product. This is the most important service for learning.

**Core Responsibilities**

| Feature              | Details                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Request Routing**  | Path-based proxy to upstream services. Dynamic route config loaded from a YAML/JSON file.                                            |
| **JWT Verification** | Validates access tokens on every protected route. Forwards decoded identity headers to services.                                     |
| **Rate Limiting**    | Sliding window counter per (IP, user, API key). Stored in Redis. Returns `429 Too Many Requests` with `Retry-After`.                 |
| **Circuit Breaker**  | Per-upstream circuit breaker using `opossum`. Opens after N failures, half-opens after timeout.                                      |
| **Load Balancing**   | Round-robin selection across registered service instances. Kubernetes Services handle this in prod; gateway handles it in local dev. |
| **Correlation IDs**  | Injects `X-Correlation-ID` into every forwarded request for end-to-end tracing.                                                      |
| **Response Caching** | Redis-backed cache with configurable TTL per route. `Cache-Control` header respected.                                                |
| **Request Timeout**  | Per-route configurable timeout. Returns `504 Gateway Timeout` on breach.                                                             |
| **API Versioning**   | Routes are prefixed with `/v1/`, `/v2/` etc. Supports header-based versioning as an alternative.                                     |
| **Health Checks**    | `/health` and `/ready` endpoints. Aggregates health of all registered upstreams.                                                     |
| **CORS**             | Configurable per-route CORS policy.                                                                                                  |
| **Metrics**          | Exposes `/metrics` for Prometheus scraping (request count, latency, error rates per route).                                          |

**Middleware Pipeline (in order)**

```
Request In
  → CORS
  → Helmet (security headers)
  → Request ID injection
  → Rate Limiter
  → JWT Verifier (route-dependent)
  → Circuit Breaker check
  → Cache lookup
  → Proxy / Forward
  → Response cache write
  → Metrics recording
Response Out
```

**Key Libraries**

- `http-proxy-middleware` — request proxying
- `ioredis` — rate limit counters + response cache
- `opossum` — circuit breaker
- `jsonwebtoken` — JWT verification
- `prom-client` — Prometheus metrics
- `express-rate-limit` — optional complement to Redis rate limiter
- `helmet`, `cors` — security

---

### 4.2 Auth Service

Handles all identity concerns: registration, login, token issuance, refresh, revocation, and OAuth2 social login.

**Features**

| Feature              | Details                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Registration**     | Email + password. Bcrypt password hashing. Enqueues a verification email job to BullMQ.                            |
| **Login**            | Returns short-lived **access token** (15min JWT) + long-lived **refresh token** (7 days, stored in Redis).         |
| **Token Refresh**    | Validates refresh token, issues new pair, rotates the refresh token (invalidates old one).                         |
| **Token Revocation** | Logout adds token to a Redis blocklist (checked on every verify).                                                  |
| **OAuth2 (Google)**  | Passport.js Google strategy. Upserts user record, issues same JWT pair.                                            |
| **RBAC**             | Roles: `guest`, `user`, `moderator`, `admin`. Stored in JWT claims. Fine-grained permissions resolved per service. |
| **Password Reset**   | Time-limited reset token (UUID, stored in Redis with TTL). Enqueues email job to BullMQ.                           |
| **MFA (Stretch)**    | TOTP via `otplib`. QR code generation endpoint.                                                                    |

**Database:** MongoDB (users, roles, sessions)  
**Also uses:** Redis (refresh token store, blocklist, reset tokens)

**Queues Published (BullMQ)**

- `auth:user:registered`
- `auth:user:password-reset-requested`
- `auth:user:email-verified`

---

### 4.3 User Service

Manages user profiles and is the system of record for user data (separate from auth credentials).

**Features**

| Feature             | Details                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| **Profile CRUD**    | Get, update, delete user profile. Soft-delete pattern (marks `deletedAt`).            |
| **Avatar Upload**   | Accepts image, stores in MinIO (S3-compatible, self-hostable). Stores URL in profile. |
| **User Search**     | MongoDB text index on `name`, `email`, `bio`.                                         |
| **Admin Endpoints** | List all users, ban/unban user, change role. RBAC-enforced (`admin` only).            |
| **Pagination**      | Cursor-based pagination (not offset) on list endpoints for scalability.               |

**Database:** MongoDB (profiles)  
**Queues Published (BullMQ)**

- `user:profile:updated`
- `user:account:deleted`

**Queues Consumed (BullMQ)**

- `auth:user:registered` → creates initial profile record

---

### 4.4 Resource Service

A generic, domain-neutral CRUD service representing the core "content" of the system (think: posts, articles, products — pick whatever makes sense to you). Intentionally named generically since this is a learning sandbox.

**Features**

| Feature                    | Details                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| **Full CRUD**              | Create, read, update, delete resources with ownership enforcement.                |
| **Ownership & Visibility** | Resources are `public`, `private`, or `unlisted`. Only owner or admin can modify. |
| **Tagging & Filtering**    | Resources have tags. Filter/search by tag, author, status.                        |
| **Pagination**             | Cursor-based.                                                                     |
| **Optimistic Locking**     | Uses a `version` field to prevent lost updates on concurrent edits.               |
| **Soft Delete**            | Resources are never hard-deleted; `deletedAt` timestamp is set.                   |

**Database:** MongoDB (resources)  
**Queues Published (BullMQ)**

- `resource:created`
- `resource:updated`
- `resource:deleted`

---

### 4.5 Notification Service

Purely asynchronous — it processes jobs from BullMQ queues and sends notifications. It never handles HTTP requests from the gateway directly (internal-only). This is the best service for learning event-driven patterns.

**Features**

| Feature                   | Details                                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Email Notifications**   | Uses Nodemailer + SMTP (or Mailtrap for dev). Templated with Handlebars.                                                                                                             |
| **In-App Notifications**  | Stores unread notification records in MongoDB. Users poll via User Service (or WebSocket stretch goal).                                                                              |
| **Retry & DLQ**           | Failed jobs retry with exponential backoff via BullMQ's built-in `attempts` + `backoff` config. After max retries, jobs land in BullMQ's failed set for inspection or manual replay. |
| **Deduplication**         | Idempotency key per notification prevents duplicate sends on reprocessing.                                                                                                           |
| **Preference Respecting** | Checks user notification preferences before sending (respects opt-out).                                                                                                              |

**Database:** MongoDB (notifications, preferences)  
**Queues Consumed (BullMQ)**

- `auth:user:registered` → welcome email
- `auth:user:password-reset-requested` → reset email
- `resource:created` → (if followed) notify subscribers

---

### 4.6 Audit Log Service

An append-only event log of every significant action in the system. Powers compliance, debugging, and admin visibility. Also purely event-driven.

**Features**

| Feature               | Details                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Event Ingestion**   | Workers consume all major BullMQ queues and write structured log entries.                                     |
| **Append-Only Store** | MongoDB collection with no updates/deletes. TTL index for automatic expiry after 90 days.                     |
| **Query API**         | Internal-only HTTP endpoint for admin panel to query logs by `userId`, `action`, `resourceId`, time range.    |
| **Structured Schema** | Every log entry: `{ eventId, userId, action, resourceType, resourceId, metadata, timestamp, correlationId }`. |

**Database:** MongoDB (audit_logs)  
**Queues Consumed:** All queues

---

### 4.7 Scheduler Service _(Stretch Goal)_

A lightweight job scheduling service to run recurring tasks across the system. Demonstrates distributed locks and cron-like orchestration.

**Features**

- Cron-based job runner using `node-cron`
- Distributed lock via Redis (`SET NX PX`) to prevent duplicate execution across replicas
- Jobs: cleanup expired refresh tokens, flush stale notifications, regenerate aggregate metrics
- Job history stored in MongoDB

---

## 5. Cross-Cutting Concerns

### 5.1 Authentication & Authorization Flow

```
1. Client sends request to Gateway with Bearer token
2. Gateway extracts JWT, verifies signature with public key
3. Gateway injects decoded claims as headers: X-User-Id, X-User-Role, X-User-Email
4. Upstream service trusts these headers (only reachable via gateway in prod)
5. Service performs fine-grained authorization based on role + resource ownership
```

**Token Strategy**

- Access Token: JWT, RS256 (asymmetric), 15-minute TTL
- Refresh Token: Opaque UUID, stored in Redis, 7-day TTL, rotated on use
- Public key distributed to gateway via a JWKS endpoint on Auth Service

### 5.2 Rate Limiting Strategy

Three tiers of rate limiting enforced at the gateway:

| Tier               | Limit        | Window       | Applied To                  |
| ------------------ | ------------ | ------------ | --------------------------- |
| Global IP          | 200 req      | 1 min        | All traffic                 |
| Authenticated user | 1000 req     | 1 min        | Per `userId`                |
| Specific routes    | Configurable | Configurable | e.g., `/auth/login`: 10/min |

Implementation: **Sliding window log** algorithm in Redis using sorted sets (timestamp as score). More accurate than fixed window; prevents burst at window boundary.

### 5.3 Circuit Breaker

Implemented at the gateway using `opossum` per upstream service.

| State         | Condition               | Behavior                      |
| ------------- | ----------------------- | ----------------------------- |
| **Closed**    | Normal                  | Requests pass through         |
| **Open**      | Error rate > 50% in 10s | Requests fail fast with `503` |
| **Half-Open** | After 30s timeout       | One probe request allowed     |

Fallback responses are configurable per route (cached last-known-good response or a static fallback JSON).

### 5.4 Async Messaging (BullMQ)

BullMQ is a Redis-based job queue. Because Redis is already in the stack for rate limiting and caching, this eliminates the need for a separate message broker — simplifying the infrastructure significantly without sacrificing the core event-driven patterns.

**Queue naming convention:** `{service}:{entity}:{event}` (e.g., `auth:user:registered`)

**Key BullMQ concepts used:**

| Concept             | Usage                                                                                                                                                    |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Queue**           | Each event type has its own named queue. Publishers add jobs; workers consume them.                                                                      |
| **Worker**          | Each consuming service runs one Worker per queue it cares about.                                                                                         |
| **Job Options**     | `attempts`, `backoff` (exponential), `delay`, `removeOnComplete`, `removeOnFail` configured per queue.                                                   |
| **Failed Set**      | Jobs that exhaust all retries land in the BullMQ failed set. A periodic cleanup job or admin endpoint can inspect and replay them — equivalent to a DLQ. |
| **Flow Producer**   | Used for the Saga pattern — chains dependent jobs across queues with parent/child relationships and automatic failure propagation.                       |
| **Repeatable Jobs** | Used in the Scheduler Service for cron-based tasks with distributed deduplication.                                                                       |

**Guarantees:**

- At-least-once delivery (workers are idempotent via deduplication keys)
- Each consuming service runs its own Worker instances (independent processing)
- Failed jobs are retried with exponential backoff before landing in the failed set
- Job schema uses a shared TypeScript types package (`packages/shared-types`)

**BullMQ Setup:** Single Redis instance serves both the app (rate limiting, cache, sessions) and BullMQ. In K8s, Redis runs as a StatefulSet with a PersistentVolumeClaim.

### 5.5 Observability

**Logging**

- Structured JSON logging via `winston` in every service
- Log levels: `error`, `warn`, `info`, `debug`
- Every log line includes: `correlationId`, `serviceId`, `timestamp`, `level`, `message`, `metadata`
- In K8s, logs are collected by a log aggregator (Loki or the ELK stack as a stretch goal)

**Metrics (Prometheus + Grafana)**

Each service exposes `/metrics`. Collected metrics include:

| Metric                          | Type      | Description                             |
| ------------------------------- | --------- | --------------------------------------- |
| `http_requests_total`           | Counter   | Total requests by method, route, status |
| `http_request_duration_seconds` | Histogram | Latency percentiles (p50, p95, p99)     |
| `circuit_breaker_state`         | Gauge     | 0=closed, 1=half-open, 2=open           |
| `bullmq_jobs_completed_total`   | Counter   | Per queue, completed job count          |
| `bullmq_jobs_failed_total`      | Counter   | Per queue, failed job count             |
| `bullmq_queue_depth`            | Gauge     | Waiting + active jobs per queue         |
| `rate_limit_hits_total`         | Counter   | By tier and route                       |
| `cache_hit_ratio`               | Gauge     | Gateway cache effectiveness             |

Grafana dashboards:

- Gateway Overview (traffic, latency, error rate, rate limit hits)
- Service Health (per-service request rates + circuit breaker states)
- BullMQ Queue Health (queue depth, job throughput, failure rate, failed set size per queue)

**Distributed Tracing (Future)**

- Correlation IDs passed via `X-Correlation-ID` header across all hops
- Full OpenTelemetry integration is a recommended Phase 2 addition

### 5.6 Health Checks

Every service exposes:

- `GET /health` — liveness probe (returns 200 if process is alive)
- `GET /ready` — readiness probe (returns 200 only if DB connection + Redis (BullMQ) are ready)

Kubernetes probes configured with appropriate `initialDelaySeconds`, `periodSeconds`, and `failureThreshold`.

---

## 6. Data Architecture

### Per-Service MongoDB Databases

| Service      | Database Name     | Key Collections                |
| ------------ | ----------------- | ------------------------------ |
| Auth         | `auth_db`         | `users`, `sessions`            |
| User         | `user_db`         | `profiles`, `avatars`          |
| Resource     | `resource_db`     | `resources`                    |
| Notification | `notification_db` | `notifications`, `preferences` |
| Audit        | `audit_db`        | `events`                       |
| Scheduler    | `scheduler_db`    | `jobs`, `job_history`          |

Services communicate via events, never via shared DB access.

### PostgreSQL (Admin Layer)

Used by a future admin panel. Stores aggregated/denormalized views materialized by consuming BullMQ job completion events. Also serves as the source of truth for cross-service admin queries. Schema managed with migrations via `node-postgres` + `db-migrate`.

### Redis

Shared infrastructure (not per-service):

- Rate limit counters
- JWT refresh token store
- JWT blocklist
- Response cache (gateway)
- Distributed locks (scheduler)
- Password reset / email verification tokens

---

## 7. Infrastructure & Deployment

### Local Development

- **Docker Compose** orchestrates: all services + MongoDB instances + Redis + Prometheus + Grafana + MinIO
- Hot reload via `ts-node-dev` in each service container
- Shared `.env` managed via `dotenv-vault` or simple `.env.local`

### Kubernetes (Production Target)

- **Namespace:** `platform`
- One **Deployment** per service with configurable replica count
- **Horizontal Pod Autoscaler (HPA)** on API Gateway and Resource Service (scale on CPU + custom Prometheus metric)
- **ConfigMaps** for non-secret config; **Secrets** for credentials
- **Ingress** (NGINX Ingress Controller) fronts the API Gateway
- **PersistentVolumeClaims** for MongoDB data volumes
- **Liveness + Readiness** probes on all Deployments
- **Resource requests/limits** set on every container

### Monorepo Structure

```
/
├── services/
│   ├── api-gateway/
│   ├── auth-service/
│   ├── user-service/
│   ├── resource-service/
│   ├── notification-service/
│   ├── audit-service/
│   └── scheduler-service/
├── packages/
│   ├── shared-types/        # BullMQ job types, API contracts
│   ├── shared-errors/       # Typed error classes
│   ├── shared-logger/       # Winston config
│   └── shared-middleware/   # Auth header parsing, error handler
├── infra/
│   ├── docker-compose.yml
│   └── k8s/
│       ├── gateway/
│       ├── auth/
│       ├── ...
│       └── monitoring/
├── scripts/
└── pnpm-workspace.yaml
```

---

## 8. API Design Standards

- All routes prefixed: `/v1/{service-name}/{resource}`
- Error responses follow RFC 7807 (Problem Details):
  ```json
  {
    "type": "https://platform.local/errors/rate-limit-exceeded",
    "title": "Rate Limit Exceeded",
    "status": 429,
    "detail": "You have exceeded 200 requests per minute.",
    "instance": "/v1/resources",
    "correlationId": "abc-123"
  }
  ```
- Pagination uses cursor-based pattern:
  ```json
  { "data": [...], "nextCursor": "base64token", "hasMore": true }
  ```
- All dates in ISO 8601 UTC
- Swagger/OpenAPI 3.1 docs auto-generated per service via `@asteasolutions/zod-to-openapi`

---

## 9. Security Checklist

- [ ] HTTPS enforced at Ingress level (Let's Encrypt / self-signed for local)
- [ ] JWT uses RS256 (asymmetric); private key never leaves Auth Service
- [ ] Services unreachable directly from outside cluster (only via Gateway)
- [ ] Helmet.js on all Express services
- [ ] Request body size limit enforced at Gateway
- [ ] Secrets never committed — managed via K8s Secrets + `.gitignore`
- [ ] MongoDB auth enabled (no anonymous access)
- [ ] Redis AUTH password set
- [ ] Rate limiting covers login endpoint aggressively (brute force protection)
- [ ] Input validation with `zod` on all request bodies

---

## 10. Suggested Extra Features (Beyond the Basics)

These are concepts that will meaningfully elevate the portfolio piece and expose you to more distributed systems patterns:

### High Value Additions

| Feature                                    | Why It's Worth It                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idempotency Keys on mutations**          | POST `/v1/resources` accepts `Idempotency-Key` header; duplicate requests return cached response. Real-world pattern used by Stripe.                                                  |
| **API Key Authentication**                 | Alongside JWT, support machine-to-machine auth via hashed API keys. Stored in Redis with rate limit tiers.                                                                            |
| **Webhook Delivery System**                | Users register webhook URLs; the system POSTs events on resource changes. Includes retry logic + delivery logs. Great async pattern.                                                  |
| **Distributed Tracing with OpenTelemetry** | Instrument every service and gateway. View full request traces in Jaeger. Shows deep observability knowledge.                                                                         |
| **Saga Pattern for multi-service flows**   | E.g., "delete account" saga: delete profile → revoke tokens → delete resources → send goodbye email. Orchestrated via BullMQ Flow Producer with compensating transactions on failure. |
| **gRPC for internal communication**        | Replace HTTP between services with gRPC + Protocol Buffers. Strongly typed, faster, and used at scale. Huge portfolio differentiator.                                                 |
| **Blue-Green / Canary Deployments**        | K8s Argo Rollouts for canary releases of services. Demonstrates DevOps awareness.                                                                                                     |
| **Admin Panel API**                        | A thin Express service backed by PostgreSQL with materialized views. Surfaces cross-service stats via a single internal API.                                                          |
| **Feature Flags**                          | Simple feature flag service (or integrate Flagsmith). Gateway reads flags to enable/disable routes without redeployment.                                                              |

---

## 11. Phased Delivery Plan

### Phase 1 — Foundation (Weeks 1–3)

| Task | Status |
| ---- | ------ |
| Monorepo setup: pnpm workspaces, shared packages, TypeScript base config | |
| Docker Compose: all infra services running locally | |
| API Gateway: routing, JWT verification, health checks | |
| Auth Service: register, login, JWT issuance, refresh | |
| User Service: profile CRUD | |

### Phase 2 — Core Features (Weeks 4–6)

| Task | Status |
| ---- | ------ |
| Resource Service: full CRUD, ownership, pagination | |
| BullMQ: queue setup, base Worker and Queue producer classes | |
| Notification Service: email + in-app via BullMQ jobs | |
| Audit Log Service: event consumption + query API | |
| Rate limiting + Circuit Breaker on gateway | |

### Phase 3 — Observability & Resilience (Weeks 7–8)

| Task | Status |
| ---- | ------ |
| Prometheus metrics on all services | |
| Grafana dashboards (gateway overview + service health + BullMQ queue depth) | |
| Dead Letter Queue handling in Notification Service | |
| Health check probes wired up | |

### Phase 4 — Kubernetes & Polish (Weeks 9–10)

| Task | Status |
| ---- | ------ |
| K8s manifests for all services | |
| HPA on gateway + resource service | |
| Ingress with TLS | |
| Swagger docs per service | |
| README + architecture diagram | |
| (Stretch) gRPC or OpenTelemetry tracing | |

---

## 12. Key Libraries Reference

| Purpose          | Library                                                 |
| ---------------- | ------------------------------------------------------- |
| HTTP framework   | `express` + `@types/express`                            |
| Request proxying | `http-proxy-middleware`                                 |
| JWT              | `jsonwebtoken`, `jwks-rsa`                              |
| Validation       | `zod`                                                   |
| Circuit breaker  | `opossum`                                               |
| Redis client     | `ioredis`                                               |
| Job queue        | `bullmq`                                                |
| MongoDB client   | `mongoose`                                              |
| Postgres client  | `pg` + `drizzle-orm`                                    |
| Password hashing | `bcrypt`                                                |
| Logging          | `winston`                                               |
| Metrics          | `prom-client`                                           |
| Email            | `nodemailer`                                            |
| OAuth2           | `passport`, `passport-google-oauth20`                   |
| OpenAPI docs     | `@asteasolutions/zod-to-openapi` + `swagger-ui-express` |
| Testing          | `vitest`, `supertest`, `testcontainers`                 |
