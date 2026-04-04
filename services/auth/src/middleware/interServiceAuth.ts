import type { Request, Response, NextFunction } from "express";

const INTER_SERVICE_TOKEN = process.env.INTER_SERVICE_TOKEN!;

export function interServiceAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.headers["x-inter-service-token"] !== INTER_SERVICE_TOKEN) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
