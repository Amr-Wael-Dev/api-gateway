import { describe, it, expect } from "vitest";
import request, { Test } from "supertest";
import app from "../app";
import User from "../models/User";
import { UserRole } from "@shared/types";

const TOKEN = process.env.INTER_SERVICE_TOKEN!;
const USER_ID = "auth-user-id-123";
const OTHER_USER_ID = "auth-user-id-456";

const authed = (req: Test) =>
  req
    .set("x-inter-service-token", TOKEN)
    .set("x-user-id", USER_ID)
    .set("x-user-role", UserRole.USER);

const authedAdmin = (req: Test) =>
  req
    .set("x-inter-service-token", TOKEN)
    .set("x-user-id", USER_ID)
    .set("x-user-role", UserRole.ADMIN);

async function createProfile(
  userId = USER_ID,
  overrides: Partial<{ displayName: string; bio: string }> = {},
) {
  return User.create({ userId, role: UserRole.USER, ...overrides });
}

describe("GET /me", () => {
  it("returns 403 when inter-service token is missing", async () => {
    const res = await request(app).get("/me");
    expect(res.status).toBe(403);
  });

  it("returns 404 when profile does not exist", async () => {
    const res = await authed(request(app).get("/me"));
    expect(res.status).toBe(404);
  });

  it("returns 200 with profile when found", async () => {
    await createProfile(USER_ID, { displayName: "Alice" });
    const res = await authed(request(app).get("/me"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ userId: USER_ID, displayName: "Alice" });
  });

  it("returns 404 after soft delete", async () => {
    await createProfile(USER_ID);
    await authed(request(app).delete("/me"));
    const res = await authed(request(app).get("/me"));
    expect(res.status).toBe(404);
  });
});

describe("GET /:id", () => {
  it("returns 404 when user does not exist", async () => {
    const res = await authed(request(app).get(`/${OTHER_USER_ID}`));
    expect(res.status).toBe(404);
  });

  it("returns 200 with profile", async () => {
    await createProfile(OTHER_USER_ID, { displayName: "Bob" });
    const res = await authed(request(app).get(`/${OTHER_USER_ID}`));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: OTHER_USER_ID,
      displayName: "Bob",
    });
  });

  it("returns 404 for soft-deleted user", async () => {
    await User.create({
      userId: OTHER_USER_ID,
      role: UserRole.USER,
      isDeleted: true,
    });
    const res = await authed(request(app).get(`/${OTHER_USER_ID}`));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /me", () => {
  it("returns 400 when body is empty", async () => {
    await createProfile(USER_ID);
    const res = await authed(request(app).patch("/me").send({}));
    expect(res.status).toBe(400);
  });

  it("returns 404 when profile does not exist", async () => {
    const res = await authed(
      request(app).patch("/me").send({ displayName: "Alice" }),
    );
    expect(res.status).toBe(404);
  });

  it("updates displayName", async () => {
    await createProfile(USER_ID, { displayName: "Old" });
    const res = await authed(
      request(app).patch("/me").send({ displayName: "New" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe("New");
  });

  it("updates bio", async () => {
    await createProfile(USER_ID);
    const res = await authed(
      request(app).patch("/me").send({ bio: "Hello world" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.bio).toBe("Hello world");
  });

  it("returns 400 when displayName exceeds max length", async () => {
    await createProfile(USER_ID);
    const res = await authed(
      request(app)
        .patch("/me")
        .send({ displayName: "a".repeat(51) }),
    );
    expect(res.status).toBe(400);
  });
});

describe("DELETE /me", () => {
  it("returns 404 when profile does not exist", async () => {
    const res = await authed(request(app).delete("/me"));
    expect(res.status).toBe(404);
  });

  it("returns 204 and soft-deletes the profile", async () => {
    await createProfile(USER_ID);
    const res = await authed(request(app).delete("/me"));
    expect(res.status).toBe(204);
    const doc = await User.findOne({ userId: USER_ID });
    expect(doc?.isDeleted).toBe(true);
  });
});

describe("GET /", () => {
  it("returns 403 for non-admin users", async () => {
    const res = await authed(request(app).get("/"));
    expect(res.status).toBe(403);
  });

  it("returns 200 with paginated list for admin", async () => {
    await createProfile(USER_ID);
    await createProfile(OTHER_USER_ID);
    const res = await authedAdmin(request(app).get("/"));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.nextCursor).toBeNull();
  });

  it("excludes soft-deleted users", async () => {
    await createProfile(USER_ID);
    await User.create({
      userId: OTHER_USER_ID,
      role: UserRole.USER,
      isDeleted: true,
    });
    const res = await authedAdmin(request(app).get("/"));
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("paginates with cursor", async () => {
    await createProfile(USER_ID);
    await createProfile(OTHER_USER_ID);

    const first = await authedAdmin(request(app).get("/?limit=1"));
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(1);
    expect(first.body.nextCursor).not.toBeNull();

    const second = await authedAdmin(
      request(app).get(`/?limit=1&cursor=${first.body.nextCursor}`),
    );
    expect(second.status).toBe(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.nextCursor).toBeNull();
  });
});

describe("Worker upsert idempotency", () => {
  it("creates only one profile when called twice with the same userId", async () => {
    await User.findOneAndUpdate(
      { userId: USER_ID },
      { $setOnInsert: { userId: USER_ID, role: UserRole.USER } },
      { upsert: true },
    );
    await User.findOneAndUpdate(
      { userId: USER_ID },
      { $setOnInsert: { userId: USER_ID, role: UserRole.USER } },
      { upsert: true },
    );
    const count = await User.countDocuments({ userId: USER_ID });
    expect(count).toBe(1);
  });

  it("does not overwrite displayName on second upsert", async () => {
    await User.findOneAndUpdate(
      { userId: USER_ID },
      { $setOnInsert: { userId: USER_ID, role: UserRole.USER } },
      { upsert: true },
    );
    await User.findOneAndUpdate(
      { userId: USER_ID },
      { $set: { displayName: "Alice" } },
    );
    await User.findOneAndUpdate(
      { userId: USER_ID },
      { $setOnInsert: { userId: USER_ID, role: UserRole.USER } },
      { upsert: true },
    );
    const doc = await User.findOne({ userId: USER_ID });
    expect(doc?.displayName).toBe("Alice");
  });
});
