# Coding Conventions & Guidelines for AI Agents

This document provides coding conventions and architectural guidelines for AI assistants working on this codebase.

## Project Type

Distributed microservices platform with custom API Gateway. Node.js/TypeScript monorepo using pnpm workspaces.

## Technology Stack

- **Runtime:** Node.js with TypeScript
- **Framework:** Express.js
- **Database:** MongoDB (per service)
- **Cache/Queue:** Redis + BullMQ
- **Testing:** Vitest
- **Linting:** ESLint with TypeScript plugin
- **Formatting:** Prettier
- **Package Manager:** pnpm (workspace mode)

## Code Style

### TypeScript

- **Strict mode enabled** - All code must be fully typed
- **No `any` types** - Use proper types or `unknown` with type guards
- **Explicit return types** - Always declare function return types
- **Interfaces over types** - Prefer interfaces for object shapes
- **Avoid type assertions** - Use proper type guards instead

### Imports

```typescript
// Group imports in this order:
// 1. External dependencies
import express from "express";
import mongoose from "mongoose";

// 2. Internal shared packages
import { logger } from "@shared/logger";
import { AppError } from "@shared/errors";

// 3. Local modules
import { UserService } from "./services";
```

### Naming Conventions

- **Files:** `kebab-case.ts` (e.g., `user-service.ts`)
- **Classes:** `PascalCase` (e.g., `UserService`)
- **Functions/variables:** `camelCase` (e.g., `getUserById`)
- **Constants:** `UPPER_SNAKE_CASE` (e.g., `MAX_RETRY_COUNT`)
- **Interfaces:** `PascalCase` with no prefix (e.g., `User`, not `IUser`)
- **Environment variables:** `UPPER_SNAKE_CASE` (e.g., `MONGODB_URL`)

### Error Handling

Use the shared error classes from `@shared/errors`:

```typescript
import { AppError, ValidationError, UnauthorizedError } from "@shared/errors";

// Throw structured errors
throw new ValidationError("Invalid email format");
throw new UnauthorizedError("Token expired");
```

Follow RFC 7807 Problem Details format for API responses:

```typescript
{
  "type": "https://platform.local/errors/validation",
  "title": "Validation Error",
  "status": 400,
  "detail": "Email is required",
  "instance": "/v1/auth/register",
  "correlationId": "abc-123"
}
```

### Async/Await

- Always use `async/await` over `.then()/.catch()`
- Use try-catch for error handling
- Never leave promises floating - always handle or return

```typescript
// Good
async function getUser(id: string): Promise<User> {
  try {
    const user = await User.findById(id);
    if (!user) throw new NotFoundError("User not found");
    return user;
  } catch (error) {
    logger.error("Failed to fetch user", { error, id });
    throw error;
  }
}

// Bad
function getUser(id: string) {
  return User.findById(id)
    .then((user) => user)
    .catch((err) => err);
}
```

## Architecture Patterns

### Service Independence

Each service must:

- Own its own MongoDB database
- Not access other services' databases
- Communicate via HTTP (sync) or BullMQ (async)
- Be independently deployable and testable

### Shared Packages

Before implementing common functionality, check if it should go in `shared/`:

- `shared/types` - TypeScript interfaces shared across services
- `shared/errors` - Custom error classes
- `shared/logger` - Winston logger configuration
- `shared/middleware` - Express middleware (auth, error handling, etc.)

### Middleware Pattern

Express middleware should:

- Be typed with proper request/response types
- Use `next()` for control flow
- Handle errors gracefully
- Be registered in the correct order

```typescript
import { Request, Response, NextFunction } from "express";

export function customMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    // Do something
    next();
  } catch (error) {
    next(error);
  }
}
```

### Health Checks

Every service MUST implement:

```typescript
// Liveness - just checks if process is alive
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness - checks if service can handle requests
app.get("/ready", async (_req, res) => {
  const checks = await Promise.all([checkDatabase(), checkRedis()]);
  const allOk = checks.every((c) => c.status === "ok");
  res.status(allOk ? 200 : 503).json(checks);
});
```

### Environment Variables

- Use `dotenv/config` at the top of entry files
- Never commit `.env` files
- Use `!` assertion only after validating presence in startup
- Document required env vars in service README

```typescript
import "dotenv/config";

const REQUIRED_VARS = ["MONGODB_URL", "REDIS_URL"];
REQUIRED_VARS.forEach((varName) => {
  if (!process.env[varName]) {
    throw new Error(`Missing required env var: ${varName}`);
  }
});

const MONGODB_URL = process.env.MONGODB_URL!;
```

## Testing Guidelines

### Test Structure

```
src/__tests__/
├── setup.ts          # Test setup and mocks
├── app.test.ts       # Integration tests
└── unit/             # Unit tests for specific modules
```

### Test Naming

```typescript
describe("UserService", () => {
  describe("getUserById", () => {
    it("should return user when found", async () => {
      // ...
    });

    it("should throw NotFoundError when user not found", async () => {
      // ...
    });
  });
});
```

### What to Test

- API endpoints (integration tests)
- Business logic (unit tests)
- Error scenarios
- Edge cases
- Input validation

## BullMQ Patterns

### Queue Naming

Format: `{service}:{entity}:{event}`
Examples: `auth:user:registered`, `user:profile:updated`

### Job Structure

```typescript
interface JobData {
  id: string;
  timestamp: Date;
  payload: unknown;
  correlationId?: string;
}
```

### Worker Pattern

```typescript
import { Worker, Job } from "bullmq";

const worker = new Worker<JobData>(
  "queue-name",
  async (job: Job<JobData>) => {
    try {
      // Process job
      logger.info("Processing job", { jobId: job.id });
      // ...
    } catch (error) {
      logger.error("Job failed", { error, jobId: job.id });
      throw error; // Will be retried based on queue config
    }
  },
  { connection: redisConnection },
);
```

## Common Commands

```bash
# Development
pnpm dev                    # Run all services
pnpm dev --filter gateway   # Run specific service

# Testing
pnpm test                   # Run all tests
pnpm test --filter auth     # Run tests for specific service

# Code Quality
pnpm lint                   # Lint all code
pnpm format                 # Format with Prettier
pnpm type-check             # TypeScript type checking

# Building
pnpm build                  # Build all services
```

## What NOT to Do

- ❌ Don't use `any` types
- ❌ Don't commit `.env` files
- ❌ Don't access other services' databases
- ❌ Don't skip error handling
- ❌ Don't leave console.log statements (use logger)
- ❌ Don't create circular dependencies between services
- ❌ Don't hardcode configuration (use env vars)
- ❌ Don't skip TypeScript strict checks
- ❌ Don't use synchronous operations in hot paths
- ❌ Don't ignore lint warnings

## Service-Specific Notes

### Gateway Service

- Routes `/v1/auth/*` → auth service, `/v1/users/*` → users service
- JWT verification extracts user context; passes `x-user-id` and `x-user-role` headers upstream
- Circuit breaker: Opossum, 50% errorThresholdPercentage, 30s resetTimeout
- Rate limits: 1000 req/min for `/v1/users`, 200 req/min for `/v1/auth`
- Aggregates downstream `/docs` Swagger UIs at `/v1/auth/docs` and `/v1/users/docs`
- Gateway does NOT have its own MongoDB — stateless by design

### Auth Service

- RS256 JWT tokens (`ACCESS_TOKEN_PRIVATE_KEY` / `ACCESS_TOKEN_PUBLIC_KEY` env vars)
- Refresh tokens stored in Redis with key `auth:refresh:{userId}`, 7-day TTL
- Logout adds access token to Redis blocklist (`auth:blocklist:{jti}`)
- Publishes `auth:user:registered` (queue name constant: `Q_AUTH_USER_REGISTERED` from `@shared/types`)
- Validators live in `src/validators/auth.validators.ts` using Zod

### Users Service

- User model: `userId` (matches auth service ID), `displayName`, `bio`, `avatarUrl`, `role`, `isDeleted`
- Profile is created asynchronously by BullMQ worker consuming `auth:user:registered`
- Soft deletes: sets `isDeleted: true`, never removes documents
- Admin listing: cursor-based pagination via `?cursor=<lastId>&limit=<n>` query params
- Gateway forwards `x-user-id` / `x-user-role` headers; controllers read from `req.headers` not JWT

### BullMQ Job Structure

Use types from `@shared/types`:

```typescript
import {
  BaseJobData,
  UserRegisteredPayload,
  Q_AUTH_USER_REGISTERED,
} from "@shared/types";
```

## Resources

- **PRD:** See `prd.md` for full specifications
- **TypeScript Config:** Strict mode enabled
- **ESLint Config:** `eslint.config.mjs`
- **Docker Compose:** `compose.yaml` + service-specific compose files
