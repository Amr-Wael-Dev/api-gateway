export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  correlationId?: string;
  retryAfter?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface Service {
  name: string;
  url: string;
}

export interface ServiceCheckResult {
  name: string;
  status: "ok" | "error";
  checks?: ServiceCheckResult[];
}

export type HealthCheckResult = ServiceCheckResult[];
export type ReadinessCheckResult = ServiceCheckResult[];
