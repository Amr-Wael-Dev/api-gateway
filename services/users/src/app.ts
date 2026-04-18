import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import redis from "./lib/redis";
import {
  correlationId,
  errorHandler,
  helmetMiddleware,
  requestLogger,
  createInterServiceAuth,
} from "@shared/middleware";
import { createLogger } from "@shared/logger";
import { ServiceCheckResult } from "@shared/types";
import { metricsMiddleware } from "./middleware/metricsMiddleware";
import { register } from "./lib/metrics";

export const logger = createLogger("users-service");

const app = express();
app.use(express.json());

app.use(helmetMiddleware);
app.use(correlationId);
app.use(requestLogger(logger));
app.use(metricsMiddleware);

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
app.get("/health", (_req, res) => {
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
app.get("/ready", async (_req, res) => {
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

/**
 * @openapi
 * /metrics:
 *   get:
 *     summary: Prometheus metrics
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Prometheus text format metrics
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 */
app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-type", register.contentType);
  return res.status(200).send(await register.metrics());
});

app.use(errorHandler(logger));

export default app;
