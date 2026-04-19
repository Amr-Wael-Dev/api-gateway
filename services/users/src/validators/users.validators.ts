import { z } from "zod";

export const patchProfileSchema = z
  .object({
    displayName: z.string().min(1).max(50).optional(),
    bio: z.string().max(500).optional(),
  })
  .refine((data) => data.displayName !== undefined || data.bio !== undefined, {
    message: "At least one field (displayName or bio) must be provided",
  });

export const listUsersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
