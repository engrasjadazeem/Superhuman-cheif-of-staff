export type LogLevel = "info" | "error" | "warn";

export function log(level: LogLevel, message: string, meta: Record<string, unknown> = {}): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export function logInfo(message: string, meta: Record<string, unknown> = {}): void {
  log("info", message, meta);
}

export function logWarn(message: string, meta: Record<string, unknown> = {}): void {
  log("warn", message, meta);
}

export function logError(message: string, meta: Record<string, unknown> = {}): void {
  log("error", message, meta);
}
