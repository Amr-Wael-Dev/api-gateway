import type { Response, Request } from "express";
import z from "zod";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import User from "../models/User";
import redis from "../lib/redis";
import { generateAccessToken } from "../helpers";

const RegisterRequest = z.object({
  email: z.email("Invalid email address"),
  password: z
    .string()
    .regex(
      /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[a-zA-Z])(?=.*[^a-zA-Z0-9]).{8,16}$/,
      "A password should be at least 8 characters and at most 16 characters. It should contain at least 1 lowercase character, 1 uppercase character, 1 digit, and 1 special character",
    ),
});

const LoginRequest = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(1),
});

const RefreshRequest = z.object({
  refreshToken: z.uuid(),
});

const LogoutRequest = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.uuid(),
});

const saltRounds = 10;
const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY!;
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const getRefreshTokenRedisName = (token: string) =>
  `auth:refresh-token:${token}`;
const getBlocklistRedisName = (jti: string) => `auth:blocklist:${jti}`;

export async function register(req: Request, res: Response) {
  const { success, data, error } = RegisterRequest.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: z.treeifyError(error) });
  }

  const { email, password } = data;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res.status(409).json({ error: "Conflict" });
  }

  const passwordHash = await bcrypt.hash(password, saltRounds);

  const { id, email: userEmail } = await User.create({ email, passwordHash });

  return res
    .status(201)
    .json({ message: "User registered successfully", id, email: userEmail });
}

export async function login(req: Request, res: Response) {
  const { success, data, error } = LoginRequest.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: z.treeifyError(error) });
  }

  const { email, password } = data;

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const isPasswordCorrect = await bcrypt.compare(password, user.passwordHash);

  if (!isPasswordCorrect) {
    return res.status(401).json({ error: "Unauthorized" });
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
    return res.status(400).json({ error: z.treeifyError(error) });
  }

  const { refreshToken: oldRefreshToken } = data;
  const oldRefreshTokenName = getRefreshTokenRedisName(oldRefreshToken);
  const userId = await redis.get(oldRefreshTokenName);
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = await User.findById(userId);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
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
    return res.status(400).json({ error: z.treeifyError(error) });
  }

  const { refreshToken, accessToken } = data;
  const oldRefreshTokenName = getRefreshTokenRedisName(refreshToken);
  await redis.del(oldRefreshTokenName);

  const decodedpayload = jwt.verify(accessToken, JWT_PUBLIC_KEY, {
    ignoreExpiration: true,
  });
  const { jti, exp } = decodedpayload as jwt.JwtPayload;

  if (!exp || !jti) {
    return res.status(400).json({ error: "Invalid token" });
  }

  const remTTL = exp - Math.floor(Date.now() / 1000);
  if (remTTL <= 0) {
    return res.status(400).json({ error: "Invalid token" });
  }

  await redis.set(getBlocklistRedisName(jti), "1", "EX", remTTL);
  return res.status(204).send();
}
