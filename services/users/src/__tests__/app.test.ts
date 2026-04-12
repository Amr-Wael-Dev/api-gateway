import { describe, it, expect } from "vitest";
import app from "../app";
// For HTTP-level unit tests you'd add supertest here later

describe("app", () => {
  it("should be defined", () => {
    expect(app).toBeDefined();
  });
});
