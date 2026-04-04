import z from "zod";

export const RegisterRequest = z.object({
  email: z.email("Invalid email address"),
  password: z
    .string()
    .regex(
      /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[a-zA-Z])(?=.*[^a-zA-Z0-9]).{8,16}$/,
      "A password should be at least 8 characters and at most 16 characters. It should contain at least 1 lowercase character, 1 uppercase character, 1 digit, and 1 special character",
    ),
});

export const LoginRequest = z.object({
  email: z.email("Invalid email address"),
  password: z.string().min(1),
});

export const RefreshRequest = z.object({
  refreshToken: z.uuid(),
});

export const LogoutRequest = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.uuid(),
});
