import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;
const VALID_EMAIL = "test@example.com";
const VALID_PASSWORD = "Test@1234";

describe("POST /register", () => {
  describe("authentication", () => {
    it("returns 403 when x-inter-service-token header is missing", async () => {
      const res = await request(app).post("/register").send({
        email: "no-token@example.com",
        password: VALID_PASSWORD,
      });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });

    it("returns 403 when x-inter-service-token is invalid", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", "invalid-token-12345")
        .send({
          email: "bad-token@example.com",
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });
  });

  describe("success cases", () => {
    it("returns 201 with user id and email on success", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: VALID_EMAIL,
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        email: VALID_EMAIL,
      });
    });

    it("normalizes email to lowercase", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "UPPERCASE@EXAMPLE.COM",
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe("uppercase@example.com");
    });

    it("accepts email with plus sign (subaddressing)", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "user+tag@example.com",
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(201);
      expect(res.body.email).toBe("user+tag@example.com");
    });

    it("ignores unknown fields in request body", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "extra@example.com",
          password: VALID_PASSWORD,
          role: "admin",
          isAdmin: true,
        });

      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty("role");
      expect(res.body).not.toHaveProperty("isAdmin");
    });
  });

  describe("missing required fields", () => {
    it("returns 400 when email is missing", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when password is missing", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: VALID_EMAIL,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when request body is empty", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("email validation", () => {
    it("returns 400 when email format is invalid", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "not-an-email",
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when email is null", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: null,
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when email is a number", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: 12345,
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when email is an array", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: ["test@example.com"],
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when email is an object", async () => {
      const res = await request(app)
        .post("/register")
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
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "  whitespace@example.com  ",
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 for extremely long email (500+ chars)", async () => {
      const longEmail = "a".repeat(500) + "@example.com";
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: longEmail,
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 for email missing local part", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "@example.com",
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(400);
    });

    it("returns 400 for email missing domain", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "user@",
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(400);
    });
  });

  describe("password validation - length boundaries", () => {
    it("returns 400 when password is too short (7 chars)", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "pw-short7@example.com",
          password: "Ab1@567",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 201 when password is exactly 8 chars (min boundary)", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "pw-exact8@example.com",
          password: "Ab1@5678",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
    });

    it("returns 201 when password is exactly 16 chars (max boundary)", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "pw-exact16@example.com",
          password: "Ab1@567890123456",
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty("id");
    });

    it("returns 400 when password is too long (17 chars)", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "pw-long17@example.com",
          password: "Ab1@5678901234567",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("password validation - character requirements", () => {
    it("returns 400 when password has no uppercase letter", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "no-upper@example.com",
          password: "abcdef1@",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when password has no lowercase letter", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "no-lower@example.com",
          password: "ABCDEF1@",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when password has no digit", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "no-digit@example.com",
          password: "Abcdefg@",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when password has no special character", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "no-special@example.com",
          password: "Abcdef12",
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("accepts password with underscore as special character", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "underscore@example.com",
          password: "Abcdef1_",
        });

      expect(res.status).toBe(201);
    });
  });

  describe("password validation - type coercion", () => {
    it("returns 400 when password is null", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "pw-null@example.com",
          password: null,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when password is a number", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "pw-number@example.com",
          password: 12345678,
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when password is an array", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: "pw-array@example.com",
          password: ["Test@1234"],
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("duplicate email handling", () => {
    it("returns 409 when email already exists", async () => {
      const email = `dup-${Date.now()}@example.com`;

      const firstRes = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email,
          password: VALID_PASSWORD,
        });

      expect(firstRes.status).toBe(201);

      const secondRes = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email,
          password: VALID_PASSWORD,
        });

      expect(secondRes.status).toBe(409);
      expect(secondRes.body).toHaveProperty("message");
    });

    it("returns 409 for case-insensitive duplicate email", async () => {
      const emailBase = `case-${Date.now()}`;

      const firstRes = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: `${emailBase}@example.com`,
          password: VALID_PASSWORD,
        });

      expect(firstRes.status).toBe(201);

      const secondRes = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: `${emailBase.toUpperCase()}@EXAMPLE.COM`,
          password: VALID_PASSWORD,
        });

      expect(secondRes.status).toBe(409);
    });

    it("handles race condition: only one request succeeds when two registrations happen concurrently", async () => {
      const email = `race-${Date.now()}@example.com`;

      const [res1, res2] = await Promise.all([
        request(app)
          .post("/register")
          .set("x-inter-service-token", INTER_SERVICE_TOKEN)
          .send({ email, password: VALID_PASSWORD }),
        request(app)
          .post("/register")
          .set("x-inter-service-token", INTER_SERVICE_TOKEN)
          .send({ email, password: VALID_PASSWORD }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toContain(201);
      expect(statuses).toContain(409);
    });
  });

  describe("security", () => {
    it("does not expose passwordHash in response", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: `secure-${Date.now()}@example.com`,
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty("passwordHash");
      expect(res.body).not.toHaveProperty("password");
    });

    it("response body contains only id and email", async () => {
      const res = await request(app)
        .post("/register")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({
          email: `explicit-${Date.now()}@example.com`,
          password: VALID_PASSWORD,
        });

      expect(res.status).toBe(201);

      const bodyKeys = Object.keys(res.body);
      expect(bodyKeys).toEqual(expect.arrayContaining(["id", "email"]));
      expect(bodyKeys).not.toContain("passwordHash");
      expect(bodyKeys).not.toContain("password");
      expect(bodyKeys).not.toContain("_id");
      expect(bodyKeys).not.toContain("__v");
    });
  });
});
