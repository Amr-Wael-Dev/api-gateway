import jwt from "jsonwebtoken";
import nodeCrypto from "node:crypto";
import { IUser } from "../models/User";

const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY!;
const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY!;

export const { e, kty, n } = nodeCrypto
  .createPublicKey(JWT_PUBLIC_KEY)
  .export({ format: "jwk" });
const serialized = JSON.stringify({ e, kty, n });
const encoded = nodeCrypto
  .createHash("sha256")
  .update(serialized)
  .digest("base64");
export const KID = encoded
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replace(/^=+|=+$/g, "");

export function generateAccessToken(user: IUser) {
  const jti = crypto.randomUUID();
  const accessToken = jwt.sign(
    { email: user.email, role: user.role },
    JWT_PRIVATE_KEY,
    {
      keyid: KID,
      algorithm: "RS256",
      expiresIn: "15m",
      issuer: "api-gateway.example.com",
      subject: user.id,
      jwtid: jti,
    },
  );

  return accessToken;
}
