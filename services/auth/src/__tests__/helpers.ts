import request from "supertest";
import app from "../app";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;

/**
 * Register a user via POST /register. Returns the created user's id.
 */
export async function registerUser(
  email: string,
  password: string = "Test@1234",
  token: string = INTER_SERVICE_TOKEN,
): Promise<string> {
  const res = await request(app)
    .post("/register")
    .set("x-inter-service-token", token)
    .send({ email, password });
  return res.body.id;
}

/**
 * Login a user via POST /login. Returns { accessToken, refreshToken }.
 */
export async function loginUser(
  email: string,
  password: string = "Test@1234",
  token: string = INTER_SERVICE_TOKEN,
): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await request(app)
    .post("/login")
    .set("x-inter-service-token", token)
    .send({ email, password });
  return {
    accessToken: res.body.accessToken,
    refreshToken: res.body.refreshToken,
  };
}
