import "dotenv/config";
import express from "express";
import cors from "cors";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();

const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL!;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL!;
const ALLOWED_ORIGINS = process.env
  .ALLOWED_ORIGINS!.split(",")
  .map((origin) => origin.trim());

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

app.use(
  "/users",
  createProxyMiddleware({
    target: USERS_SERVICE_URL,
    changeOrigin: true,
  }),
);

app.use(
  "/auth",
  createProxyMiddleware({
    target: AUTH_SERVICE_URL,
    changeOrigin: true,
  }),
);

app.get("/health", (_req, res) => {
  res.json({ status: "gateway ok" });
});

export default app;
