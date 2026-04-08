import type { Request, Response } from "express";
import { Types } from "mongoose";
import { MongoServerError } from "mongodb";
import z from "zod";
import Profile from "../models/Profile";
import {
  CreateProfileSchema,
  UpdateProfileSchema,
  ListProfilesSchema,
} from "../validators/profile.validators";

export async function createProfile(req: Request, res: Response) {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { success, data, error } = CreateProfileSchema.safeParse(req.body);

  if (!success) {
    return res.status(400).json({ message: z.treeifyError(error) });
  }

  const { name, bio } = data;

  try {
    const existing = await Profile.findOne({ userId });
    if (existing) {
      return res.status(409).json({ message: "Profile already exists" });
    }

    const profile = await Profile.create({ userId, name, bio });
    return res.status(201).json(profile.toJSON());
  } catch (error: unknown) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return res.status(409).json({ message: "Profile already exists" });
    }
    throw error;
  }
}

export async function getMyProfile(req: Request, res: Response) {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const profile = await Profile.findOne({ userId, deletedAt: null });
  if (!profile) {
    return res.status(404).json({ message: "Profile not found" });
  }

  return res.status(200).json(profile.toJSON());
}

export async function getProfileByUserId(req: Request, res: Response) {
  const { userId } = req.params;

  const profile = await Profile.findOne({ userId, deletedAt: null });
  if (!profile) {
    return res.status(404).json({ message: "Profile not found" });
  }

  return res.status(200).json(profile.toJSON());
}

export async function updateMyProfile(req: Request, res: Response) {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { success, data, error } = UpdateProfileSchema.safeParse(req.body);
  if (!success) {
    return res.status(400).json({ message: z.treeifyError(error) });
  }

  let profile;
  try {
    profile = await Profile.findOneAndUpdate(
      { userId, deletedAt: null },
      { $set: data },
      { returnDocument: "after" },
    );
  } catch (error: unknown) {
    throw error;
  }

  if (!profile) {
    return res.status(404).json({ message: "Profile not found" });
  }

  return res.status(200).json(profile.toJSON());
}

export async function deleteMyProfile(req: Request, res: Response) {
  const userId = req.headers["x-user-id"] as string | undefined;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  let profile;
  try {
    profile = await Profile.findOneAndUpdate(
      { userId, deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { returnDocument: "after" },
    );
  } catch (error: unknown) {
    throw error;
  }

  if (!profile) {
    return res.status(404).json({ message: "Profile not found" });
  }

  return res.status(204).send();
}

export async function listProfiles(req: Request, res: Response) {
  const { success, data, error } = ListProfilesSchema.safeParse(req.query);
  if (!success) {
    return res.status(400).json({ message: z.treeifyError(error) });
  }

  const { cursor, limit, search } = data;

  const query: Record<string, unknown> = { deletedAt: null };

  if (cursor) {
    const decoded = Buffer.from(cursor, "base64").toString("utf-8");
    if (!/^[0-9a-fA-F]{24}$/.test(decoded)) {
      return res.status(400).json({ message: "Invalid cursor" });
    }
    query._id = { $gt: new Types.ObjectId(decoded) };
  }

  if (search) {
    const regex = new RegExp(search, "i");
    query.$or = [{ name: regex }, { bio: regex }];
  }

  try {
    const profiles = await Profile.find(query)
      .sort({ _id: 1 })
      .limit(limit + 1);

    const hasMore = profiles.length > limit;
    const pageData = hasMore ? profiles.slice(0, limit) : profiles;

    const nextCursor = hasMore
      ? Buffer.from(pageData[pageData.length - 1]._id.toString()).toString(
          "base64",
        )
      : null;

    return res.status(200).json({
      data: pageData.map((p) => p.toJSON()),
      nextCursor,
      hasMore,
    });
  } catch (error: unknown) {
    throw error;
  }
}
