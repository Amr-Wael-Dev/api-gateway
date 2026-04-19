import {
  BaseJobData,
  Q_AUTH_USER_REGISTERED,
  UserRegisteredPayload,
  UserRole,
} from "@shared/types";
import { Job, Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { logger } from "../app";
import {
  bullmqJobsCompleted,
  bullmqJobsFailed,
  bullmqQueueDepth,
} from "../lib/metrics";
import User from "../models/User";

export default function createUserRegisteredWorker() {
  const connection = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: null,
  });

  const queue = new Queue("auth", { connection });

  const userRegisteredWorker = new Worker(
    "auth",
    async (job: Job<BaseJobData<UserRegisteredPayload>>) => {
      if (job.name !== Q_AUTH_USER_REGISTERED) return;

      const { id, email } = job.data.payload;
      await User.findOneAndUpdate(
        { userId: id },
        { $setOnInsert: { userId: id, role: UserRole.USER } },
        { upsert: true },
      );

      logger.info("user profile created", {
        userId: id,
        email,
        correlationId: job.data.correlationId,
      });
    },
    { connection },
  );

  userRegisteredWorker.on("completed", (job) => {
    bullmqJobsCompleted.inc({ queue: job.queueName });
  });

  userRegisteredWorker.on("failed", (job) => {
    bullmqJobsFailed.inc({ queue: job?.queueName ?? "auth" });
  });

  const depthInterval = setInterval(async () => {
    const depth = await queue.getWaitingCount();
    bullmqQueueDepth.set({ queue: "auth" }, depth);
  }, 5000);

  userRegisteredWorker.on("closing", () => clearInterval(depthInterval));

  return userRegisteredWorker;
}
