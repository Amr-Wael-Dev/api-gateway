import type { Response, Request } from "express";
import z from "zod";
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

const saltRounds = 10;
const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY!;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const getRefreshTokenRedisName = (token: string) =>
  `auth:refresh-token:${token}`;
const getBlocklistRedisName = (jti: string) => `auth:blocklist:${jti}`;

export async function register(req: Request, res: Response) {
  const { success, data, error } = RegisterRequest.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ message: z.treeifyError(error) });
  }

  const { email, password } = data;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(409).json({ message: "Conflict" });
  }

  const passwordHash = await bcrypt.hash(password, saltRounds);

  let id, userEmail;
  try {
    const createResponse = await User.create({ email, passwordHash });
    id = createResponse.id;
    userEmail = createResponse.email;
  } catch (error: unknown) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return res.status(409).json({ message: "Conflict" });
    }

    throw error;
  }

  return res.status(201).json({ id, email: userEmail });
}

export async function login(req: Request, res: Response) {
  const { success, data, error } = LoginRequest.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ message: z.treeifyError(error) });
  }

  const { email, password } = data;

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.isDeleted) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordCorrect) {
    return res.status(401).json({ message: "Unauthorized" });
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

export async function refresh(req: Request, res: Response) {
  const { success, data, error } = RefreshRequest.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ message: z.treeifyError(error) });
  }

  const { refreshToken: oldRefreshToken } = data;
  const oldRefreshTokenName = getRefreshTokenRedisName(oldRefreshToken);
  const userId = await redis.get(oldRefreshTokenName);
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const accessToken = generateAccessToken(user);
  const refreshToken = crypto.randomUUID();
  await redis.set(
    getRefreshTokenRedisName(refreshToken),
    user.id,
    "EX",
    REFRESH_TOKEN_TTL_SECONDS,
  );
  await redis.del(oldRefreshTokenName);

  return res.status(200).json({ refreshToken, accessToken });
}

export async function logout(req: Request, res: Response) {
  const { success, data, error } = LogoutRequest.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ message: z.treeifyError(error) });
  }

  const { refreshToken, accessToken } = data;

  let decodedpayload = null;
  try {
    decodedpayload = jwt.verify(accessToken, JWT_PUBLIC_KEY, {
      ignoreExpiration: true,
    });
  } catch {
    return res.status(400).json({ message: "Invalid token" });
  }
  const { jti, exp } = decodedpayload as jwt.JwtPayload;

  if (!exp || !jti) {
    return res.status(400).json({ message: "Invalid token" });
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
