export const UserRole = {
  GUEST: "guest",
  USER: "user",
  MODERATOR: "moderator",
  ADMIN: "admin",
} as const;

export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
}
