import "dotenv/config";
import express from "express";
import type { Response, Request, NextFunction } from "express";
import cors from "cors";
import JwksRsa from "jwks-rsa";
import jwt from "jsonwebtoken";
import { createProxyMiddleware } from "http-proxy-middleware";
import redis from "./lib/redis";

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

const getBlocklistRedisName = (jti: string) => `auth:blocklist:${jti}`;
const jwksClient = JwksRsa({ jwksUri: `${AUTH_SERVICE_URL}/jwks` });
async function getKey(kid: string) {
  const key = await jwksClient.getSigningKey(kid);
  const signingKey = key.getPublicKey();
  return signingKey;
}
async function authenticateToken(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { header } = jwt.decode(token, {
      complete: true,
    }) as jwt.Jwt;
    const { kid } = header;

    if (!kid) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const key = await getKey(kid);
    const verified = jwt.verify(token, key) as jwt.JwtPayload;
    const isBlocked =
      verified.jti &&
      (await redis.get(getBlocklistRedisName(verified.jti))) === "1";

    if (verified && !isBlocked) {
      req.headers["x-user-id"] = verified.sub;
      req.headers["x-user-role"] = verified.role;
      req.headers["x-user-email"] = verified.email;

      return next();
    }

    return res.status(403).json({ message: "Forbidden" });
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
}

app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));

app.use(
  "/users",
  authenticateToken,
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
