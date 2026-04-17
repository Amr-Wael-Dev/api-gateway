import mongoose from "mongoose";
import { Worker } from "bullmq";
import app, { logger } from "./app";
import createUserRegisteredWorker from "./workers/userRegisteredWorker";

const PORT = process.env.PORT!;
const MONGO_URI = process.env.MONGO_URI!;
let userRegisteredWorker: Worker;

mongoose
  .connect(MONGO_URI)
  .then(() => {
    logger.info("Users MongoDB connected");
    userRegisteredWorker = createUserRegisteredWorker();
    app.listen(PORT, () => logger.info(`Users server running on: ${PORT}`));
  })
  .catch((err) => {
    logger.error("Users MongoDB connection failed:", err);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  await userRegisteredWorker?.close();
  await mongoose.disconnect();
  process.exit(0);
});
