import type { Response, Request, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { MongoServerError } from "mongodb";
import User from "../models/User";
import redis from "../lib/redis";
import { e, generateAccessToken, KID, kty, n } from "../lib/jwt";
import {
  RegisterRequest,
  LoginRequest,
  RefreshRequest,
  LogoutRequest,
} from "../validators/auth.validators";
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from "@shared/errors";
import { getBlocklistRedisName, getRefreshTokenRedisName } from "@shared/types";

const saltRounds = 10;
const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY!;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { success, data, error } = RegisterRequest.safeParse(req.body);

  if (!success) {
    return next(new ValidationError(error.message));
  }

  const { email, password } = data;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new ConflictError());
  }

  const passwordHash = await bcrypt.hash(password, saltRounds);

  let id, userEmail;
  try {
    const createResponse = await User.create({ email, passwordHash });
    id = createResponse.id;
    userEmail = createResponse.email;
  } catch (error: unknown) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return next(new ConflictError());
    }

    throw error;
  }

  return res.status(201).json({ id, email: userEmail });
}

export async function login(req: Request, res: Response, next: NextFunction) {
  const { success, data, error } = LoginRequest.safeParse(req.body);

  if (!success) {
    return next(new ValidationError(error.message));
  }

  const { email, password } = data;

  const user = await User.findOne({ email });
  if (!user) {
    return next(new UnauthorizedError());
  }

  if (user.isDeleted) {
    return next(new UnauthorizedError());
  }

  const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordCorrect) {
    return next(new UnauthorizedError());
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = crypto.randomUUID();
  await redis.set(
    getRefreshTokenRedisName(refreshToken),
    user.id,
    "EX",
    REFRESH_TOKEN_TTL_SECONDS,
  );

  return res.status(200).json({ refreshToken, accessToken });
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  const { success, data, error } = RefreshRequest.safeParse(req.body);

  if (!success) {
    return next(new ValidationError(error.message));
  }

  const { refreshToken: oldRefreshToken } = data;
  const oldRefreshTokenName = getRefreshTokenRedisName(oldRefreshToken);
  const userId = await redis.getdel(oldRefreshTokenName);
  if (!userId) {
    return next(new UnauthorizedError());
  }

  const user = await User.findById(userId);
  if (!user) {
    return next(new UnauthorizedError());
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = crypto.randomUUID();
  await redis.set(
    getRefreshTokenRedisName(refreshToken),
    user.id,
    "EX",
    REFRESH_TOKEN_TTL_SECONDS,
  );

  return res.status(200).json({ refreshToken, accessToken });
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  const { success, data, error } = LogoutRequest.safeParse(req.body);

  if (!success) {
    return next(new ValidationError(error.message));
  }

  const { refreshToken, accessToken } = data;

  let decodedpayload = null;
  try {
    decodedpayload = jwt.verify(accessToken, JWT_PUBLIC_KEY, {
      ignoreExpiration: true,
    });
  } catch {
    return next(new ValidationError("Invalid token"));
  }
  const { jti, exp } = decodedpayload as jwt.JwtPayload;

  if (!exp || !jti) {
    return next(new ValidationError("Invalid token"));
  }

  const remTTL = exp - Math.floor(Date.now() / 1000);

  const oldRefreshTokenName = getRefreshTokenRedisName(refreshToken);
  await redis.del(oldRefreshTokenName);

  if (remTTL > 0) {
    await redis.set(getBlocklistRedisName(jti), "1", "EX", remTTL);
  }

  return res.status(204).send();
}

export async function jwks(_req: Request, res: Response) {
  return res.status(200).json({
    keys: [{ kty, n, e, kid: KID, use: "sig", alg: "RS256" }],
  });
}
