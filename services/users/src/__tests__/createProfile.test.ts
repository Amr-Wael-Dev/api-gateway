import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import Profile from "../models/Profile";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;

const USER_ID = "aaa000000000000000000001";
const USER_ID_2 = "aaa000000000000000000002";

describe("POST /profiles", () => {
  describe("authentication", () => {
    it("returns 403 when x-inter-service-token is missing", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });

    it("returns 403 when x-inter-service-token is invalid", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", "wrong-token")
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });

    it("returns 401 when x-user-id header is absent", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ name: "Alice" });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({ message: "Unauthorized" });
    });
  });

  describe("validation", () => {
    it("returns 400 when body is empty", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when name is missing", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when name is an empty string", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when name exceeds 100 characters", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "a".repeat(101) });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when bio exceeds 500 characters", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice", bio: "b".repeat(501) });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when name is a number (non-string)", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: 42 });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("unknown fields (e.g. role) are stripped — not reflected in response", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice", role: "admin" });

      if (res.status === 201) {
        expect(res.body).not.toHaveProperty("role");
      } else {
        expect(res.status).toBe(400);
      }
    });

    it("ignores userId in request body (uses x-user-id header instead)", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ userId: "spoofed-id", name: "Alice" });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(USER_ID);
    });
  });

  describe("success", () => {
    it("returns 201 status on successful creation", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      expect(res.status).toBe(201);
    });

    it("response contains exactly avatarUrl, bio, createdAt, name, updatedAt, userId", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      expect(res.status).toBe(201);
      const keys = Object.keys(res.body).sort();
      expect(keys).toEqual([
        "avatarUrl",
        "bio",
        "createdAt",
        "name",
        "updatedAt",
        "userId",
      ]);
    });

    it("response does not contain _id, __v, or deletedAt", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      expect(res.status).toBe(201);
      expect(res.body).not.toHaveProperty("_id");
      expect(res.body).not.toHaveProperty("__v");
      expect(res.body).not.toHaveProperty("deletedAt");
    });

    it("bio defaults to empty string when not provided", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      expect(res.status).toBe(201);
      expect(res.body.bio).toBe("");
    });

    it("avatarUrl is null when not provided", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      expect(res.status).toBe(201);
      expect(res.body.avatarUrl).toBeNull();
    });

    it("createdAt and updatedAt are ISO 8601 strings", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      expect(res.status).toBe(201);
      expect(() =>
        new Date(res.body.createdAt as string).toISOString(),
      ).not.toThrow();
      expect(() =>
        new Date(res.body.updatedAt as string).toISOString(),
      ).not.toThrow();
    });

    it("userId in response matches x-user-id header", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(USER_ID);
    });
  });

  describe("conflict", () => {
    it("returns 409 when a profile already exists for the userId", async () => {
      await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice Again" });

      expect(res.status).toBe(409);
    });

    it("returns 409 even with a different name when userId already has active profile", async () => {
      await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice" });

      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Bob" });

      expect(res.status).toBe(409);
    });

    it("returns 409 when trying to create a profile for a soft-deleted userId", async () => {
      await Profile.create({
        userId: USER_ID,
        name: "Old Alice",
        deletedAt: new Date(),
      });

      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "New Alice" });

      expect(res.status).toBe(409);
    });
  });

  describe("edge cases", () => {
    it("name exactly 100 chars is accepted (max boundary)", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "a".repeat(100) });

      expect(res.status).toBe(201);
    });

    it("bio exactly 500 chars is accepted (max boundary)", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice", bio: "b".repeat(500) });

      expect(res.status).toBe(201);
    });

    it("accepts unicode characters in name (e.g. José)", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "José" });

      expect(res.status).toBe(201);
      expect(res.body.name).toBe("José");
    });

    it("accepts unicode characters in bio (e.g. Japanese text)", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Alice", bio: "日本語のバイオ" });

      expect(res.status).toBe(201);
      expect(res.body.bio).toBe("日本語のバイオ");
    });

    it("accepts a second user with a different x-user-id", async () => {
      const res = await request(app)
        .post("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID_2)
        .send({ name: "Bob" });

      expect(res.status).toBe(201);
      expect(res.body.userId).toBe(USER_ID_2);
    });
  });
});
