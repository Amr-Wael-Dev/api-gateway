import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import Redis from "ioredis";
import { interServiceAuth } from "./middleware/interServiceAuth";

const redis = new Redis(process.env.REDIS_URL!);

const app = express();
app.use(express.json());

app.use(interServiceAuth);

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/ready", async (_req, res) => {
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

export default app;
