import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import rateLimit, { MemoryStore, type Store } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import swaggerUi from "swagger-ui-express";
import redis from "./lib/redis";
import authRouter from "./routes/auth.routes";
import { jwks } from "./controllers/auth.controller";
import { swaggerSpec } from "./swagger";
import {
  correlationId,
  errorHandler,
  helmetMiddleware,
  requestLogger,
  createInterServiceAuth,
} from "@shared/middleware";
import { createLogger } from "@shared/logger";
import { ServiceCheckResult } from "@shared/types";

export const logger = createLogger("auth-service");
const limiter = (limit: number, store: Store) =>
  rateLimit({
    windowMs: 1 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store,
  });
const redisStore = (prefix: string) =>
  new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      redis.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  });

const app = express();
app.use(express.json());

app.use(helmetMiddleware);
app.use(correlationId);
app.use(requestLogger(logger));

app.use("/docs.json", (_req, res) => res.json(swaggerSpec));
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @openapi
 * /jwks:
 *   get:
 *     summary: Get public keys (JWKS)
 *     tags: [System]
 *     responses:
 *       200:
 *         description: JWKS keys
 */
app.get("/jwks", limiter(60, new MemoryStore()), jwks);

/**
 * @openapi
 * /health:
 *   get:
 *     summary: Health check
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Service is healthy
 */
app.get("/health", limiter(60, new MemoryStore()), (_req, res) => {
  const healthCheckResult: ServiceCheckResult = {
    name: "health",
    status: "ok",
  };
  res.status(200).json(healthCheckResult);
});

/**
 * @openapi
 * /ready:
 *   get:
 *     summary: Readiness check (DB + Redis)
 *     tags: [System]
 *     responses:
 *       200:
 *         description: All services ready
 *       503:
 *         description: Dependencies not ready
 */
app.get("/ready", limiter(60, new MemoryStore()), async (_req, res) => {
  const checks: ServiceCheckResult[] = await Promise.all([
    mongoose.connection
      .db!.admin()
      .ping()
      .then(() => ({ name: "db", status: "ok" as const }))
      .catch(() => ({ name: "db", status: "error" as const })),
    redis
      .ping()
      .then(() => ({ name: "redis", status: "ok" as const }))
      .catch(() => ({ name: "redis", status: "error" as const })),
  ]);

  const allOk = checks.every((c) => c.status === "ok");
  res.status(allOk ? 200 : 503).json(checks);
});

app.use(createInterServiceAuth(process.env.INTER_SERVICE_TOKEN!));
app.use(limiter(10, redisStore("auth:rate-limit:")));
app.use(authRouter);

app.use(errorHandler(logger));

export default app;
