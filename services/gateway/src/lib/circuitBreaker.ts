import CircuitBreaker from "opossum";
import {
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from "express";
import { circuitBreakerState } from "./metrics";
import { ServiceUnavailableError } from "@shared/errors";

const CB_OPTIONS = {
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
  rollingCountTimeout: 10000,
};

// Wraps a proxy middleware in a promise so opossum can track failures.
// http-proxy-middleware writes 502/503/504 directly to res on connection failure rather than
// calling next(err), so we must inspect the status code in the finish handler to detect failures.
function wrapProxy(proxy: RequestHandler) {
  return (req: Request, res: Response, _next: NextFunction) =>
    new Promise<void>((resolve, reject) => {
      res.once("finish", () => {
        if (
          res.statusCode === 502 ||
          res.statusCode === 503 ||
          res.statusCode === 504
        ) {
          reject(new Error(`Upstream unavailable: ${res.statusCode}`));
        } else {
          resolve();
        }
      });
      proxy(req, res, (err?: unknown) => {
        if (err) reject(err as Error);
      });
    });
}

function stateToGaugeValue(state: string): number {
  if (state === "closed") return 0;
  if (state === "halfOpen") return 1;
  return 2;
}

export function createCircuitBreaker(
  serviceName: string,
  proxy: RequestHandler,
): RequestHandler {
  const breaker = new CircuitBreaker(wrapProxy(proxy), CB_OPTIONS);

  breaker.fallback((_req: Request, _res: Response, next: NextFunction) => {
    next(new ServiceUnavailableError(`${serviceName} service unavailable`));
  });

  const gauge = circuitBreakerState.labels(serviceName);
  gauge.set(stateToGaugeValue("closed"));

  breaker.on("open", () => gauge.set(stateToGaugeValue("open")));
  breaker.on("halfOpen", () => gauge.set(stateToGaugeValue("halfOpen")));
  breaker.on("close", () => gauge.set(stateToGaugeValue("closed")));

  return (req: Request, res: Response, next: NextFunction) => {
    breaker.fire(req, res, next).catch(next);
  };
}
