import type { Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { ForbiddenError, NotFoundError, ValidationError } from "@shared/errors";
import { UserRole } from "@shared/types";
import User from "../models/User";
import {
  patchProfileSchema,
  listUsersQuerySchema,
} from "../validators/users.validators";

export async function getMe(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = req.headers["x-user-id"] as string;
    const user = await User.findOne({ userId, isDeleted: false });
    if (!user) return next(new NotFoundError("User profile not found"));
    res.status(200).json(user.toJSON());
  } catch (err) {
    next(err);
  }
}

export async function getUserById(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const user = await User.findOne({
      userId: req.params.id,
      isDeleted: false,
    });
    if (!user) return next(new NotFoundError("User not found"));
    res.status(200).json(user.toJSON());
  } catch (err) {
    next(err);
  }
}

export async function patchMe(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = patchProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return next(new ValidationError(parsed.error.message));
    }

    const userId = req.headers["x-user-id"] as string;
    const user = await User.findOneAndUpdate(
      { userId, isDeleted: false },
      { $set: parsed.data },
      { returnDocument: "after" },
    );
    if (!user) return next(new NotFoundError("User profile not found"));
    res.status(200).json(user.toJSON());
  } catch (err) {
    next(err);
  }
}

export async function deleteMe(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const userId = req.headers["x-user-id"] as string;
    const user = await User.findOneAndUpdate(
      { userId, isDeleted: false },
      { $set: { isDeleted: true } },
    );
    if (!user) return next(new NotFoundError("User profile not found"));
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function listUsers(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const role = req.headers["x-user-role"] as string;
    if (role !== UserRole.ADMIN) return next(new ForbiddenError());

    const parsed = listUsersQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return next(new ValidationError(parsed.error.message));
    }

    const { cursor, limit } = parsed.data;
    const filter: Record<string, unknown> = { isDeleted: false };
    if (cursor) {
      filter._id = { $gt: new Types.ObjectId(cursor) };
    }

    const docs = await User.find(filter)
      .sort({ _id: 1 })
      .limit(limit + 1);
    const hasNext = docs.length > limit;
    const data = hasNext ? docs.slice(0, limit) : docs;
    const nextCursor = hasNext ? data[data.length - 1]._id.toString() : null;

    res.status(200).json({ data: data.map((d) => d.toJSON()), nextCursor });
  } catch (err) {
    next(err);
  }
}
