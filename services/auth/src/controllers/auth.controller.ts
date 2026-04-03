import type { Response, Request } from "express";
import * as z from "zod";
import bcrypt from "bcrypt";
import User from "../models/User";

const RegisterRequest = z.object({
  email: z.email("Invalid email address"),
  password: z
    .string()
    .regex(
      /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[a-zA-Z])(?=.*[^a-zA-Z0-9]).{8,16}$/,
      "A password should be at least 8 characters and at most 16 characters. It should contain at least 1 lowercase character, 1 uppercase character, 1 digit, and 1 special character",
    ),
});

const saltRounds = 10;

export async function register(req: Request, res: Response) {
  const { success, data, error } = RegisterRequest.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ error: z.treeifyError(error) });
  }

  const { email, password } = data;

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return res
      .status(409)
      .json({ error: "An account with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, saltRounds);

  const { id, email: userEmail } = await User.create({ email, passwordHash });

  res
    .status(201)
    .json({ message: "User registered successfully", id, email: userEmail });
}
