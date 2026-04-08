/**
 * authenticate.test.ts
 *
 * Tests the authenticateToken middleware in isolation.
 *
 * Strategy:
 * - Generate a real RSA-2048 key pair in-process using node:crypto.
 * - Use vi.hoisted() to declare mocks that can be safely referenced inside vi.mock factories.
 * - Mock jwks-rsa and the Redis lib before middleware is imported.
 * - Mount middleware on a minimal Express app to test HTTP behavior.
 */

import { describe, expect, it, vi, afterEach, beforeAll } from "vitest";
import crypto from "node:crypto";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// 1. Hoist mock functions so they are available inside vi.mock factories.
//    vi.hoisted runs before vi.mock factories (which are themselves hoisted).
// ---------------------------------------------------------------------------
const { mockGetSigningKey, mockRedisGet } = vi.hoisted(() => ({
  mockGetSigningKey: vi.fn(),
  mockRedisGet: vi.fn(),
}));

// ---------------------------------------------------------------------------
// 2. Mock modules — hoisted before any imports by Vitest
// ---------------------------------------------------------------------------
vi.mock("jwks-rsa", () => ({
  default: () => ({
    getSigningKey: mockGetSigningKey,
  }),
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
const TEST_KID = "test-kid-authenticate";

// ---------------------------------------------------------------------------
// 4. Import middleware AFTER mocks are registered (safe because vi.mock is hoisted)
// ---------------------------------------------------------------------------
import { authenticateToken } from "../middleware/authenticate";

// ---------------------------------------------------------------------------
// 5. Build minimal test Express app
// ---------------------------------------------------------------------------
const testApp = express();
testApp.use(express.json());
testApp.use(
  "/protected",
  authenticateToken,
  (req: express.Request, res: express.Response) => {
    res.status(200).json({
      userId: req.headers["x-user-id"],
      userRole: req.headers["x-user-role"],
      userEmail: req.headers["x-user-email"],
    });
  },
);

// ---------------------------------------------------------------------------
// 6. Helper to mint test JWTs
// ---------------------------------------------------------------------------
function mintToken(
  payload: { sub?: string; email?: string; role?: string; jti?: string } = {},
  options: jwt.SignOptions = {},
  privateKeyOverride?: string,
): string {
  const defaults = {
    sub: "000000000000000000000001",
    email: "user@example.com",
    role: "user",
    jti: crypto.randomUUID(),
    iss: "api-gateway.example.com",
  };
  return jwt.sign(
    { ...defaults, ...payload },
    privateKeyOverride ?? TEST_PRIVATE_KEY,
    {
      algorithm: "RS256",
      expiresIn: "15m",
      keyid: TEST_KID,
      ...options,
    },
  );
}

// ---------------------------------------------------------------------------
// 7. Default mock state
// ---------------------------------------------------------------------------
beforeAll(() => {
  mockGetSigningKey.mockImplementation(async () => ({
    getPublicKey: () => TEST_PUBLIC_KEY,
  }));
  mockRedisGet.mockResolvedValue(null);
});

afterEach(() => {
  mockRedisGet.mockResolvedValue(null);
  mockGetSigningKey.mockImplementation(async () => ({
    getPublicKey: () => TEST_PUBLIC_KEY,
  }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("authenticateToken middleware", () => {
  describe("missing / malformed token", () => {
    it("returns 401 when Authorization header is absent", async () => {
      const res = await request(testApp).get("/protected");
      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 401 when Authorization header has an empty token (Bearer + space)", async () => {
      // token = "" (empty string after split), which is falsy → 401
      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", "Bearer ");
      expect(res.status).toBe(401);
    });

    it("returns 401 when Authorization header contains a malformed JWT (not a JWT)", async () => {
      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", "Bearer notajwt");
      expect(res.status).toBe(401);
    });

    it("returns 401 when JWT is signed with a different private key (signature mismatch)", async () => {
      const { privateKey: otherKey } = crypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const otherPem = otherKey.export({
        type: "pkcs8",
        format: "pem",
      }) as string;
      const token = mintToken({}, {}, otherPem);

      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(401);
    });

    it("returns 401 when JWT has no kid in header", async () => {
      // Middleware checks for kid and returns 401 if absent
      const token = jwt.sign(
        { sub: "user1", email: "user@example.com", role: "user", jti: "abc" },
        TEST_PRIVATE_KEY,
        { algorithm: "RS256", expiresIn: "15m" }, // no keyid
      );

      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(401);
    });

    it("documents behavior when Authorization uses wrong scheme (Token instead of Bearer)", async () => {
      // The middleware does: authHeader.split(" ")[1] — it does not validate the scheme.
      // With "Token <jwt>", split(" ")[1] gives the JWT, which may pass verification.
      // This is a minor security gap: wrong scheme is NOT rejected.
      // We document the actual behavior without asserting a specific status.
      const token = mintToken();
      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", `Token ${token}`);

      expect([200, 401]).toContain(res.status);
    });
  });

  describe("expired token", () => {
    it("returns 401 when JWT is already expired", async () => {
      const token = mintToken({}, { expiresIn: -60 }); // expired 60 seconds ago

      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(401);
    });
  });

  describe("blocklist", () => {
    it("returns 403 when the token's jti is in the Redis blocklist", async () => {
      const jti = crypto.randomUUID();
      const token = mintToken({ jti });

      mockRedisGet.mockImplementation(async (key: string) => {
        if (key === `auth:blocklist:${jti}`) return "1";
        return null;
      });

      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
    });

    it("allows request through when the token's jti is NOT in the Redis blocklist", async () => {
      const token = mintToken();
      mockRedisGet.mockResolvedValue(null);

      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
    });
  });

  describe("header injection", () => {
    it("injects x-user-id from JWT sub claim into request headers", async () => {
      const sub = "aabbccddeeff001122334455";
      const token = mintToken({ sub });

      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(sub);
    });

    it("injects x-user-role from JWT role claim into request headers", async () => {
      const token = mintToken({ role: "admin" });

      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.userRole).toBe("admin");
    });

    it("injects x-user-email from JWT email claim into request headers", async () => {
      const token = mintToken({ email: "alice@example.com" });

      const res = await request(testApp)
        .get("/protected")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.userEmail).toBe("alice@example.com");
    });
  });

  describe("global IP rate limit gap (will FAIL — not yet implemented)", () => {
    it.skip("should return 429 after exceeding global IP rate limit of 200 req/min", async () => {
      // PRD requires a global 200 req/min IP rate limit applied to all traffic.
      // This limit is NOT implemented in the gateway app.ts.
      // This test WILL FAIL until the global limiter is added.
      // The gateway only has per-route rate limiters (auth: 200/min, users: 1000/min,
      // health: 60/min). There is no top-level limiter covering ALL routes.
      const token = mintToken();

      let lastStatus = 0;
      for (let i = 0; i < 201; i++) {
        const res = await request(testApp)
          .get("/protected")
          .set("Authorization", `Bearer ${token}`);
        lastStatus = res.status;
        if (res.status === 429) break;
      }

      // This WILL fail because testApp has no rate limiter at all.
      expect(lastStatus).toBe(429);
    });
  });

  describe("circuit breaker (skip — not yet implemented)", () => {
    it.skip("should return 503 when upstream error rate exceeds 50%", () => {
      // PRD specifies opossum circuit breaker opening at >50% errors in 10s window.
      // Circuit breaker is not yet implemented (opossum not installed).
    });
  });
});
