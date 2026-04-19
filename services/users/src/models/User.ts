import { Schema, model, HydratedDocument, InferSchemaType } from "mongoose";
import { UserRole } from "@shared/types";

const UserSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    displayName: { type: String, default: "" },
    bio: { type: String, default: "" },
    avatarUrl: { type: String, default: "" },
    role: {
      type: String,
      enum: Object.values(UserRole),
      default: UserRole.USER,
    },
    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.__v;
        return ret;
      },
    },
  },
);

type UserSchemaType = InferSchemaType<typeof UserSchema>;
export type IUser = HydratedDocument<UserSchemaType>;

const User = model<IUser>("User", UserSchema);
export default User;
