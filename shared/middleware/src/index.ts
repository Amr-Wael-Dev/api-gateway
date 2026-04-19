import { type Response, type Request, type NextFunction } from "express";
import z from "zod";
import helmet from "helmet";
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
    const path = req.originalUrl;
    res.on("finish", () => {
      const duration = Date.now() - start;
      const level = res.statusCode >= 500 ? "warn" : "info";
      logger[level](`${req.method} ${path}`, {
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

const isProduction = process.env.NODE_ENV === "production";
const isDevelopment = process.env.NODE_ENV === "development";
export const helmetMiddleware = helmet({
  // CSP is only enforced in production — requires tuning when you know your
  // frontend's asset sources (CDN, fonts, analytics, etc.)
  contentSecurityPolicy: isProduction
    ? {
        directives: {
          defaultSrc: ["'self'"], // Fallback: only allow same origin
          scriptSrc: ["'self'"], // Scripts: same origin only; extend when you add a CDN
          styleSrc: ["'self'", "https:", "'unsafe-inline'"], // Styles: same origin + any HTTPS + inline (needed by most CSS-in-JS)
          imgSrc: ["'self'", "data:"], // Images: same origin + inline base64 data URIs
          fontSrc: ["'self'", "https:", "data:"], // Fonts: same origin + any HTTPS (e.g. Google Fonts) + base64
          objectSrc: ["'none'"], // Block <object>/<embed>/<applet> entirely (Flash-era attack vector)
          frameAncestors: ["'self'"], // Only allow framing by same origin (clickjacking defense)
          upgradeInsecureRequests: [], // Tell browsers to rewrite http:// sub-requests to https://
        },
      }
    : false, // Disabled outside production — avoids CSP noise during development

  // HSTS: tell browsers to use HTTPS-only for 2 years (63072000s), across all subdomains
  // Disabled in development to avoid browsers forcing https://localhost
  strictTransportSecurity: !isDevelopment
    ? { maxAge: 63072000, includeSubDomains: true }
    : false,

  // Not needed unless you use SharedArrayBuffer or precise memory APIs — leave off
  crossOriginEmbedderPolicy: false,
});
