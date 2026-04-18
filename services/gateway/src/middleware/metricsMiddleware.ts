import { NextFunction, Request, Response } from "express";
import { httpRequestDuration, httpRequestsTotal } from "../lib/metrics";

export const metricsMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const method = req.method;
    const route = req.path;

    httpRequestsTotal.inc({ method, route, status: String(status) });
    httpRequestDuration.observe(
      { method, route, status: String(status) },
      duration / 1000,
    );
  });
  next();
};
