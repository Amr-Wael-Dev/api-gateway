import { Schema, model, HydratedDocument, InferSchemaType } from "mongoose";

const ProfileSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, maxlength: 100, trim: true },
    bio: { type: String, maxlength: 500, trim: true, default: "" },
    avatarUrl: { type: String, default: null },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret._id;
        delete ret.__v;
        delete ret.deletedAt;
        return ret;
      },
    },
  },
);

type ProfileSchemaType = InferSchemaType<typeof ProfileSchema>;
export type IProfile = HydratedDocument<ProfileSchemaType>;

const Profile = model<IProfile>("Profile", ProfileSchema);
export default Profile;
