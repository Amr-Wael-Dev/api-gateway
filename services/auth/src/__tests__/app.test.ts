import { describe, expect, it } from "vitest";
import request from "supertest";
import redis from "../lib/redis";
import app from "../app";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;
const VALID_PASSWORD = "Test@1234";

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: "health", status: "ok" });
  });

  it("does not require authentication", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
  });

  it("includes RateLimit-Policy header", async () => {
    const res = await request(app).get("/health");

    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });
});

describe("GET /ready", () => {
  it("returns 200 when MongoDB and Redis are connected", async () => {
    const res = await request(app).get("/ready");

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "db", status: "ok" }),
        expect.objectContaining({ name: "redis", status: "ok" }),
      ]),
    );
  });

  it("does not require authentication", async () => {
    const res = await request(app).get("/ready");

    expect(res.status).toBe(200);
  });

  it("includes RateLimit-Policy header", async () => {
    const res = await request(app).get("/ready");

    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });
});

describe("GET /jwks", () => {
  it("returns 200 without authentication", async () => {
    const res = await request(app).get("/jwks");

    expect(res.status).toBe(200);
  });

  it("includes RateLimit-Policy header", async () => {
    const res = await request(app).get("/jwks");

    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });
});

describe("inter-service auth guard", () => {
  it("returns 403 for POST /register without inter-service token", async () => {
    const res = await request(app).post("/register").send({
      email: "no-token@example.com",
      password: VALID_PASSWORD,
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ type: expect.any(String), status: 403 });
  });

  it("returns 403 for POST /login without inter-service token", async () => {
    const res = await request(app).post("/login").send({
      email: "no-token@example.com",
      password: VALID_PASSWORD,
    });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ type: expect.any(String), status: 403 });
  });

  it("returns 403 for POST /refresh without inter-service token", async () => {
    const res = await request(app)
      .post("/refresh")
      .send({ refreshToken: crypto.randomUUID() });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ type: expect.any(String), status: 403 });
  });

  it("returns 403 for POST /logout without inter-service token", async () => {
    const res = await request(app)
      .post("/logout")
      .send({ accessToken: "some-token", refreshToken: crypto.randomUUID() });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ type: expect.any(String), status: 403 });
  });

  it("returns 403 with invalid inter-service token", async () => {
    const res = await request(app)
      .post("/register")
      .set("x-inter-service-token", "wrong-token")
      .send({ email: "bad@example.com", password: VALID_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ type: expect.any(String), status: 403 });
  });

  it("returns 403 with empty inter-service token", async () => {
    const res = await request(app)
      .post("/register")
      .set("x-inter-service-token", "")
      .send({ email: "empty@example.com", password: VALID_PASSWORD });

    expect(res.status).toBe(403);
  });
});

describe("JSON body parsing", () => {
  it("returns 400 for malformed JSON body", async () => {
    const res = await request(app)
      .post("/register")
      .set("x-inter-service-token", INTER_SERVICE_TOKEN)
      .set("Content-Type", "application/json")
      .send("{ invalid json }");

    expect(res.status).toBe(400);
  });

  it("returns 400 for truncated JSON body", async () => {
    const res = await request(app)
      .post("/register")
      .set("x-inter-service-token", INTER_SERVICE_TOKEN)
      .set("Content-Type", "application/json")
      .send('{"email": "test@example.com"');

    expect(res.status).toBe(400);
  });
});

describe("rate limiting on auth routes", () => {
  it("returns 429 after exceeding 10 requests per minute", async () => {
    const rateLimitKeys = await redis.keys("auth:rate-limit:*");
    if (rateLimitKeys.length > 0) await redis.del(rateLimitKeys);

    let lastStatus: number = 0;
    for (let i = 0; i < 12; i++) {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: `rl-${i}@example.com`,
          password: VALID_PASSWORD,
        });

      lastStatus = res.status;
      if (res.status === 429) break;
    }

    expect(lastStatus).toBe(429);
  });

  it("includes RateLimit-Policy header on rate-limited routes", async () => {
    const res = await request(app)
      .post("/register")
      .set("x-inter-service-token", INTER_SERVICE_TOKEN)
      .send({ email: "headers@example.com", password: VALID_PASSWORD });

    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });
});

describe("method not allowed", () => {
  it("returns 404 for GET on auth routes", async () => {
    const res = await request(app)
      .get("/register")
      .set("x-inter-service-token", INTER_SERVICE_TOKEN);

    expect(res.status).toBe(404);
  });
});
