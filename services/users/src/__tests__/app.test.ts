import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app";
import redis from "../lib/redis";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;

describe("health and readiness", () => {
  describe("GET /health", () => {
    it("returns 200 with ok status and RateLimit-Policy header", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
      expect(res.headers["ratelimit-policy"]).toMatch(/w=60/);
    });

    it("returns 429 after exceeding 60 requests per window", async () => {
      const requests = Array.from({ length: 61 }, () =>
        request(app).get("/health"),
      );

      const responses = await Promise.all(requests);
      const lastResponse = responses[responses.length - 1];

      expect(lastResponse.status).toBe(429);
    });
  });

  describe("GET /ready", () => {
    it("returns 200 when both db and redis are reachable", async () => {
      const res = await request(app).get("/ready");

      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "db", status: "ok" }),
          expect.objectContaining({ name: "redis", status: "ok" }),
        ]),
      );
    });

    it("returns 503 when redis is unreachable", async () => {
      const originalPing = redis.ping;
      redis.ping = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const res = await request(app).get("/ready");

      expect(res.status).toBe(503);

      redis.ping = originalPing;
    });

    it("returns 429 after exceeding 60 requests per window", async () => {
      const requests = Array.from({ length: 61 }, () =>
        request(app).get("/ready"),
      );

      const responses = await Promise.all(requests);
      const lastResponse = responses[responses.length - 1];

      expect(lastResponse.status).toBe(429);
    });
  });
});

describe("rate limiting — profile routes", () => {
  it("returns 429 after exceeding 1000 requests per window", async () => {
    // Reset rate limit counters before this test. Other test files in the same
    // run may have made requests to /profiles (each cleans up per-test via
    // afterEach, but the beforeEach for THIS test ensures a clean baseline).
    const rateLimitKeys = await redis.keys("users:*");
    if (rateLimitKeys.length > 0) {
      await redis.del(...rateLimitKeys);
    }

    const requests = Array.from({ length: 1001 }, () =>
      request(app)
        .get("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN),
    );

    const responses = await Promise.all(requests);
    const throttled = responses.find((r) => r.status === 429);

    expect(throttled).toBeDefined();
    expect(throttled!.status).toBe(429);
  });
});

describe("error handler", () => {
  it("returns 503 when Redis connection is refused", async () => {
    const originalCall = redis.call;
    redis.call = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const res = await request(app)
      .get("/profiles")
      .set("x-inter-service-token", INTER_SERVICE_TOKEN);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ message: "Service unavailable: redis" });

    redis.call = originalCall;
  });

  it("returns 500 for unexpected errors", async () => {
    const originalCall = redis.call;
    redis.call = vi.fn().mockRejectedValue(new Error("something unexpected"));

    const res = await request(app)
      .get("/profiles")
      .set("x-inter-service-token", INTER_SERVICE_TOKEN);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ message: "Internal Server Error" });

    redis.call = originalCall;
  });
});
