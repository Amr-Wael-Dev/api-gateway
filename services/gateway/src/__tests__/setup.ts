import { afterAll, afterEach } from "vitest";
import redis from "../lib/redis";

afterEach(async () => {
  // Guard against Redis being unavailable (e.g., in tests that mock redis)
  try {
    await redis.flushdb();
  } catch {
    // Redis not available — test mocks or Redis not running; safe to ignore
  }
});

afterAll(async () => {
  try {
    await redis.quit();
  } catch {
    // Redis not available — safe to ignore
  }
});
