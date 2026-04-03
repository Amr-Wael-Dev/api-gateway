# API Gateway - Distributed Microservices Platform

This is a production-grade distributed backend system built with Node.js/TypeScript, featuring a custom API Gateway and multiple microservices.

## Project Overview

A microservices platform demonstrating distributed systems patterns including:

- Custom API Gateway with rate limiting, circuit breaker, JWT verification
- Auth Service with OAuth2, JWT tokens, and RBAC
- User Service for profile management
- Event-driven architecture using BullMQ (Redis-based job queues)
- MongoDB per service, Redis for caching/rate-limiting/queues
- Docker Compose for local development, Kubernetes for production

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

- ✅ Gateway: Basic routing, health checks, inter-service auth
- ✅ Auth: Basic health checks, DB/Redis connections
- ✅ Users: Basic health checks, DB/Redis connections
- 🚧 BullMQ integration (pending)
- 🚧 JWT verification (pending)
- 🚧 Rate limiting (pending)
- 🚧 Circuit breaker (pending)

## What to Focus On

1. **Shared packages first** - Create reusable types, errors, logger, middleware
2. **Service independence** - Each service should be independently deployable
3. **Type safety** - Use TypeScript strictly, share types via `shared/types`
4. **Event-driven design** - Use BullMQ for async operations
5. **Observability** - Every service should expose metrics eventually

## See Also

- `prd.md` - Full product requirements and specifications
- `compose.yaml` - Docker Compose configuration
- Individual service READMEs (when created)
