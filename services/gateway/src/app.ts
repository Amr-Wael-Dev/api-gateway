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

const app = express();

const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL!;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL!;
const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;
const ALLOWED_ORIGINS = process.env
  .ALLOWED_ORIGINS!.split(",")
  .map((origin) => origin.trim());

const services = [
  { name: "users", url: USERS_SERVICE_URL },
  { name: "auth", url: AUTH_SERVICE_URL },
];

const limiter = (limit: number, store: Store, options: Partial<Options> = {}) =>
  rateLimit({
    windowMs: 1 * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store,
    ...options,
  });
const redisStore = (prefix: string) =>
  new RedisStore({
    prefix,
    sendCommand: (...args: string[]) =>
      redis.call(args[0], ...args.slice(1)) as Promise<RedisReply>,
  });

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

app.use(
  "/users",
  authenticateToken,
  limiter(1000, redisStore("users:rate-limit:"), {
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip ?? "")}-${req.headers["x-user-id"]}`,
  }),
  createProxyMiddleware({
    target: USERS_SERVICE_URL,
    changeOrigin: true,
    headers: { "x-inter-service-token": INTER_SERVICE_TOKEN },
  }),
);

app.use(
  "/auth",
  limiter(200, redisStore("auth:rate-limit:")),
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    headers: { "x-inter-service-token": INTER_SERVICE_TOKEN },
  }),
);

app.get("/health", limiter(60, new MemoryStore()), async (_req, res) => {
  const checks = await probeServices(services, "health", INTER_SERVICE_TOKEN);
  const allOk = checks.every((c) => c.status === "ok");
  res.status(allOk ? 200 : 503).json(checks);
});

app.get("/ready", limiter(60, new MemoryStore()), async (_req, res) => {
  const checks = await probeServices(services, "ready", INTER_SERVICE_TOKEN);
  const allOk = checks.every((c) => c.status === "ok");
  res.status(allOk ? 200 : 503).json(checks);
});

export default app;
