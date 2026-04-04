import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import redis from "./lib/redis";
import authRouter from "./routes/auth.routes";
import { jwks } from "./controllers/auth.controller";
import { interServiceAuth } from "./middleware/interServiceAuth";

const app = express();
app.use(express.json());

app.get("/jwks", jwks);

app.use(interServiceAuth);

app.use(authRouter);

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
