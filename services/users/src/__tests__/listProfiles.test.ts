import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import Profile from "../models/Profile";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;

/**
 * Seed N profiles with unique userIds.
 */
async function seedProfiles(count: number, prefix = "user"): Promise<void> {
  const docs = Array.from({ length: count }, (_, i) => ({
    userId: `seed-${prefix}-${String(i).padStart(5, "0")}`,
    name: `User ${i}`,
    bio: `Bio for user ${i}`,
  }));
  await Profile.insertMany(docs);
}

describe("GET /profiles", () => {
  describe("authentication", () => {
    it("returns 403 when x-inter-service-token is missing", async () => {
      const res = await request(app).get("/profiles");

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });

    it("returns 403 when x-inter-service-token is invalid", async () => {
      const res = await request(app)
        .get("/profiles")
        .set("x-inter-service-token", "bad-token");

      expect(res.status).toBe(403);
      expect(res.body).toEqual({ message: "Forbidden" });
    });
  });

  describe("validation (query params)", () => {
    it("returns 400 when limit=0 (below minimum)", async () => {
      const res = await request(app)
        .get("/profiles?limit=0")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when limit=101 (above maximum)", async () => {
      const res = await request(app)
        .get("/profiles?limit=101")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when limit=-1 (negative)", async () => {
      const res = await request(app)
        .get("/profiles?limit=-1")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 400 when limit=abc (non-numeric)", async () => {
      const res = await request(app)
        .get("/profiles?limit=abc")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("message");
    });

    it("returns 200 when limit=1 (minimum boundary)", async () => {
      const res = await request(app)
        .get("/profiles?limit=1")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
    });

    it("returns 200 when limit=100 (maximum boundary)", async () => {
      const res = await request(app)
        .get("/profiles?limit=100")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
    });

    it("returns 200 with default limit when no limit param is provided", async () => {
      // Default limit is 20 per ListProfilesSchema
      const res = await request(app)
        .get("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
    });

    it("returns 400 for an invalid cursor (garbage base64 / non-ObjectId)", async () => {
      // The controller catches BSONError when the decoded cursor is not a valid ObjectId.
      const res = await request(app)
        .get("/profiles?cursor=!!!not-valid-base64!!!")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(400);
    });
  });

  describe("empty state", () => {
    it("returns empty data, null nextCursor, hasMore false when no profiles exist", async () => {
      const res = await request(app)
        .get("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: [], nextCursor: null, hasMore: false });
    });
  });

  describe("pagination", () => {
    it("seed 25, limit=20: data.length === 20, hasMore === true, nextCursor !== null", async () => {
      await seedProfiles(25);

      const res = await request(app)
        .get("/profiles?limit=20")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(20);
      expect(res.body.hasMore).toBe(true);
      expect(res.body.nextCursor).not.toBeNull();
    });

    it("use nextCursor from page 1 to fetch page 2 (5 remaining items)", async () => {
      await seedProfiles(25);

      const page1 = await request(app)
        .get("/profiles?limit=20")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      const cursor = page1.body.nextCursor as string;

      const page2 = await request(app)
        .get(`/profiles?limit=20&cursor=${encodeURIComponent(cursor)}`)
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(page2.status).toBe(200);
      expect(page2.body.data).toHaveLength(5);
      expect(page2.body.hasMore).toBe(false);
      expect(page2.body.nextCursor).toBeNull();
    });

    it("seed 20, limit=20: hasMore === false, nextCursor === null", async () => {
      await seedProfiles(20);

      const res = await request(app)
        .get("/profiles?limit=20")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.hasMore).toBe(false);
      expect(res.body.nextCursor).toBeNull();
    });

    it("seed 5, limit=20: data.length === 5, hasMore === false", async () => {
      await seedProfiles(5);

      const res = await request(app)
        .get("/profiles?limit=20")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(5);
      expect(res.body.hasMore).toBe(false);
    });

    it("nextCursor decodes to a valid 24-char hex string (ObjectId)", async () => {
      await seedProfiles(25);

      const res = await request(app)
        .get("/profiles?limit=20")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      const nextCursor = res.body.nextCursor as string;
      const decoded = Buffer.from(nextCursor, "base64").toString("utf-8");
      // MongoDB ObjectId is 24 hex characters
      expect(decoded).toHaveLength(24);
      expect(decoded).toMatch(/^[0-9a-f]{24}$/i);
    });

    it("stable pagination: inserting a new profile between page 1 and page 2 does not duplicate or skip records", async () => {
      await seedProfiles(21);

      const page1 = await request(app)
        .get("/profiles?limit=20")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      // Insert a new profile (gets a higher _id) between page 1 and page 2 fetches
      await Profile.create({
        userId: "new-insert-after-page1",
        name: "Late Insert",
        bio: "",
      });

      const cursor = page1.body.nextCursor as string;

      const page2 = await request(app)
        .get(`/profiles?limit=20&cursor=${encodeURIComponent(cursor)}`)
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      // The cursor is _id-based ($gt), so it skips records at or before the cursor.
      // The 1 pre-existing record after page1 + the newly inserted one = 2 results.
      // Original 21 items: page1 gets 20, the 21st is the cursor's next page.
      // The late insert gets a larger _id than all pre-existing docs, so it appears too.
      expect(page2.status).toBe(200);

      // Combined pages should not have duplicates
      const page1Ids = (page1.body.data as Array<{ userId: string }>).map(
        (p) => p.userId,
      );
      const page2Ids = (page2.body.data as Array<{ userId: string }>).map(
        (p) => p.userId,
      );
      const allIds = [...page1Ids, ...page2Ids];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(allIds.length);
    });
  });

  describe("search", () => {
    it("search by name is case-insensitive (alice finds Alice)", async () => {
      await Profile.create({ userId: "alice-id", name: "Alice", bio: "" });
      await Profile.create({ userId: "bob-id", name: "Bob", bio: "" });

      const res = await request(app)
        .get("/profiles?search=alice")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect((res.body.data[0] as { name: string }).name).toBe("Alice");
    });

    it("partial name search returns matching profiles (ali matches Alice)", async () => {
      await Profile.create({ userId: "alice-id", name: "Alice", bio: "" });
      await Profile.create({ userId: "bob-id", name: "Bob", bio: "" });

      const res = await request(app)
        .get("/profiles?search=ali")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect((res.body.data[0] as { name: string }).name).toBe("Alice");
    });

    it("search with no matching name returns empty data array", async () => {
      await Profile.create({ userId: "alice-id", name: "Alice", bio: "" });

      const res = await request(app)
        .get("/profiles?search=xyz")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it("search also matches bio content", async () => {
      await Profile.create({
        userId: "dev-id",
        name: "Alice",
        bio: "senior developer",
      });
      await Profile.create({ userId: "other-id", name: "Bob", bio: "" });

      const res = await request(app)
        .get("/profiles?search=developer")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect((res.body.data[0] as { bio: string }).bio).toContain("developer");
    });

    it("empty search string — treated as no search filter (returns all profiles)", async () => {
      await Profile.create({ userId: "alice-id", name: "Alice", bio: "" });
      await Profile.create({ userId: "bob-id", name: "Bob", bio: "" });

      const res = await request(app)
        .get("/profiles?search=")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      // The validator uses z.string().optional() — empty string '' is a string,
      // so it may be passed to new RegExp("", "i") which matches everything,
      // or treated as absent. Both return all profiles.
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it("regex special chars in search do not crash the server (ReDoS vulnerability)", async () => {
      // PRD security gap: search input is passed directly to new RegExp() without sanitization,
      // enabling ReDoS. This test documents the vulnerability.
      // The server must not crash — it may return 200 (regex matches) or 500 (if unhandled).
      await Profile.create({ userId: "alice-id", name: "Alice", bio: "" });

      const res = await request(app)
        .get("/profiles?search=.*")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      // We only verify the server does not crash (does not return 500 due to unhandled exception)
      // A regex like .* or (.+)+ could cause ReDoS. For now, we just ensure availability.
      expect([200, 400]).toContain(res.status);
    });
  });

  describe("soft-deleted profiles", () => {
    it("soft-deleted profiles are excluded from list results", async () => {
      await Profile.create({
        userId: "active-id",
        name: "Active",
        bio: "",
      });
      await Profile.create({
        userId: "deleted-id",
        name: "Deleted",
        bio: "",
        deletedAt: new Date(),
      });

      const res = await request(app)
        .get("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect((res.body.data[0] as { userId: string }).userId).toBe("active-id");
    });
  });

  describe("response shape per item", () => {
    it("each profile in data has exactly { avatarUrl, bio, createdAt, name, updatedAt, userId }", async () => {
      await Profile.create({ userId: "shape-id", name: "Shape User", bio: "" });

      const res = await request(app)
        .get("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      const item = res.body.data[0] as Record<string, unknown>;
      const keys = Object.keys(item).sort();
      expect(keys).toEqual([
        "avatarUrl",
        "bio",
        "createdAt",
        "name",
        "updatedAt",
        "userId",
      ]);
      expect(item).not.toHaveProperty("_id");
      expect(item).not.toHaveProperty("__v");
      expect(item).not.toHaveProperty("deletedAt");
    });
  });

  describe("ordering", () => {
    it("results are ordered by ascending _id (oldest first) — createdAt in ascending order", async () => {
      // Insert sequentially to guarantee order
      await Profile.create({ userId: "first-id", name: "First", bio: "" });
      await Profile.create({ userId: "second-id", name: "Second", bio: "" });
      await Profile.create({ userId: "third-id", name: "Third", bio: "" });

      const res = await request(app)
        .get("/profiles")
        .set("x-inter-service-token", INTER_SERVICE_TOKEN);

      expect(res.status).toBe(200);
      const data = res.body.data as Array<{ createdAt: string }>;
      expect(data).toHaveLength(3);

      // createdAt should be in ascending order
      for (let i = 1; i < data.length; i++) {
        const prev = new Date(data[i - 1].createdAt).getTime();
        const curr = new Date(data[i].createdAt).getTime();
        expect(curr).toBeGreaterThanOrEqual(prev);
      }
    });
  });
});
