import mongoose from "mongoose";
import app, { logger } from "./app";
import queue from "./lib/queue";

const PORT = process.env.PORT!;
const MONGO_URI = process.env.MONGO_URI!;

mongoose
  .connect(MONGO_URI)
  .then(() => {
    logger.info("Auth MongoDB connected");
    app.listen(PORT, () => logger.info(`Auth server running on: ${PORT}`));
  })
  .catch((err) => {
    logger.error("Auth MongoDB connection failed:", err);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  await queue.close();
  await mongoose.disconnect();
  process.exit(0);
});
