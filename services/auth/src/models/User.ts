import { Schema, model, HydratedDocument, InferSchemaType } from "mongoose";
import { UserRole } from "@shared/types";

const UserSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.USER,
    },
    isEmailVerified: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);

type UserSchemaType = InferSchemaType<typeof UserSchema>;
export type IUser = HydratedDocument<UserSchemaType>;

const User = model<IUser>("User", UserSchema);
export default User;
