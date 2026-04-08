import "dotenv/config";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import mongoose from "mongoose";
import rateLimit, { MemoryStore, type Store } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import redis from "./lib/redis";
import { interServiceAuth } from "./middleware/interServiceAuth";
import profileRoutes from "./routes/profile.routes";

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

app.get("/health", limiter(60, new MemoryStore()), (_req, res) => {
  res.status(200).json({ status: "ok" });
});
app.get("/ready", limiter(60, new MemoryStore()), async (_req, res) => {
  const checks = await Promise.all([
    mongoose.connection
      .db!.admin()
      .ping()
      .then(() => ({ name: "db", status: "ok" }))
      .catch(() => ({ name: "db", status: "error" })),
    redis
      .ping()
      .then(() => ({ name: "redis", status: "ok" }))
      .catch(() => ({ name: "redis", status: "error" })),
  ]);

  const allOk = checks.every((c) => c.status === "ok");
  res.status(allOk ? 200 : 503).json(checks);
});

app.use(interServiceAuth);
app.use(limiter(1000, redisStore("users:rate-limit:")));
app.use("/profiles", profileRoutes);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(`[Users - ${new Date().toISOString()}] ${error.stack}`);

  if (error.message.includes("ECONNREFUSED")) {
    console.error(`[Users] Redis is down — status: ${redis.status}`);
    return res.status(503).json({ message: "Service unavailable: redis" });
  }

  res.status(500).json({ message: "Internal Server Error" });
});

export default app;
