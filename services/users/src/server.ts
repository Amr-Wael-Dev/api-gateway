import mongoose from "mongoose";
import app from "./app";
import { createLogger } from "@shared/logger";

const PORT = process.env.PORT!;
const MONGO_URI = process.env.MONGO_URI!;

const logger = createLogger("users-service");

mongoose
  .connect(MONGO_URI)
  .then(() => {
    logger.info("Users MongoDB connected");
    app.listen(PORT, () => logger.info(`Users server running on: ${PORT}`));
  })
  .catch((err) => {
    logger.error("Users MongoDB connection failed:", err);
    process.exit(1);
  });
