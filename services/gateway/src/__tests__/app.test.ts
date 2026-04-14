import { describe, expect, it, vi, beforeEach } from "vitest";
import request from "supertest";
import { probeServices } from "../lib/serviceProbes";
import app from "../app";

vi.mock("../lib/serviceProbes", () => ({
  probeServices: vi.fn(),
}));

const mockedProbeServices = vi.mocked(probeServices);

describe("GET /health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 when all services report ok", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "ok" },
      { name: "users", status: "ok" },
    ]);

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { name: "auth", status: "ok" },
      { name: "users", status: "ok" },
    ]);
    expect(mockedProbeServices).toHaveBeenCalledWith(
      expect.any(Array),
      "health",
      expect.any(String),
    );
  });

  it("returns 503 when one service reports error", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "ok" },
      { name: "users", status: "error" },
    ]);

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
  });

  it("returns 503 when one service is unreachable", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "ok" },
      { name: "users", status: "unreachable" },
    ]);

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
  });

  it("returns 503 when all services are unreachable", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "unreachable" },
      { name: "users", status: "unreachable" },
    ]);

    const res = await request(app).get("/health");

    expect(res.status).toBe(503);
  });

  it("includes service names and statuses from upstream probes", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "ok" },
      { name: "users", status: "unreachable" },
    ]);

    const res = await request(app).get("/health");

    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "auth", status: "ok" }),
        expect.objectContaining({ name: "users", status: "unreachable" }),
      ]),
    );
  });

  it("returns 200 when service list is empty", async () => {
    mockedProbeServices.mockResolvedValue([]);

    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("includes RateLimit-Policy header", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "ok" },
      { name: "users", status: "ok" },
    ]);

    const res = await request(app).get("/health");

    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });
});

describe("GET /ready", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 when all services are ready", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "ok" },
      { name: "users", status: "ok" },
    ]);

    const res = await request(app).get("/ready");

    expect(res.status).toBe(200);
  });

  it("returns 503 when any service is not ready", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "ok" },
      { name: "users", status: "error" },
    ]);

    const res = await request(app).get("/ready");

    expect(res.status).toBe(503);
  });

  it("probes the /ready endpoint (not /health)", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "ok" },
      { name: "users", status: "ok" },
    ]);

    await request(app).get("/ready");

    expect(mockedProbeServices).toHaveBeenCalledWith(
      expect.any(Array),
      "ready",
      expect.any(String),
    );
  });

  it("includes RateLimit-Policy header", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "ok" },
      { name: "users", status: "ok" },
    ]);

    const res = await request(app).get("/ready");

    expect(res.headers["ratelimit-policy"]).toBeDefined();
  });
});

describe("CORS", () => {
  it("sets Access-Control-Allow-Origin header", async () => {
    mockedProbeServices.mockResolvedValue([
      { name: "auth", status: "ok" },
      { name: "users", status: "ok" },
    ]);

    const res = await request(app)
      .get("/health")
      .set("Origin", "http://example.com");

    expect(res.headers["access-control-allow-origin"]).toBeDefined();
  });
});

describe("unknown routes", () => {
  it("returns 404 for undefined paths", async () => {
    const res = await request(app).get("/nonexistent");

    expect(res.status).toBe(404);
  });

  it("returns 404 for POST on undefined paths", async () => {
    const res = await request(app).post("/nonexistent").send({});

    expect(res.status).toBe(404);
  });
});
