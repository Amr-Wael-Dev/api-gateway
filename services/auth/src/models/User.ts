import { Document, Schema, model } from "mongoose";
import { UserRole } from "@shared/types";

interface IUser extends Document {
  email: string;
  passwordHash: string;
  role: UserRole;
  isEmailVerified: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
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

const User = model<IUser>("User", UserSchema);

export default User;
