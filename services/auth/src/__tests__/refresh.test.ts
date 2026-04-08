import { describe, expect, it } from "vitest";
// Note: it.fails() marks a test as an *expected* failure. If the implementation
// is fixed and the test starts passing, it.fails() itself will fail — prompting
// the developer to promote the test to a regular it().
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app";
import redis from "../lib/redis";
import User from "../models/User";
import { registerUser, loginUser } from "./helpers";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString());
}

function decodeJwtHeader(token: string): Record<string, unknown> {
  const parts = token.split(".");
  return JSON.parse(Buffer.from(parts[0], "base64url").toString());
}

describe("POST /refresh", () => {
  describe("authentication", () => {
    it("returns 403 when x-inter-service-token header is missing", async () => {
      const res = await request(app)
        .post("/refresh")
        .send({ refreshToken: "00000000-0000-4000-8000-000000000000" });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });

    it("returns 403 when x-inter-service-token is invalid", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", "wrong-token")
        .send({ refreshToken: "00000000-0000-4000-8000-000000000000" });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });
  });

  describe("validation", () => {
    it("returns 400 when body is empty", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when refreshToken is missing", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ other: "field" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when refreshToken is not a UUID string", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: "not-a-uuid-string" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when refreshToken is null", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: null });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when refreshToken is a number", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: 12345 });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("success", () => {
    it("returns 200 with accessToken and refreshToken for valid refresh token", async () => {
      const email = `refresh-success-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
    });

    it("new accessToken is a valid three-part JWT", async () => {
      const email = `refresh-jwt-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const parts = res.body.accessToken.split(".");
      expect(parts).toHaveLength(3);
    });

    it("new accessToken uses RS256 algorithm", async () => {
      const email = `refresh-alg-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const decoded = jwt.decode(res.body.accessToken, { complete: true });
      expect((decoded as jwt.Jwt).header.alg).toBe("RS256");
    });

    it("new accessToken has kid in header", async () => {
      const email = `refresh-kid-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const header = decodeJwtHeader(res.body.accessToken);
      expect(header.kid).toBeDefined();
      expect(typeof header.kid).toBe("string");
    });

    it("new accessToken payload contains sub, email, role, jti, iss claims", async () => {
      const email = `refresh-claims-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const payload = decodeJwtPayload(res.body.accessToken);
      expect(payload.sub).toBeDefined();
      expect(payload.email).toBe(email);
      expect(payload.role).toBeDefined();
      expect(typeof payload.jti).toBe("string");
      expect(payload.iss).toBe("api-gateway.example.com");
    });

    it("new accessToken expires in exactly 15 minutes (exp - iat === 900)", async () => {
      const email = `refresh-exp-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const { exp, iat } = decodeJwtPayload(res.body.accessToken) as {
        exp: number;
        iat: number;
      };
      expect(exp - iat).toBe(900);
    });

    it("new refreshToken is a UUID v4 string", async () => {
      const email = `refresh-uuid-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(res.body.refreshToken).toMatch(UUID_REGEX);
    });

    it("new refreshToken is stored in Redis at auth:refresh-token:{newToken}", async () => {
      const email = `refresh-redis-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const newRefreshToken = res.body.refreshToken;
      const stored = await redis.get(`auth:refresh-token:${newRefreshToken}`);
      expect(stored).not.toBeNull();
    });

    it("new refreshToken Redis TTL is approximately 7 days (604800 seconds)", async () => {
      const email = `refresh-ttl-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const newRefreshToken = res.body.refreshToken;
      const ttl = await redis.ttl(`auth:refresh-token:${newRefreshToken}`);
      const sevenDays = 60 * 60 * 24 * 7;
      expect(ttl).toBeGreaterThan(sevenDays - 10);
      expect(ttl).toBeLessThanOrEqual(sevenDays);
    });

    it("old refreshToken is deleted from Redis after rotation", async () => {
      const email = `refresh-del-old-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken: oldToken } = await loginUser(email);

      await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: oldToken });

      const stored = await redis.get(`auth:refresh-token:${oldToken}`);
      expect(stored).toBeNull();
    });

    it("response body has exactly the keys ['accessToken', 'refreshToken']", async () => {
      const email = `refresh-keys-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const keys = Object.keys(res.body).sort();
      expect(keys).toEqual(["accessToken", "refreshToken"]);
    });
  });

  describe("rotation security", () => {
    it("old refresh token cannot be reused after rotation — returns 401", async () => {
      const email = `refresh-reuse-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken: oldToken } = await loginUser(email);

      // First refresh (rotates the old token)
      await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: oldToken });

      // Attempt to reuse the old token
      const secondRefresh = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: oldToken });

      expect(secondRefresh.status).toBe(401);
    });

    it("each refresh produces a unique jti in the new accessToken", async () => {
      const email = `refresh-jti-${Date.now()}@example.com`;
      await registerUser(email);
      const { accessToken: firstAccess, refreshToken: firstRefresh } =
        await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: firstRefresh });

      const firstJti = decodeJwtPayload(firstAccess).jti;
      const secondJti = decodeJwtPayload(res.body.accessToken).jti;
      expect(firstJti).not.toBe(secondJti);
    });

    it("new refreshToken is different from old refreshToken", async () => {
      const email = `refresh-newtoken-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken: oldToken } = await loginUser(email);

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: oldToken });

      expect(res.body.refreshToken).not.toBe(oldToken);
    });
  });

  describe("unauthorized", () => {
    it("returns 401 for a non-existent refresh token (valid UUID format but not in Redis)", async () => {
      const unknownToken = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: unknownToken });

      expect(res.status).toBe(401);
    });

    it("returns 401 when valid UUID maps to a hard-deleted MongoDB user", async () => {
      const email = `refresh-deleted-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      // Hard-delete the user from MongoDB (simulating data inconsistency)
      await User.deleteOne({ email });

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(res.status).toBe(401);
    });
  });

  describe("security gap — soft-deleted user (will FAIL — not yet implemented)", () => {
    it.fails("should return 401 when the user is soft-deleted", async () => {
      // PRD requires soft-deleted users to be blocked at refresh time.
      // The refresh controller currently does not check user.isDeleted.
      // This test WILL FAIL until the controller is fixed.
      const email = `refresh-softdel-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      // Soft-delete the user
      await User.findOneAndUpdate({ email }, { isDeleted: true });

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(res.status).toBe(401);
    });
  });

  describe("resilience", () => {
    it("returns 503 when Redis is unavailable", async () => {
      const email = `refresh-redis-down-${Date.now()}@example.com`;
      await registerUser(email);
      const { refreshToken } = await loginUser(email);

      // Force Redis get to throw
      const originalGet = redis.get.bind(redis);
      (redis as unknown as Record<string, unknown>).get = () =>
        Promise.reject(new Error("ECONNREFUSED"));

      let res;
      try {
        res = await request(app)
          .post("/refresh")
          .set("x-inter-service-token", INTER_SERVICE_TOKEN)
          .send({ refreshToken });
      } finally {
        (redis as unknown as Record<string, unknown>).get = originalGet;
      }

      expect(res!.status).toBe(503);
    });
  });
});
