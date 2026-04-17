import { createLogger } from "@shared/logger";
import app from "./app";

const PORT = process.env.PORT!;

const logger = createLogger("gateway");

app.listen(PORT, () => {
  logger.info(`API Gateway running on port: ${PORT}`);
});
