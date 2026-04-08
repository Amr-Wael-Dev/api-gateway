import z from "zod";

export const CreateProfileSchema = z.object({
  name: z.string().min(1).max(100),
  bio: z.string().max(500).default(""),
});

export const UpdateProfileSchema = z.strictObject({
  name: z.string().min(1).max(100).optional(),
  bio: z.string().max(500).optional(),
});

export const ListProfilesSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
});

export type CreateProfileInput = z.infer<typeof CreateProfileSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;
export type ListProfilesInput = z.infer<typeof ListProfilesSchema>;
