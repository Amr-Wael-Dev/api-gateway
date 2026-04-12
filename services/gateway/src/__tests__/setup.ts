import { afterAll, afterEach } from "vitest";
import redis from "../lib/redis";

afterEach(async () => {
  await redis.flushdb();
});

afterAll(async () => {
  await redis.quit();
});
