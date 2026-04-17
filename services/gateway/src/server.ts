import app, { logger } from "./app";

const PORT = process.env.PORT!;

app.listen(PORT, () => {
  logger.info(`API Gateway running on port: ${PORT}`);
});
