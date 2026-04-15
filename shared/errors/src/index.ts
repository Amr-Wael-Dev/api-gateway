export class AppError extends Error {
  readonly statusCode: number;
  readonly type: string;
  readonly title: string;
  readonly isOperational = true;
  correlationId?: string;

  constructor(
    statusCode: number,
    type: string,
    title: string,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.type = type;
    this.title = title;
    // Fixes prototype chain in transpiled code — required when extending built-ins
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toProblemDetails() {
    return {
      type: this.type,
      title: this.title,
      status: this.statusCode,
      detail: this.message,
      ...(this.correlationId && { correlationId: this.correlationId }),
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string = "Invalid request") {
    super(400, "about:blank", "Validation Error", message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Authentication is required") {
    super(401, "about:blank", "Unauthorized", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message: string = "You do not have permission to access this resource",
  ) {
    super(403, "about:blank", "Forbidden", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = "The requested resource was not found") {
    super(404, "about:blank", "Not Found", message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = "Resource already exists") {
    super(409, "about:blank", "Conflict", message);
  }
}

export class RateLimitError extends AppError {
  readonly retryAfter: number;

  constructor(retryAfter: number, message: string = "Too many requests") {
    super(429, "about:blank", "Rate Limit Error", message);
    this.retryAfter = retryAfter;
  }

  toProblemDetails() {
    return {
      ...super.toProblemDetails(),
      retryAfter: this.retryAfter,
    };
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = "Service temporarily unavailable") {
    super(503, "about:blank", "Service Unavailable", message);
  }
}
