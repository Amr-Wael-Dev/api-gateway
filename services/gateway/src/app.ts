import "dotenv/config";
import express from "express";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";
import rateLimit, {
  MemoryStore,
  ipKeyGenerator,
  type Store,
  type Options,
} from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import redis from "./lib/redis";
import { authenticateToken } from "./middleware/authenticate";
import { probeServices } from "./lib/serviceProbes";
import {
  correlationId,
  requestLogger,
  helmetMiddleware,
  errorHandler,
} from "@shared/middleware";
import { createLogger } from "@shared/logger";
import { Service, ServiceCheckResult } from "@shared/types";
import { register } from "./lib/metrics";
import { metricsMiddleware } from "./middleware/metricsMiddleware";
import { createCircuitBreaker } from "./lib/circuitBreaker";

const app = express();

const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL!;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL!;
const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;
const rawOrigins = process.env.ALLOWED_ORIGINS!.split(",").map((o) => o.trim());
const ALLOWED_ORIGINS: string | string[] =
  rawOrigins.length === 1 && rawOrigins[0] === "*" ? "*" : rawOrigins;

const services: Service[] = [
  { name: "users", url: USERS_SERVICE_URL },
  { name: "auth", url: AUTH_SERVICE_URL },
];

export const logger = createLogger("gateway");
const limiter = (limit: number, store: Store, options: Partial<Options> = {}) =>
  rateLimit({
    windowMs: 1 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store,
    skip: (req) => req.path === "/metrics",
    ...options,
  });
const redisStore = (prefix: string) =>
  new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      redis.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  });

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(helmetMiddleware);
app.use(correlationId);
app.use(requestLogger(logger));
app.use(metricsMiddleware);

app.use(
  "/users",
  authenticateToken,
  limiter(1000, redisStore("gateway:rate-limit:users:"), {
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip ?? "")}-${req.headers["x-user-id"]}`,
  }),
  createCircuitBreaker(
    "users",
    createProxyMiddleware({
      target: USERS_SERVICE_URL,
      changeOrigin: true,
      headers: { "x-inter-service-token": INTER_SERVICE_TOKEN },
      on: {
        proxyReq: (proxyReq, req) => {
          proxyReq.setHeader(
            "x-correlation-id",
            req.headers["x-correlation-id"] ?? "",
          );
        },
      },
    }),
  ),
);

app.use(
  "/auth",
  limiter(200, redisStore("gateway:rate-limit:auth:")),
  createCircuitBreaker(
    "auth",
    createProxyMiddleware({
      target: AUTH_SERVICE_URL,
      changeOrigin: true,
      headers: { "x-inter-service-token": INTER_SERVICE_TOKEN },
      on: {
        proxyReq: (proxyReq, req) => {
          proxyReq.setHeader(
            "x-correlation-id",
            req.headers["x-correlation-id"] ?? "",
          );
        },
      },
    }),
  ),
);

app.get("/health", limiter(60, new MemoryStore()), async (_req, res) => {
  const checks: ServiceCheckResult[] = await probeServices(
    services,
    "health",
    INTER_SERVICE_TOKEN,
  );
  const allOk = checks.every((c) => c.status === "ok");
  res.status(allOk ? 200 : 503).json(checks);
});

app.get("/ready", limiter(60, new MemoryStore()), async (_req, res) => {
  const checks: ServiceCheckResult[] = await probeServices(
    services,
    "ready",
    INTER_SERVICE_TOKEN,
  );
  const allOk = checks.every((c) => c.status === "ok");
  res.status(allOk ? 200 : 503).json(checks);
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-type", register.contentType);
  return res.status(200).send(await register.metrics());
});

app.use(errorHandler(logger));

export default app;
