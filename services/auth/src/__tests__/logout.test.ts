import { describe, expect, it } from "vitest";
import jwt from "jsonwebtoken";
import request from "supertest";
import redis from "../lib/redis";
import app from "../app";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;
const VALID_PASSWORD = "Test@1234";
const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY!;

function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

function signToken(
  payload: Record<string, unknown>,
  options?: jwt.SignOptions,
): string {
  return jwt.sign(payload, JWT_PRIVATE_KEY, {
    algorithm: "RS256",
    ...options,
  });
}

async function registerAndLogin(
  email: string,
  password: string = VALID_PASSWORD,
): Promise<{ accessToken: string; refreshToken: string }> {
  await request(app)
    .post("/register")
    .set("x-inter-service-token", INTER_SERVICE_TOKEN)
    .send({ email, password });

  const loginRes = await request(app)
    .post("/login")
    .set("x-inter-service-token", INTER_SERVICE_TOKEN)
    .send({ email, password });

  return {
    accessToken: loginRes.body.accessToken,
    refreshToken: loginRes.body.refreshToken,
  };
}

describe("POST /logout", () => {
  describe("authentication", () => {
    it("returns 403 without inter-service token", async () => {
      const res = await request(app).post("/logout").send({
        accessToken: "some-token",
        refreshToken: crypto.randomUUID(),
      });

      expect(res.status).toBe(403);
    });

    it("returns 403 with invalid inter-service token", async () => {
      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", "wrong")
        .send({
          accessToken: "some-token",
          refreshToken: crypto.randomUUID(),
        });

      expect(res.status).toBe(403);
    });
  });

  describe("success cases", () => {
    it("returns 204 with no body on successful logout", async () => {
      const { accessToken, refreshToken } = await registerAndLogin(
        "logout-ok@example.com",
      );

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken, refreshToken });

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });

    it("returns 204 even if refresh token does not exist in Redis", async () => {
      const { accessToken } = await registerAndLogin(
        "logout-no-ref@example.com",
      );

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          accessToken,
          refreshToken: crypto.randomUUID(),
        });

      expect(res.status).toBe(204);
    });
  });

  describe("token revocation (blocklist)", () => {
    it("deletes refresh token from Redis", async () => {
      const { accessToken, refreshToken } = await registerAndLogin(
        "logout-del-ref@example.com",
      );

      expect(
        await redis.get(`auth:refresh-token:${refreshToken}`),
      ).not.toBeNull();

      await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken, refreshToken });

      expect(await redis.get(`auth:refresh-token:${refreshToken}`)).toBeNull();
    });

    it("adds access token jti to blocklist with correct TTL", async () => {
      const { accessToken, refreshToken } = await registerAndLogin(
        "logout-block@example.com",
      );

      const { jti, exp } = decodeJwtPayload(accessToken) as {
        jti: string;
        exp: number;
      };

      await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken, refreshToken });

      const blocklistValue = await redis.get(`auth:blocklist:${jti}`);
      expect(blocklistValue).toBe("1");

      const ttl = await redis.ttl(`auth:blocklist:${jti}`);
      const now = Math.floor(Date.now() / 1000);
      const expectedTTL = exp - now;
      expect(ttl).toBeGreaterThan(expectedTTL - 2);
      expect(ttl).toBeLessThanOrEqual(expectedTTL);
    });
  });

  describe("access token edge cases", () => {
    it("handles expired access token (ignoreExpiration is used)", async () => {
      const { refreshToken } = await registerAndLogin(
        "logout-expired@example.com",
      );

      const expiredToken = signToken(
        {
          email: "logout-expired@example.com",
          role: "user",
          sub: "user-id",
          jti: "expired-logout-jti",
        },
        {
          keyid: "test-kid",
          expiresIn: "-1s",
          issuer: "api-gateway.example.com",
        },
      );

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken: expiredToken, refreshToken });

      expect(res.status).toBe(204);
    });

    it("does not set blocklist entry when access token has no remaining TTL", async () => {
      const { refreshToken } = await registerAndLogin(
        "logout-no-ttl@example.com",
      );

      const jti = "no-ttl-jti";
      const token = signToken(
        {
          email: "logout-no-ttl@example.com",
          role: "user",
          sub: "user-id",
          jti,
        },
        {
          keyid: "test-kid",
          expiresIn: "-100s",
          issuer: "api-gateway.example.com",
        },
      );

      await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken: token, refreshToken });

      const blocklistValue = await redis.get(`auth:blocklist:${jti}`);
      expect(blocklistValue).toBeNull();
    });
  });

  describe("input validation", () => {
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
        .send({ refreshToken: crypto.randomUUID() });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when refreshToken is missing", async () => {
      const { accessToken } = await registerAndLogin(
        "logout-no-rt@example.com",
      );

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when refreshToken is not a valid UUID", async () => {
      const { accessToken } = await registerAndLogin(
        "logout-bad-rt@example.com",
      );

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken, refreshToken: "not-a-uuid" });

      expect(res.status).toBe(400);
    });

    it("returns 400 when accessToken is null", async () => {
      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken: null, refreshToken: crypto.randomUUID() });

      expect(res.status).toBe(400);
    });

    it("returns 400 when accessToken is an empty string", async () => {
      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ accessToken: "", refreshToken: crypto.randomUUID() });

      expect(res.status).toBe(400);
    });
  });

  describe("invalid access token", () => {
    it("returns 400 when accessToken is not a valid JWT", async () => {
      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          accessToken: "not-a-jwt",
          refreshToken: crypto.randomUUID(),
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when accessToken is signed with a wrong key", async () => {
      const { privateKey } = await import("node:crypto").then((c) =>
        c.generateKeyPairSync("rsa", { modulusLength: 2048 }),
      );
      const wrongToken = jwt.sign(
        { email: "test", role: "user", sub: "123", jti: "wrong-key-jti" },
        privateKey.export({ type: "pkcs8", format: "pem" }) as string,
        { algorithm: "RS256" },
      );

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          accessToken: wrongToken,
          refreshToken: crypto.randomUUID(),
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 when access token has no jti claim", async () => {
      const token = signToken({
        email: "no-jti@example.com",
        role: "user",
        sub: "user-id",
      });

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          accessToken: token,
          refreshToken: crypto.randomUUID(),
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when access token has no exp claim", async () => {
      const token = jwt.sign(
        {
          email: "no-exp@example.com",
          role: "user",
          sub: "user-id",
          jti: "no-exp-jti",
        },
        JWT_PRIVATE_KEY,
        { algorithm: "RS256", notBefore: 0 },
      );

      const res = await request(app)
        .post("/logout")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          accessToken: token,
          refreshToken: crypto.randomUUID(),
        });

      expect(res.status).toBe(400);
    });
  });
});
