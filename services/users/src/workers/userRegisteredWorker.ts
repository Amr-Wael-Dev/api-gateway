import { BaseJobData, UserRegisteredPayload } from "@shared/types";
import { Job, Worker } from "bullmq";
import Redis from "ioredis";
import { logger } from "../app";

export default function createUserRegisteredWorker() {
  const connection = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
  });

  const userRegisteredWorker = new Worker(
    "auth",
    async (job: Job<BaseJobData<UserRegisteredPayload>>) => {
      logger.info("userRegistered job received", {
        ...job.data.payload,
        correlationId: job.data.correlationId,
      });
    },
    {
      connection,
    },
  );

  return userRegisteredWorker;
}
