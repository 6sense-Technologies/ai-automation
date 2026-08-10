import pino from "pino";

export function createLogger(level: string = process.env.LOG_LEVEL ?? "info") {
  const pretty = process.stdout.isTTY;
  return pino({
    level,
    ...(pretty
      ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
