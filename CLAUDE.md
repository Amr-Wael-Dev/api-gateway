# API Gateway - Distributed Microservices Platform

This is a production-grade distributed backend system built with Node.js/TypeScript, featuring a custom API Gateway and multiple microservices.

## Project Overview

A microservices platform demonstrating distributed systems patterns including:

- Custom API Gateway with rate limiting, circuit breaker, JWT verification, Swagger aggregation
- Auth Service with RS256 JWT tokens, Redis refresh token store + blocklist, RBAC
- User Service for profile management with BullMQ-driven profile creation
- Event-driven architecture using BullMQ (Redis-based job queues)
- MongoDB per service, Redis for caching/rate-limiting/queues/BullMQ
- Prometheus + Grafana observability stack
- Docker Compose for local development, Kubernetes (future)

## Architecture

```
┌─────────────┐
│   Gateway   │ → Rate limiting, JWT verification, circuit breaker, routing
└──────┬──────┘
       │
   ┌───┴───┬───────┐
   ▼       ▼       ▼
Auth     User   (Future services)
```

**Key Principle:** Services communicate via HTTP/REST (sync) or BullMQ queues (async). Each service owns its own MongoDB database. Services never access each other's databases directly.

## Monorepo Structure

- `services/` - Microservices (gateway, auth, users, etc.)
- `shared/` - Shared packages (types, errors, logger, middleware)
- `infra/` - Docker Compose and Kubernetes manifests (future)
- `pnpm-workspace.yaml` - Workspace configuration

## Development Commands

```bash
# Install dependencies
pnpm install

# Run all services in development mode
pnpm dev

# Run tests across all services
pnpm test

# Build all services
pnpm build

# Type checking
pnpm type-check

# Linting
pnpm lint

# Format code
pnpm format
```

## Service Structure

Each service follows this pattern:

```
services/{service-name}/
├── src/
│   ├── app.ts          # Express app setup
│   ├── server.ts       # Server entry point
│   └── __tests__/      # Tests
├── package.json
├── tsconfig.json
└── compose.yaml        # Service-specific Docker config
```

## Health Check Endpoints

Every service must expose:

- `GET /health` - Liveness probe (process is alive)
- `GET /ready` - Readiness probe (DB + Redis connections ready)

## Inter-Service Communication

Services use `x-inter-service-token` header for internal requests. This token is validated by each service middleware.

## Environment Variables

Each service requires:

- `MONGODB_URL` - MongoDB connection string
- `REDIS_URL` - Redis connection string
- `INTER_SERVICE_TOKEN` - Token for inter-service auth

Additional service-specific variables are defined in each service's `.env` file.

## Testing

- Framework: Vitest
- Pattern: Tests in `src/__tests__/` directory
- Run: `pnpm test` (all services) or `pnpm test` in service directory

## Important Patterns

### Middleware Order (Gateway)

CORS → Helmet → Request ID → Rate Limiter → JWT Verifier → Circuit Breaker → Cache → Proxy → Metrics

### BullMQ Queue Naming

`{service}:{entity}:{event}` (e.g., `auth:user:registered`)

### Error Handling

Use RFC 7807 Problem Details format for API errors.

### Logging

Structured JSON logging via shared logger package. Include correlationId, serviceId, timestamp.

## Current Implementation Status

### Gateway

- ✅ Reverse proxy to auth/users services (`http-proxy-middleware`)
- ✅ API versioning (`/v1` prefix)
- ✅ Rate limiting (Redis-backed, per-route limits)
- ✅ Circuit breaker (Opossum, 50% error threshold, 30s reset)
- ✅ JWT verification middleware (extracts user context, forwards via headers)
- ✅ Correlation ID injection
- ✅ Swagger UI aggregation (proxies downstream `/docs`)
- ✅ Prometheus metrics (`/metrics`)
- ✅ Health/readiness probes (`/health`, `/ready`)

### Auth Service

- ✅ `POST /register` — bcrypt password hashing, publishes `auth:user:registered` BullMQ event
- ✅ `POST /login` — RS256 JWT access token + Redis-stored refresh token (7-day TTL)
- ✅ `POST /refresh` — token rotation
- ✅ `POST /logout` — Redis-based token blocklist
- ✅ `GET /jwks` — public key endpoint for token verification
- ✅ Prometheus metrics, Swagger UI, health/readiness probes

### Users Service

- ✅ `GET /me`, `GET /:id` — profile retrieval
- ✅ `PATCH /me` — update displayName, bio
- ✅ `DELETE /me` — soft delete
- ✅ `GET /` — admin-only listing with cursor-based pagination
- ✅ BullMQ worker (`auth:user:registered`) — auto-creates profile on registration
- ✅ Prometheus metrics, Swagger UI, health/readiness probes

### Shared Packages

- ✅ `@shared/types` — `AuthUser`, `UserRole`, `ProblemDetail`, `PaginatedResponse`, `JobEvent`, `RedisKeys`
- ✅ `@shared/errors` — `AppError`, `ValidationError`, `UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError`, `ServiceUnavailableError`
- ✅ `@shared/logger` — Winston JSON logger factory (`createLogger(serviceName)`)
- ✅ `@shared/middleware` — `correlationId`, `errorHandler`, `requestLogger`, `createInterServiceAuth`, `helmetMiddleware`

### Observability Stack

- ✅ Prometheus (scrapes all services)
- ✅ Grafana (provisioned dashboards + datasource)
- ✅ Node Exporter

### Not Yet Implemented

- 🚧 Email verification (field exists on User model, no endpoint)
- 🚧 Password reset
- 🚧 OAuth/social login
- 🚧 MFA
- 🚧 Kubernetes manifests

## What to Focus On Next

1. **Email verification** — the `isEmailVerified` field is on the User model; add the endpoint + BullMQ email job
2. **Password reset** — add forgot-password / reset-password flow via BullMQ
3. **Admin endpoints** — expand beyond basic listing (ban, role management)
4. **Kubernetes manifests** — `infra/k8s/` with Deployment + Service per microservice

## See Also

- `prd.md` - Full product requirements and specifications
- `compose.yaml` - Docker Compose configuration
- Individual service READMEs (when created)
