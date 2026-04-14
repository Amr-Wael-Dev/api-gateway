import { describe, expect, it } from "vitest";
import request from "supertest";
import User from "../models/User";
import redis from "../lib/redis";
import app from "../app";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;
const VALID_PASSWORD = "Test@1234";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

async function registerAndLogin(
  email: string,
  password: string = VALID_PASSWORD,
): Promise<{ userId: string; accessToken: string; refreshToken: string }> {
  const regRes = await request(app)
    .post("/register")
    .set("x-inter-service-token", INTER_SERVICE_TOKEN)
    .send({ email, password });

  const loginRes = await request(app)
    .post("/login")
    .set("x-inter-service-token", INTER_SERVICE_TOKEN)
    .send({ email, password });

  return {
    userId: regRes.body.id,
    accessToken: loginRes.body.accessToken,
    refreshToken: loginRes.body.refreshToken,
  };
}

describe("POST /refresh", () => {
  describe("authentication", () => {
    it("returns 403 without inter-service token", async () => {
      const res = await request(app)
        .post("/refresh")
        .send({ refreshToken: crypto.randomUUID() });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });

    it("returns 403 with invalid inter-service token", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", "wrong")
        .send({ refreshToken: crypto.randomUUID() });

      expect(res.status).toBe(403);
    });
  });

  describe("success cases", () => {
    it("returns 200 with new accessToken and refreshToken", async () => {
      const { refreshToken } = await registerAndLogin("refresh-ok@example.com");

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
      expect(res.body.accessToken).not.toBe(refreshToken);
    });

    it("issues tokens that differ from the original pair", async () => {
      const { accessToken, refreshToken } = await registerAndLogin(
        "refresh-diff@example.com",
      );

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(res.body.accessToken).not.toBe(accessToken);
      expect(res.body.refreshToken).not.toBe(refreshToken);
    });

    it("new access token has valid JWT structure and claims", async () => {
      const { refreshToken } = await registerAndLogin(
        "refresh-jwt@example.com",
      );

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const payload = decodeJwtPayload(res.body.accessToken);
      expect(payload.email).toBeDefined();
      expect(payload.role).toBeDefined();
      expect(payload.sub).toBeDefined();
      expect(payload.jti).toBeDefined();
      expect(payload.iss).toBe("api-gateway.example.com");
    });

    it("new refresh token is a UUID v4", async () => {
      const { refreshToken } = await registerAndLogin(
        "refresh-uuid@example.com",
      );

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(res.body.refreshToken).toMatch(UUID_REGEX);
    });
  });

  describe("token rotation", () => {
    it("deletes old refresh token from Redis", async () => {
      const { refreshToken } = await registerAndLogin("rotate-old@example.com");

      const oldKey = `auth:refresh-token:${refreshToken}`;
      expect(await redis.get(oldKey)).not.toBeNull();

      await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(await redis.get(oldKey)).toBeNull();
    });

    it("stores new refresh token in Redis", async () => {
      const { refreshToken: oldRefreshToken } = await registerAndLogin(
        "rotate-new@example.com",
      );

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: oldRefreshToken });

      const newKey = `auth:refresh-token:${res.body.refreshToken}`;
      expect(await redis.get(newKey)).not.toBeNull();
    });

    it("new refresh token Redis entry has correct TTL", async () => {
      const { refreshToken } = await registerAndLogin("rotate-ttl@example.com");

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const ttl = await redis.ttl(
        `auth:refresh-token:${res.body.refreshToken}`,
      );
      const sevenDaysInSeconds = 60 * 60 * 24 * 7;
      expect(ttl).toBeGreaterThan(sevenDaysInSeconds - 5);
      expect(ttl).toBeLessThanOrEqual(sevenDaysInSeconds);
    });

    it("reusing the same refresh token returns 401 (old token is invalidated)", async () => {
      const { refreshToken } = await registerAndLogin(
        "rotate-reuse@example.com",
      );

      await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(res.status).toBe(401);
    });
  });

  describe("input validation", () => {
    it("returns 400 when refreshToken is missing", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when refreshToken is not a valid UUID", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: "not-a-uuid" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when refreshToken is a number", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: 12345 });

      expect(res.status).toBe(400);
    });
  });

  describe("invalid or expired refresh token", () => {
    it("returns 401 for a non-existent refresh token", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: crypto.randomUUID() });

      expect(res.status).toBe(401);
    });

    it("returns 401 for a random string that looks like a UUID", async () => {
      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken: "00000000-0000-4000-a000-000000000000" });

      expect(res.status).toBe(401);
    });
  });

  describe("user state", () => {
    it("returns 200 for a soft-deleted user (controller does not check isDeleted)", async () => {
      const { refreshToken } = await registerAndLogin(
        "refresh-deleted@example.com",
      );
      await User.findOneAndUpdate(
        { email: "refresh-deleted@example.com" },
        { isDeleted: true },
      );

      const res = await request(app)
        .post("/refresh")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ refreshToken });

      expect(res.status).toBe(200);
    });
  });

  describe("concurrency", () => {
    it("two concurrent refresh requests with the same token: one succeeds and the other fails", async () => {
      const { refreshToken } = await registerAndLogin(
        "refresh-concurrent@example.com",
      );

      const [res1, res2] = await Promise.all([
        request(app)
          .post("/refresh")
          .set("x-inter-service-token", INTER_SERVICE_TOKEN)
          .send({ refreshToken }),
        request(app)
          .post("/refresh")
          .set("x-inter-service-token", INTER_SERVICE_TOKEN)
          .send({ refreshToken }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toContain(200);
      expect(statuses).toContain(401);
    });
  });

  describe("availability", () => {
    it("returns 503 when Redis is unavailable", async () => {
      const { refreshToken } = await registerAndLogin(
        "refresh-redis@example.com",
      );

      const originalGetdel = redis.getdel.bind(redis);
      (redis as unknown as Record<string, unknown>).getdel = () =>
        Promise.reject(new Error("ECONNREFUSED"));

      let res: { status: number } | undefined;
      try {
        res = await request(app)
          .post("/refresh")
          .set("x-inter-service-token", INTER_SERVICE_TOKEN)
          .send({ refreshToken });
      } finally {
        (redis as unknown as Record<string, unknown>).getdel = originalGetdel;
      }

      expect(res!.status).toBe(503);
    });
  });
});
