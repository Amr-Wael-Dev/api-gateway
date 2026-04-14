import winston from "winston";

export const createLogger = (serviceName: string) =>
  winston.createLogger({
    level: process.env.LOG_LEVEL ?? "info",
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
    ),
    defaultMeta: { service: serviceName },
    transports: [new winston.transports.Console()],
  });

export type ServiceLogger = ReturnType<typeof createLogger>;
