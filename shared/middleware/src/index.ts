import { type Response, type Request, type NextFunction } from "express";
import z from "zod";
import { type ServiceLogger } from "@shared/logger";
import {
  AppError,
  ForbiddenError,
  ServiceUnavailableError,
  ValidationError,
} from "@shared/errors";

const CORRELATION_ID_HEADER_NAME = "x-correlation-id";

export function correlationId(req: Request, res: Response, next: NextFunction) {
  let correlationIdHeader = req.headers[CORRELATION_ID_HEADER_NAME];
  if (!correlationIdHeader) correlationIdHeader = crypto.randomUUID();

  req.headers[CORRELATION_ID_HEADER_NAME] = correlationIdHeader;
  res.locals[CORRELATION_ID_HEADER_NAME] = correlationIdHeader;
  res.setHeader(CORRELATION_ID_HEADER_NAME, correlationIdHeader);

  next();
}

export const errorHandler =
  (logger: ServiceLogger) =>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (error: Error, _req: Request, res: Response, _next: NextFunction) => {
    const correlationIdHeader = res.locals[CORRELATION_ID_HEADER_NAME];
    if (error instanceof AppError) {
      error.correlationId = correlationIdHeader;
      return res.status(error.statusCode).json(error.toProblemDetails());
    }

    if (error instanceof z.ZodError) {
      const _error = new ValidationError(error.message);
      return res.status(_error.statusCode).json(_error.toProblemDetails());
    }

    if (
      (error as NodeJS.ErrnoException & { type?: string }).type ===
      "entity.parse.failed"
    ) {
      const _error = new ValidationError("Invalid JSON");
      return res.status(_error.statusCode).json(_error.toProblemDetails());
    }

    if (error.message.includes("ECONNREFUSED")) {
      const _error = new ServiceUnavailableError();
      return res.status(_error.statusCode).json(_error.toProblemDetails());
    }

    logger.error(error.message, { stack: error.stack, correlationIdHeader });
    res.status(500).json({
      type: "about:blank",
      title: "Internal Server Error",
      status: 500,
    });
  };

export const requestLogger =
  (logger: ServiceLogger) =>
  (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? "warn" : "info";
      logger[level](`${req.method} ${req.path}`, {
        status: res.statusCode,
        duration,
        correlationId: res.locals[CORRELATION_ID_HEADER_NAME],
      });
    });
    next();
  };

export const createInterServiceAuth =
  (token: string) => (req: Request, res: Response, next: NextFunction) => {
    if (req.headers["x-inter-service-token"] !== token) {
      return next(new ForbiddenError("Invalid inter-service token"));
    }
    next();
  };
