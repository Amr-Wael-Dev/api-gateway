import client from "prom-client";

export const register = new client.Registry();

client.collectDefaultMetrics({
  register: register,
  prefix: "users_service_",
});

export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request duration in seconds",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

export const bullmqJobsCompleted = new client.Counter({
  name: "bullmq_jobs_completed_total",
  help: "Total BullMQ jobs completed",
  labelNames: ["queue"],
  registers: [register],
});

export const bullmqJobsFailed = new client.Counter({
  name: "bullmq_jobs_failed_total",
  help: "Total BullMQ jobs failed",
  labelNames: ["queue"],
  registers: [register],
});

export const bullmqQueueDepth = new client.Gauge({
  name: "bullmq_queue_depth",
  help: "Current number of waiting jobs in the queue",
  labelNames: ["queue"],
  registers: [register],
});
