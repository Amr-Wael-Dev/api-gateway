import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

describe("GET /jwks", () => {
  it("returns 200", async () => {
    const res = await request(app).get("/jwks");

    expect(res.status).toBe(200);
  });

  it("returns a keys array with exactly one entry", async () => {
    const res = await request(app).get("/jwks");

    expect(res.body).toHaveProperty("keys");
    expect(res.body.keys).toBeInstanceOf(Array);
    expect(res.body.keys).toHaveLength(1);
  });

  it("key has required JWKS fields", async () => {
    const res = await request(app).get("/jwks");

    const key = res.body.keys[0];
    expect(key).toHaveProperty("kty");
    expect(key).toHaveProperty("n");
    expect(key).toHaveProperty("e");
    expect(key).toHaveProperty("kid");
    expect(key).toHaveProperty("use");
    expect(key).toHaveProperty("alg");
  });

  it("key specifies RS256 algorithm and sig use", async () => {
    const res = await request(app).get("/jwks");

    const key = res.body.keys[0];
    expect(key.alg).toBe("RS256");
    expect(key.use).toBe("sig");
    expect(key.kty).toBe("RSA");
  });

  it("kid is a non-empty string", async () => {
    const res = await request(app).get("/jwks");

    const key = res.body.keys[0];
    expect(key.kid).toBeDefined();
    expect(typeof key.kid).toBe("string");
    expect(key.kid.length).toBeGreaterThan(0);
  });

  it("n and e are non-empty strings (RSA components)", async () => {
    const res = await request(app).get("/jwks");

    const key = res.body.keys[0];
    expect(typeof key.n).toBe("string");
    expect(key.n.length).toBeGreaterThan(0);
    expect(typeof key.e).toBe("string");
    expect(key.e.length).toBeGreaterThan(0);
  });

  it("kid is deterministic across multiple requests", async () => {
    const [res1, res2] = await Promise.all([
      request(app).get("/jwks"),
      request(app).get("/jwks"),
    ]);

    expect(res1.body.keys[0].kid).toBe(res2.body.keys[0].kid);
  });

  it("response does not contain private key material", async () => {
    const res = await request(app).get("/jwks");

    const key = res.body.keys[0];
    const keyFields = Object.keys(key);
    expect(keyFields).not.toContain("d");
    expect(keyFields).not.toContain("p");
    expect(keyFields).not.toContain("q");
    expect(keyFields).not.toContain("dp");
    expect(keyFields).not.toContain("dq");
    expect(keyFields).not.toContain("qi");
  });
});
