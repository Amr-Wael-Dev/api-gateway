import client from "prom-client";

export const register = new client.Registry();

client.collectDefaultMetrics({
  register: register,
  prefix: "gateway_",
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

export const circuitBreakerState = new client.Gauge({
  name: "circuit_breaker_state",
  help: "Circuit Breaker State",
  labelNames: ["service"],
  registers: [register],
});
