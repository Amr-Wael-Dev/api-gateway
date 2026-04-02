import "dotenv/config";
import express from "express";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();

const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL!;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL!;
const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;
const ALLOWED_ORIGINS = process.env
  .ALLOWED_ORIGINS!.split(",")
  .map((origin) => origin.trim());

interface Service {
  name: string;
  url: string;
}

const services: Service[] = [
  {
    name: "users",
    url: USERS_SERVICE_URL,
  },
  {
    name: "auth",
    url: AUTH_SERVICE_URL,
  },
];

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

app.use(
  "/users",
  createProxyMiddleware({
    target: USERS_SERVICE_URL,
    changeOrigin: true,
    headers: { "x-inter-service-token": INTER_SERVICE_TOKEN },
  }),
);

app.use(
  "/auth",
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
    headers: { "x-inter-service-token": INTER_SERVICE_TOKEN },
  }),
);

app.get("/health", async (_req, res) => {
  const checks = await Promise.all(
    services.map(async ({ name, url }) => {
      try {
        const response = await fetch(`${url}/health`, {
          headers: { "x-inter-service-token": INTER_SERVICE_TOKEN },
        });
        const body = await response.json();
        return { name, status: response.ok ? "ok" : "error", ...body };
      } catch {
        return { name, status: "unreachable" };
      }
    }),
  );

  const allOk = checks.every((c) => c.status === "ok");
  res.status(allOk ? 200 : 503).json(checks);
});

app.get("/ready", async (_req, res) => {
  const checks = await Promise.all(
    services.map(async ({ name, url }) => {
      try {
        const response = await fetch(`${url}/ready`, {
          headers: { "x-inter-service-token": INTER_SERVICE_TOKEN },
        });
        const body = await response.json();
        return { name, status: response.ok ? "ok" : "error", ...body };
      } catch {
        return { name, status: "unreachable" };
      }
    }),
  );

  const allOk = checks.every((c) => c.status === "ok");
  res.status(allOk ? 200 : 503).json(checks);
});

export default app;
