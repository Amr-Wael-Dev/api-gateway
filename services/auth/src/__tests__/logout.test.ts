import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../app";
import redis from "../lib/redis";
import { registerUser, loginUser } from "./helpers";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;
const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY!;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  return JSON.parse(Buffer.from(parts[1], "base64url").toString());
}

describe("POST /logout", () => {
  describe("authentication", () => {
    it("returns 403 when x-inter-service-token header is missing", async () => {
      const res = await request(app).post("/logout").send({
        accessToken: "sometoken",
        refreshToken: "00000000-0000-4000-8000-000000000000",
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });

    it("returns 403 when x-inter-service-token is invalid", async () => {
      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", "not-the-right-token")
        .send({
          accessToken: "sometoken",
          refreshToken: "00000000-0000-4000-8000-000000000000",
        });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });
  });

  describe("validation", () => {
    it("returns 400 when body is empty", async () => {
      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when accessToken is missing", async () => {
      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: "00000000-0000-4000-8000-000000000000" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when refreshToken is missing", async () => {
      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken: "some.access.token" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when refreshToken is not a UUID format", async () => {
      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken: "some.access.token", refreshToken: "not-a-uuid" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when accessToken is not a valid JWT string (controller verifies it)", async () => {
      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          accessToken: "notajwt",
          refreshToken: "00000000-0000-4000-8000-000000000000",
        });

      // The validator accepts any non-empty string, but the controller does jwt.verify()
      // with ignoreExpiration:true and returns 400 for invalid JWT structure
      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("success", () => {
    it("returns 204 with no body for valid tokens", async () => {
      const email = `logout-success-${Date.now()}@example.com`;
      await registerUser(email);
      const { accessToken, refreshToken } = await loginUser(email);

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken, refreshToken });

      expect(res.status).toBe(204);
      expect(res.text).toBe("");
    });

    it("deletes refresh token from Redis after logout", async () => {
      const email = `logout-del-refresh-${Date.now()}@example.com`;
      await registerUser(email);
      const { accessToken, refreshToken } = await loginUser(email);

      await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken, refreshToken });

      const stored = await redis.get(`auth:refresh-token:${refreshToken}`);
      expect(stored).toBeNull();
    });

    it("adds jti to Redis blocklist after logout (value is '1')", async () => {
      const email = `logout-blocklist-${Date.now()}@example.com`;
      await registerUser(email);
      const { accessToken, refreshToken } = await loginUser(email);

      const { jti } = decodeJwtPayload(accessToken) as { jti: string };

      await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken, refreshToken });

      const blocked = await redis.get(`auth:blocklist:${jti}`);
      expect(blocked).toBe("1");
    });

    it("blocklist key has a positive TTL (will expire)", async () => {
      const email = `logout-ttl-${Date.now()}@example.com`;
      await registerUser(email);
      const { accessToken, refreshToken } = await loginUser(email);

      const { jti } = decodeJwtPayload(accessToken) as { jti: string };

      await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken, refreshToken });

      const ttl = await redis.ttl(`auth:blocklist:${jti}`);
      expect(ttl).toBeGreaterThan(0);
    });
  });

  describe("edge cases", () => {
    it("logout with an already-expired access token: jti is NOT added to blocklist", async () => {
      // PRD does not specify behavior for expired tokens on logout.
      // Current implementation skips blocklisting when token is already expired (remTTL <= 0).
      const email = `logout-expired-${Date.now()}@example.com`;
      await registerUser(email);

      // Generate an expired token using the same private key
      const expiredToken = jwt.sign({ email, role: "user" }, JWT_PRIVATE_KEY, {
        algorithm: "RS256",
        expiresIn: -1, // already expired
        issuer: "api-gateway.example.com",
        subject: "000000000000000000000001",
        jwtid: crypto.randomUUID(),
      });

      const { jti } = decodeJwtPayload(expiredToken) as { jti: string };
      const refreshToken = "00000000-0000-4000-8000-000000000001";

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken: expiredToken, refreshToken });

      // Controller returns 204 even for expired tokens (verifies with ignoreExpiration:true)
      expect(res.status).toBe(204);

      // The jti is NOT blocklisted because remTTL <= 0
      const blocked = await redis.get(`auth:blocklist:${jti}`);
      expect(blocked).toBeNull();
    });

    it("non-existent refreshToken (valid UUID but not in Redis) returns 204 (redis.del is a no-op)", async () => {
      // PRD does not forbid logout with an unknown refresh token.
      // The controller does redis.del which is a no-op for missing keys, then returns 204.
      const email = `logout-norefresh-${Date.now()}@example.com`;
      await registerUser(email);
      const { accessToken } = await loginUser(email);

      const unknownRefreshToken = "ffffffff-ffff-4fff-bfff-ffffffffffff";

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken, refreshToken: unknownRefreshToken });

      expect(res.status).toBe(204);
    });
  });

  describe("security", () => {
    it("after logout, calling POST /refresh with the same refreshToken returns 401", async () => {
      const email = `logout-refresh-reuse-${Date.now()}@example.com`;
      await registerUser(email);
      const { accessToken, refreshToken } = await loginUser(email);

      await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken, refreshToken });

      const refreshRes = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(refreshRes.status).toBe(401);
    });
  });
});
