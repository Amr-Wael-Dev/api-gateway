import { describe, expect, it } from "vitest";
import request from "supertest";
import User from "../models/User";
import redis from "../lib/redis";
import app from "../app";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;

const VALID_EMAIL = "test@example.com";
const VALID_PASSWORD = "Test@1234";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function registerUser(
  email: string,
  password: string = VALID_PASSWORD,
): Promise<string> {
  const res = await request(app)
    .post("/register")
    .set("x-inter-service-token", INTER_SERVICE_TOKEN)
    .send({ email, password });
  return res.body.id;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
}

function decodeJwtHeader(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString());
}

describe("POST /login", () => {
  describe("authentication", () => {
    it("returns 403 when x-inter-service-token header is missing", async () => {
      const res = await request(app).post("/login").send({
        email: VALID_EMAIL,
        password: VALID_PASSWORD,
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });

    it("returns 403 when x-inter-service-token is invalid", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", "not-the-right-token")
        .send({
          email: VALID_EMAIL,
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });
  });

  describe("success", () => {
    it("returns 200 with accessToken and refreshToken for valid credentials", async () => {
      await registerUser(VALID_EMAIL);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
      expect(typeof res.body.accessToken).toBe("string");
      expect(typeof res.body.refreshToken).toBe("string");
    });

    it("accepts login with uppercase email when account was registered with lowercase", async () => {
      await registerUser("casetest@example.com");

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: "CASETEST@EXAMPLE.COM", password: VALID_PASSWORD });

      expect(res.status).toBe(200);
    });

    it("each login produces unique access and refresh tokens", async () => {
      await registerUser(VALID_EMAIL);

      const first = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      const second = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      expect(first.body.accessToken).not.toBe(second.body.accessToken);
      expect(first.body.refreshToken).not.toBe(second.body.refreshToken);
    });

    it("multiple logins create independent sessions (all refresh tokens valid in Redis)", async () => {
      await registerUser(VALID_EMAIL);

      const sessions = await Promise.all(
        Array.from({ length: 3 }, () =>
          request(app)
            .post("/login")
            .set("x-inter-service-token", INTER_SERVICE_TOKEN)
            .send({ email: VALID_EMAIL, password: VALID_PASSWORD }),
        ),
      );

      for (const session of sessions) {
        expect(session.status).toBe(200);
        const storedUserId = await redis.get(
          `auth:refresh-token:${session.body.refreshToken}`,
        );
        expect(storedUserId).not.toBeNull();
      }
    });

    it("access token carries the correct role for an admin user", async () => {
      const email = `admin-${Date.now()}@example.com`;
      await registerUser(email);
      await User.findOneAndUpdate({ email }, { role: "admin" });

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email, password: VALID_PASSWORD });

      expect(res.status).toBe(200);
      const payload = decodeJwtPayload(res.body.accessToken);
      expect(payload.role).toBe("admin");
    });
  });

  describe("token structure and claims", () => {
    it("access token is a valid three-part JWT", async () => {
      await registerUser(VALID_EMAIL);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      const parts = res.body.accessToken.split(".");
      expect(parts).toHaveLength(3);
      expect(() => decodeJwtHeader(res.body.accessToken)).not.toThrow();
      expect(() => decodeJwtPayload(res.body.accessToken)).not.toThrow();
    });

    it("access token header specifies RS256 algorithm and includes kid", async () => {
      await registerUser(VALID_EMAIL);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      const header = decodeJwtHeader(res.body.accessToken);
      expect(header.alg).toBe("RS256");
      expect(header.kid).toBeDefined();
      expect(typeof header.kid).toBe("string");
    });

    it("access token payload contains email, role, sub, jti, and iss claims", async () => {
      const email = `claims-${Date.now()}@example.com`;
      const userId = await registerUser(email);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email, password: VALID_PASSWORD });

      const payload = decodeJwtPayload(res.body.accessToken);
      expect(payload.email).toBe(email);
      expect(payload.role).toBe("user");
      expect(payload.sub).toBe(userId);
      expect(typeof payload.jti).toBe("string");
      expect(payload.iss).toBe("api-gateway.example.com");
    });

    it("access token expires in approximately 15 minutes (900 seconds)", async () => {
      await registerUser(VALID_EMAIL);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      const { exp, iat } = decodeJwtPayload(res.body.accessToken) as {
        exp: number;
        iat: number;
      };
      expect(exp - iat).toBe(900);
    });

    it("refresh token is a UUID v4", async () => {
      await registerUser(VALID_EMAIL);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      expect(res.body.refreshToken).toMatch(UUID_REGEX);
    });

    it("refresh token is persisted in Redis after login", async () => {
      await registerUser(VALID_EMAIL);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      const storedUserId = await redis.get(
        `auth:refresh-token:${res.body.refreshToken}`,
      );
      expect(storedUserId).not.toBeNull();
    });

    it("refresh token Redis entry has a TTL close to 7 days", async () => {
      await registerUser(VALID_EMAIL);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      const ttl = await redis.ttl(
        `auth:refresh-token:${res.body.refreshToken}`,
      );
      const sevenDaysInSeconds = 60 * 60 * 24 * 7;
      expect(ttl).toBeGreaterThan(sevenDaysInSeconds - 5);
      expect(ttl).toBeLessThanOrEqual(sevenDaysInSeconds);
    });
  });

  describe("missing and empty fields", () => {
    it("returns 400 when body is empty", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when email is missing", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ password: VALID_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when password is missing", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when email is an empty string", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: "", password: VALID_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when password is an empty string", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: "" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("email validation", () => {
    it("returns 400 when email format is invalid", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: "not-an-email", password: VALID_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when email is null", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: null, password: VALID_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when email is a number", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: 12345, password: VALID_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when email is an array", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: ["test@example.com"], password: VALID_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when email is an object", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: { address: "test@example.com" },
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 for email with leading/trailing whitespace", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: "  test@example.com  ", password: VALID_PASSWORD });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("password type coercion", () => {
    it("returns 400 when password is null", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: null });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when password is a number", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: 12345678 });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when password is an array", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: ["Test@1234"] });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("credentials", () => {
    it("returns 401 when password is wrong", async () => {
      await registerUser(VALID_EMAIL);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: "Wr0ng@Pass" });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 401 when email does not exist", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: "ghost@example.com", password: VALID_PASSWORD });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 401 when both email and password are wrong", async () => {
      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: "nobody@example.com", password: "Wr0ng@Pass" });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("message");
    });

    it("returns the same error body for wrong password and non-existent email (prevents user enumeration)", async () => {
      await registerUser(VALID_EMAIL);

      const wrongPassword = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: "Wr0ng@Pass" });

      const noSuchUser = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: "ghost@example.com", password: VALID_PASSWORD });

      expect(wrongPassword.status).toBe(401);
      expect(noSuchUser.status).toBe(401);
      expect(wrongPassword.body).toEqual(noSuchUser.body);
    });
  });

  describe("security", () => {
    it("response body does not expose passwordHash or password", async () => {
      await registerUser(VALID_EMAIL);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty("passwordHash");
      expect(res.body).not.toHaveProperty("password");
    });

    it("response body contains only accessToken and refreshToken", async () => {
      await registerUser(VALID_EMAIL);

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email: VALID_EMAIL, password: VALID_PASSWORD });

      expect(res.status).toBe(200);
      const keys = Object.keys(res.body).sort();
      expect(keys).toEqual(["accessToken", "refreshToken"]);
    });

    it("returns 401 for a soft-deleted user", async () => {
      const email = `deleted-${Date.now()}@example.com`;
      await registerUser(email);
      await User.findOneAndUpdate({ email }, { isDeleted: true });

      const res = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email, password: VALID_PASSWORD });

      expect(res.status).toBe(401);
    });

    it("returns 429 after too many consecutive failed login attempts (brute force protection)", async () => {
      const email = `brute-${Date.now()}@example.com`;
      await registerUser(email);

      for (let i = 0; i < 11; i++) {
        await request(app)
          .post("/login")
          .set("x-inter-service-token", INTER_SERVICE_TOKEN)
          .send({ email, password: "Wr0ng@Pass" });
      }

      const finalAttempt = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email, password: "Wr0ng@Pass" });

      expect(finalAttempt.status).toBe(429);
    });

    it("rate limiting applies to non-existent email probing (prevents account enumeration via timing)", async () => {
      const email = `probe-${Date.now()}@example.com`;

      for (let i = 0; i < 11; i++) {
        await request(app)
          .post("/login")
          .set("x-inter-service-token", INTER_SERVICE_TOKEN)
          .send({ email, password: "Wr0ng@Pass" });
      }

      const finalAttempt = await request(app)
        .post("/login")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ email, password: "Wr0ng@Pass" });

      expect(finalAttempt.status).toBe(429);
    });
  });

  describe("concurrency", () => {
    it("handles 10 simultaneous login requests — all succeed", async () => {
      await registerUser(VALID_EMAIL);

      const rateLimitKeys = await redis.keys("auth:rate-limit:*");
      if (rateLimitKeys.length > 0) await redis.del(rateLimitKeys);

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(app)
            .post("/login")
            .set("x-inter-service-token", INTER_SERVICE_TOKEN)
            .send({ email: VALID_EMAIL, password: VALID_PASSWORD }),
        ),
      );

      for (const res of results) {
        expect(res.status).toBe(200);
      }
    });

    it("concurrent logins produce unique jti values — no token collisions", async () => {
      await registerUser(VALID_EMAIL);

      const rateLimitKeys = await redis.keys("auth:rate-limit:*");
      if (rateLimitKeys.length > 0) await redis.del(rateLimitKeys);

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(app)
            .post("/login")
            .set("x-inter-service-token", INTER_SERVICE_TOKEN)
            .send({ email: VALID_EMAIL, password: VALID_PASSWORD }),
        ),
      );

      const jtis = results.map((r) => decodeJwtPayload(r.body.accessToken).jti);
      const unique = new Set(jtis);
      expect(unique.size).toBe(10);
    });

    it("handles 10 simultaneous login requests with invalid credentials — all return 401", async () => {
      await registerUser(VALID_EMAIL);

      const rateLimitKeys = await redis.keys("auth:rate-limit:*");
      if (rateLimitKeys.length > 0) await redis.del(rateLimitKeys);

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          request(app)
            .post("/login")
            .set("x-inter-service-token", INTER_SERVICE_TOKEN)
            .send({ email: VALID_EMAIL, password: "Wr0ng@Pass" }),
        ),
      );

      for (const res of results) {
        expect(res.status).toBe(401);
      }
    });
  });

  describe("availability", () => {
    it("returns 503 when Redis is unavailable (refresh token cannot be persisted)", async () => {
      await registerUser(VALID_EMAIL);

      const originalSet = redis.set.bind(redis);
      (redis as unknown as Record<string, unknown>).set = () =>
        Promise.reject(new Error("ECONNREFUSED"));

      let res: { status: number } | undefined;
      try {
        res = await request(app)
          .post("/login")
          .set("x-inter-service-token", INTER_SERVICE_TOKEN)
          .send({ email: VALID_EMAIL, password: VALID_PASSWORD });
      } finally {
        (redis as unknown as Record<string, unknown>).set = originalSet;
      }

      expect(res!.status).toBe(503);
    });
  });
});
