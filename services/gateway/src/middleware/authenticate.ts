import type { Request, Response, NextFunction } from "express";
import JwksRsa from "jwks-rsa";
import jwt from "jsonwebtoken";
import redis from "../lib/redis";
import { ForbiddenError, UnauthorizedError } from "@shared/errors";
import { getBlocklistRedisName } from "@shared/types";

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL!;

const jwksClient = JwksRsa({ jwksUri: `${AUTH_SERVICE_URL}/jwks` });

async function getKey(kid: string) {
  const key = await jwksClient.getSigningKey(kid);
  return key.getPublicKey();
}

export async function authenticateToken(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return next(new UnauthorizedError());
  }

  try {
    const { header } = jwt.decode(token, { complete: true }) as jwt.Jwt;
    const { kid } = header;

    if (!kid) {
      return next(new UnauthorizedError());
    }

    const key = await getKey(kid);
    const verified = jwt.verify(token, key) as jwt.JwtPayload;
    const isBlocked =
      verified.jti &&
      (await redis.get(getBlocklistRedisName(verified.jti))) === "1";

    if (verified && !isBlocked) {
      req.headers["x-user-id"] = verified.sub;
      req.headers["x-user-role"] = verified.role;
      req.headers["x-user-email"] = verified.email;
      return next();
    }

    return next(new ForbiddenError());
  } catch {
    return next(new UnauthorizedError());
  }
}
