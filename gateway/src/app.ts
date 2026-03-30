import "dotenv/config";
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();

const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL!;
const ORDERS_SERVICE_URL = process.env.ORDERS_SERVICE_URL!;

app.use(
  "/users",
  createProxyMiddleware({
    target: USERS_SERVICE_URL,
    changeOrigin: true,
  }),
);

app.use(
  "/orders",
  createProxyMiddleware({
    target: ORDERS_SERVICE_URL,
    changeOrigin: true,
  }),
);

app.get("/health", (_req, res) => {
  res.json({ status: "gateway ok" });
});

export default app;
