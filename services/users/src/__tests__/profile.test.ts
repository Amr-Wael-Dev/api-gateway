import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import Profile from "../models/Profile";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;

// Fixed hex strings that look like MongoDB ObjectIds
const USER_ID = "000000000000000000000001";
const OTHER_USER_ID = "000000000000000000000002";

async function createProfile(
  userId: string,
  data: Record<string, unknown> = {},
) {
  return Profile.create({
    userId,
    name: "Test User",
    bio: "A short bio",
    ...data,
  });
}

describe("GET /me", () => {
  describe("authentication", () => {
    it("returns 403 when x-inter-service-token is missing", async () => {
      const res = await request(app).get("/profiles/me");

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });

    it("returns 403 when x-inter-service-token is invalid", async () => {
      const res = await request(app)
        .get("/profiles/me")
        .set("x-inter-service-token", "wrong-token");

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });
  });

  describe("user identity", () => {
    it("returns 401 when x-user-id header is absent", async () => {
      const res = await request(app)
        .get("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("success", () => {
    it("returns 200 with the requesting user's profile", async () => {
      await createProfile(USER_ID, { name: "Alice", bio: "Backend dev" });

      const res = await request(app)
        .get("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(USER_ID);
      expect(res.body.name).toBe("Alice");
      expect(res.body.bio).toBe("Backend dev");
    });

    it("response contains only public fields — no _id, __v, or deletedAt", async () => {
      await createProfile(USER_ID);

      const res = await request(app)
        .get("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(200);
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
  });

  describe("not found", () => {
    it("returns 404 when no profile exists for the user", async () => {
      const res = await request(app)
        .get("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 404 when the profile is soft-deleted", async () => {
      await createProfile(USER_ID, { deletedAt: new Date() });

      const res = await request(app)
        .get("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(404);
    });
  });
});

describe("PATCH /me", () => {
  describe("authentication", () => {
    it("returns 403 when x-inter-service-token is missing", async () => {
      const res = await request(app)
        .patch("/profiles/me")
        .send({ name: "Alice" });

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });
  });

  describe("user identity", () => {
    it("returns 401 when x-user-id header is absent", async () => {
      const res = await request(app)
        .patch("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .send({ name: "Alice" });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("success", () => {
    it("updates name and returns the updated profile", async () => {
      await createProfile(USER_ID, { name: "Old Name", bio: "Existing bio" });

      const res = await request(app)
        .patch("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "New Name" });

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("New Name");
    });

    it("partial update leaves other fields untouched", async () => {
      await createProfile(USER_ID, { name: "Alice", bio: "Original bio" });

      const res = await request(app)
        .patch("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Updated Name" });

      expect(res.status).toBe(200);
      expect(res.body.bio).toBe("Original bio");
    });

    it("empty body returns 200 with profile unchanged", async () => {
      await createProfile(USER_ID, { name: "Unchanged", bio: "Same bio" });

      const res = await request(app)
        .patch("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.name).toBe("Unchanged");
      expect(res.body.bio).toBe("Same bio");
    });
  });

  describe("validation", () => {
    it("returns 400 when name exceeds 100 characters", async () => {
      await createProfile(USER_ID);

      const res = await request(app)
        .patch("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "a".repeat(101) });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when bio exceeds 500 characters", async () => {
      await createProfile(USER_ID);

      const res = await request(app)
        .patch("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ bio: "b".repeat(501) });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when name is not a string", async () => {
      await createProfile(USER_ID);

      const res = await request(app)
        .patch("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: 42 });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when body contains an unknown field", async () => {
      await createProfile(USER_ID);

      const res = await request(app)
        .patch("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ role: "admin" });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("not found", () => {
    it("returns 404 when profile does not exist", async () => {
      const res = await request(app)
        .patch("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Ghost" });

      expect(res.status).toBe(404);
    });

    it("returns 404 when profile is soft-deleted", async () => {
      await createProfile(USER_ID, { deletedAt: new Date() });

      const res = await request(app)
        .patch("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID)
        .send({ name: "Ghost" });

      expect(res.status).toBe(404);
    });
  });
});

describe("DELETE /me", () => {
  describe("authentication", () => {
    it("returns 403 when x-inter-service-token is missing", async () => {
      const res = await request(app).delete("/profiles/me");

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });
  });

  describe("user identity", () => {
    it("returns 401 when x-user-id header is absent", async () => {
      const res = await request(app)
        .delete("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty("message");
    });
  });

  describe("success", () => {
    it("returns 204 on successful soft-delete", async () => {
      await createProfile(USER_ID);

      const res = await request(app)
        .delete("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(204);
    });

    it("sets deletedAt on the document — profile is not hard-deleted", async () => {
      await createProfile(USER_ID);

      await request(app)
        .delete("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID);

      const doc = await Profile.findOne({ userId: USER_ID });
      expect(doc).not.toBeNull();
      expect(doc!.deletedAt).not.toBeNull();
    });

    it("GET /me returns 404 after the profile is deleted", async () => {
      await createProfile(USER_ID);

      await request(app)
        .delete("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID);

      const res = await request(app)
        .get("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(404);
    });
  });

  describe("not found", () => {
    it("returns 404 when the profile is already deleted", async () => {
      await createProfile(USER_ID, { deletedAt: new Date() });

      const res = await request(app)
        .delete("/profiles/me")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN)
        .set("x-user-id", USER_ID);

      expect(res.status).toBe(404);
    });
  });
});

describe("GET /:userId", () => {
  describe("authentication", () => {
    it("returns 403 when x-inter-service-token is missing", async () => {
      const res = await request(app).get(`/profiles/${OTHER_USER_ID}`);

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });
  });

  describe("success", () => {
    it("returns 200 with the profile for the given userId", async () => {
      await createProfile(OTHER_USER_ID, { name: "Bob", bio: "Other user" });

      const res = await request(app)
        .get(`/profiles/${OTHER_USER_ID}`)
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.userId).toBe(OTHER_USER_ID);
      expect(res.body.name).toBe("Bob");
    });

    it("response contains only public fields — no _id, __v, or deletedAt", async () => {
      await createProfile(OTHER_USER_ID);

      const res = await request(app)
        .get(`/profiles/${OTHER_USER_ID}`)
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
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
  });

  describe("not found", () => {
    it("returns 404 for a userId that has no profile", async () => {
      const res = await request(app)
        .get(`/profiles/${OTHER_USER_ID}`)
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 404 for a soft-deleted profile", async () => {
      await createProfile(OTHER_USER_ID, { deletedAt: new Date() });

      const res = await request(app)
        .get(`/profiles/${OTHER_USER_ID}`)
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(404);
    });
  });
});
