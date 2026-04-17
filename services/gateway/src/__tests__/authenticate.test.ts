import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import nodeCrypto from "node:crypto";
import redis from "../lib/redis";
import { UnauthorizedError, ForbiddenError } from "@shared/errors";

const { mockGetSigningKey } = vi.hoisted(() => ({
  mockGetSigningKey: vi.fn(),
}));

vi.mock("jwks-rsa", () => ({
  default: () => ({
    getSigningKey: mockGetSigningKey,
  }),
}));

import { authenticateToken } from "../middleware/authenticate";

let pemPublicKey: string;
let pemPrivateKey: string;

beforeAll(() => {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  pemPublicKey = publicKey.export({
    type: "spki",
    format: "pem",
  }) as string;

  pemPrivateKey = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }) as string;

  mockGetSigningKey.mockResolvedValue({
    getPublicKey: vi.fn().mockResolvedValue(pemPublicKey),
  });
});

function createTestToken(overrides: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      email: "test@example.com",
      role: "user",
      sub: "user-id-123",
      jti: crypto.randomUUID(),
      ...overrides,
    },
    pemPrivateKey,
    {
      algorithm: "RS256",
      expiresIn: "15m",
      issuer: "api-gateway.example.com",
      keyid: "test-kid",
    },
  );
}

function createMocks(headers: Record<string, string> = {}) {
  const req = {
    headers: { ...headers },
    ip: "127.0.0.1",
  } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  return { req, res, next };
}

describe("authenticateToken middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("valid token", () => {
    it("calls next() and injects user identity headers", async () => {
      const token = createTestToken({
        sub: "user-abc",
        role: "admin",
        email: "admin@test.com",
      });
      const { req, res, next } = createMocks({
        authorization: `Bearer ${token}`,
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.headers["x-user-id"]).toBe("user-abc");
      expect(req.headers["x-user-role"]).toBe("admin");
      expect(req.headers["x-user-email"]).toBe("admin@test.com");
      expect(res.status).not.toHaveBeenCalled();
    });

    it("passes through claims from different user roles", async () => {
      for (const role of ["user", "moderator", "admin", "guest"]) {
        vi.clearAllMocks();
        const token = createTestToken({ role });
        const { req, res, next } = createMocks({
          authorization: `Bearer ${token}`,
        });

        await authenticateToken(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.headers["x-user-role"]).toBe(role);
      }
    });
  });

  describe("missing or malformed authorization", () => {
    it("returns 401 when Authorization header is missing", async () => {
      const { req, res, next } = createMocks();

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(res.status).not.toHaveBeenCalled();
    });

    it("returns 401 when Authorization header is empty string", async () => {
      const { req, res, next } = createMocks({ authorization: "" });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(res.status).not.toHaveBeenCalled();
    });

    it("returns 401 when Authorization scheme is not Bearer", async () => {
      const { req, res, next } = createMocks({
        authorization: "Basic dXNlcjpwYXNz",
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(res.status).not.toHaveBeenCalled();
    });

    it("returns 401 when Bearer token is empty string", async () => {
      const { req, res, next } = createMocks({ authorization: "Bearer " });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(res.status).not.toHaveBeenCalled();
    });

    it("returns 401 for a malformed token (not valid JWT format)", async () => {
      const { req, res, next } = createMocks({
        authorization: "Bearer not-a-jwt-token",
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(res.status).not.toHaveBeenCalled();
    });

    it("returns 401 for a token with invalid base64 characters", async () => {
      const { req, res, next } = createMocks({
        authorization: "Bearer a.b.@@@@",
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("token header validation", () => {
    it("returns 401 when token has no kid in header", async () => {
      const token = jwt.sign(
        { email: "test@example.com", role: "user", sub: "123" },
        pemPrivateKey,
        {
          algorithm: "RS256",
          expiresIn: "15m",
        },
      );
      const { req, res, next } = createMocks({
        authorization: `Bearer ${token}`,
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("token payload validation", () => {
    it("returns 401 for an expired token", async () => {
      const token = jwt.sign(
        {
          email: "test@example.com",
          role: "user",
          sub: "123",
          jti: "expired-jti",
        },
        pemPrivateKey,
        {
          algorithm: "RS256",
          keyid: "test-kid",
          expiresIn: "-1s",
        },
      );
      const { req, res, next } = createMocks({
        authorization: `Bearer ${token}`,
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(res.status).not.toHaveBeenCalled();
    });

    it("returns 401 for a token signed with a different key", async () => {
      const { publicKey: otherPub } = nodeCrypto.generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const otherPubPem = otherPub.export({
        type: "spki",
        format: "pem",
      }) as string;

      mockGetSigningKey.mockResolvedValueOnce({
        getPublicKey: vi.fn().mockResolvedValue(otherPubPem),
      });

      const token = createTestToken();
      const { req, res, next } = createMocks({
        authorization: `Bearer ${token}`,
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe("token revocation (blocklist)", () => {
    it("returns 403 when token jti is in the Redis blocklist", async () => {
      const jti = crypto.randomUUID();
      const token = createTestToken({ jti });

      await redis.set(`auth:blocklist:${jti}`, "1");

      const { req, res, next } = createMocks({
        authorization: `Bearer ${token}`,
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError));
      expect(res.status).not.toHaveBeenCalled();
    });

    it("passes through when jti is not in the blocklist", async () => {
      const jti = crypto.randomUUID();
      const token = createTestToken({ jti });

      const { req, res, next } = createMocks({
        authorization: `Bearer ${token}`,
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it("passes through when blocklist key exists but value is not '1'", async () => {
      const jti = crypto.randomUUID();
      const token = createTestToken({ jti });

      await redis.set(`auth:blocklist:${jti}`, "0");

      const { req, res, next } = createMocks({
        authorization: `Bearer ${token}`,
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe("JWKS client failures", () => {
    it("returns 401 when JWKS key fetch fails", async () => {
      mockGetSigningKey.mockRejectedValueOnce(new Error("JWKS unavailable"));
      const token = createTestToken();
      const { req, res, next } = createMocks({
        authorization: `Bearer ${token}`,
      });

      await authenticateToken(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
