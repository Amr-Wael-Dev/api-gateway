import jwt from "jsonwebtoken";
import { IUser } from "../models/User";

const JWT_PRIVATE_KEY = process.env.JWT_PRIVATE_KEY!;

export function generateAccessToken(user: IUser) {
  const jti = crypto.randomUUID();
  const accessToken = jwt.sign(
    { email: user.email, role: user.role },
    JWT_PRIVATE_KEY,
    {
      algorithm: "RS256",
      expiresIn: "15m",
      issuer: "api-gateway.example.com",
      subject: user.id,
      jwtid: jti,
    },
  );

  return accessToken;
}
