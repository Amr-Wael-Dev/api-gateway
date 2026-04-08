/**
 * proxy.test.ts
 *
 * Tests that the gateway correctly proxies requests to upstream services,
 * injects x-inter-service-token, and enforces JWT auth on user routes.
 *
 * Strategy:
 * - Spin up a Node.js http stub server that records received headers.
 * - Point AUTH_SERVICE_URL and USERS_SERVICE_URL at the stub server.
 * - Build a focused test Express app with the same proxy config as gateway.
 * - Mock jwks-rsa and Redis (via vi.hoisted + vi.mock) for JWT verification.
 */

import {
  describe,
  expect,
  it,
  vi,
  beforeAll,
  afterAll,
  afterEach,
} from "vitest";
import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// 1. Hoist mocks (must be declared before vi.mock factories run)
// ---------------------------------------------------------------------------
const { mockGetSigningKey, mockRedisGet } = vi.hoisted(() => ({
  mockGetSigningKey: vi.fn(),
  mockRedisGet: vi.fn(),
}));

// ---------------------------------------------------------------------------
// 2. Mock modules
// ---------------------------------------------------------------------------
vi.mock("jwks-rsa", () => ({
  default: vi.fn().mockImplementation(() => ({
    getSigningKey: mockGetSigningKey,
  })),
}));

vi.mock("../lib/redis", () => ({
  default: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    quit: vi.fn().mockResolvedValue(undefined),
    flushdb: vi.fn().mockResolvedValue(undefined),
    call: vi.fn().mockResolvedValue(null),
    keys: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(0),
  },
}));

// ---------------------------------------------------------------------------
// 3. Generate test RSA key pair
// ---------------------------------------------------------------------------
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const TEST_PRIVATE_KEY = privateKey.export({
  type: "pkcs8",
  format: "pem",
}) as string;
const TEST_PUBLIC_KEY = publicKey.export({
  type: "spki",
  format: "pem",
}) as string;
const TEST_KID = "proxy-test-kid";

// ---------------------------------------------------------------------------
// 4. Import dependencies after mocks
// ---------------------------------------------------------------------------
import { authenticateToken } from "../middleware/authenticate";
import { createProxyMiddleware } from "http-proxy-middleware";

// ---------------------------------------------------------------------------
// 5. Stub upstream server
// ---------------------------------------------------------------------------
interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const recordedRequests: RecordedRequest[] = [];

const stubServer = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  req.on("end", () => {
    recordedRequests.push({
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers,
      body,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ proxied: true }));
  });
});

let stubPort: number;
let gatewayApp: express.Express;

beforeAll(async () => {
  // Set default mock behavior
  mockGetSigningKey.mockImplementation(async () => ({
    getPublicKey: () => TEST_PUBLIC_KEY,
  }));
  mockRedisGet.mockResolvedValue(null);

  // Start stub upstream
  await new Promise<void>((resolve) => {
    stubServer.listen(0, "127.0.0.1", () => {
      const addr = stubServer.address() as { port: number };
      stubPort = addr.port;
      resolve();
    });
  });

  // Set env vars before building the app
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.USERS_SERVICE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.INTER_SERVICE_TOKEN =
    process.env.INTER_SERVICE_TOKEN ?? "super-duper-secret-token";
  process.env.ALLOWED_ORIGINS = "http://localhost:3000";

  // Build the proxy test app
  gatewayApp = buildGatewayTestApp();
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    stubServer.close((err) => (err ? reject(err) : resolve()));
  });
});

afterEach(() => {
  recordedRequests.length = 0;
  mockRedisGet.mockResolvedValue(null);
  mockGetSigningKey.mockImplementation(async () => ({
    getPublicKey: () => TEST_PUBLIC_KEY,
  }));
});

// ---------------------------------------------------------------------------
// 6. Build a gateway-like test app
// ---------------------------------------------------------------------------
function buildGatewayTestApp(): express.Express {
  const app = express();
  // Do NOT add express.json() here. The gateway proxies request bodies as raw streams.
  // Parsing the body with express.json() consumes the stream, causing http-proxy-middleware
  // to hang because the body has already been read and cannot be re-read by the proxy.

  const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;
  const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL!;
  const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL!;

  // Auth routes — no JWT required
  app.use(
    "/auth",
    createProxyMiddleware({
      target: AUTH_SERVICE_URL,
      changeOrigin: true,
      headers: { "x-inter-service-token": INTER_SERVICE_TOKEN },
    }),
  );

  // Users routes — JWT required
  app.use(
    "/users",
    authenticateToken,
    createProxyMiddleware({
      target: USERS_SERVICE_URL,
      changeOrigin: true,
      headers: { "x-inter-service-token": INTER_SERVICE_TOKEN },
    }),
  );

  return app;
}

// ---------------------------------------------------------------------------
// 7. Helper: mint valid JWT
// ---------------------------------------------------------------------------
function mintValidToken(
  payload: { sub?: string; email?: string; role?: string } = {},
): string {
  return jwt.sign(
    {
      sub: "000000000000000000000001",
      email: "user@example.com",
      role: "user",
      jti: crypto.randomUUID(),
      iss: "api-gateway.example.com",
      ...payload,
    },
    TEST_PRIVATE_KEY,
    { algorithm: "RS256", expiresIn: "15m", keyid: TEST_KID },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Gateway proxy", () => {
  describe("auth proxy", () => {
    it("POST /auth/login is forwarded to AUTH_SERVICE_URL", async () => {
      await request(gatewayApp)
        .post("/auth/login")
        .send({ email: "user@example.com", password: "Test@1234" });

      expect(recordedRequests.length).toBeGreaterThan(0);
      // http-proxy-middleware strips the mount prefix (/auth), so stub sees /login
      expect(recordedRequests[0].url).toBe("/login");
    });

    it("forwarded auth request includes x-inter-service-token header", async () => {
      await request(gatewayApp)
        .post("/auth/login")
        .send({ email: "user@example.com", password: "Test@1234" });

      const recorded = recordedRequests[0];
      expect(recorded.headers["x-inter-service-token"]).toBe(
        process.env.INTER_SERVICE_TOKEN,
      );
    });

    it("original request body is forwarded to auth upstream", async () => {
      const body = { email: "forward@example.com", password: "Secret@123" };

      await request(gatewayApp).post("/auth/login").send(body);

      const recorded = recordedRequests[0];
      const forwarded = JSON.parse(recorded.body) as typeof body;
      expect(forwarded.email).toBe(body.email);
    });
  });

  describe("users proxy", () => {
    it("GET /users/me without JWT returns 401 (blocked before proxy)", async () => {
      const res = await request(gatewayApp).get("/users/me");

      expect(res.status).toBe(401);
      // No request should have reached the stub server
      expect(recordedRequests).toHaveLength(0);
    });

    it("GET /users/me with valid JWT is forwarded to USERS_SERVICE_URL", async () => {
      const token = mintValidToken();

      await request(gatewayApp)
        .get("/users/me")
        .set("Authorization", `Bearer ${token}`);

      expect(recordedRequests.length).toBeGreaterThan(0);
      // http-proxy-middleware strips the mount prefix (/users), so stub sees /me
      expect(recordedRequests[0].url).toBe("/me");
    });

    it("forwarded users request includes x-inter-service-token header", async () => {
      const token = mintValidToken();

      await request(gatewayApp)
        .get("/users/me")
        .set("Authorization", `Bearer ${token}`);

      const recorded = recordedRequests[0];
      expect(recorded.headers["x-inter-service-token"]).toBe(
        process.env.INTER_SERVICE_TOKEN,
      );
    });

    it("forwarded users request includes x-user-id header from JWT sub", async () => {
      const sub = "abc123def456abc123def456";
      const token = mintValidToken({ sub });

      await request(gatewayApp)
        .get("/users/me")
        .set("Authorization", `Bearer ${token}`);

      const recorded = recordedRequests[0];
      expect(recorded.headers["x-user-id"]).toBe(sub);
    });

    it("forwarded users request includes x-user-role header from JWT role", async () => {
      const token = mintValidToken({ role: "moderator" });

      await request(gatewayApp)
        .get("/users/me")
        .set("Authorization", `Bearer ${token}`);

      const recorded = recordedRequests[0];
      expect(recorded.headers["x-user-role"]).toBe("moderator");
    });

    it("forwarded users request includes x-user-email header from JWT email", async () => {
      const token = mintValidToken({ email: "proxy@example.com" });

      await request(gatewayApp)
        .get("/users/me")
        .set("Authorization", `Bearer ${token}`);

      const recorded = recordedRequests[0];
      expect(recorded.headers["x-user-email"]).toBe("proxy@example.com");
    });
  });
});
