import util from "node:util";

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

export interface LoggerOptions {
  readonly minimumLevel?: LogLevel;
}

const ANSI = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  cyan: "\u001b[36m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  magenta: "\u001b[35m",
} as const;

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: ANSI.magenta,
  info: ANSI.cyan,
  warn: ANSI.yellow,
  error: ANSI.red,
};

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const EVENT_LEVEL: LogLevel = "debug";

function useColors() {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
}

function colorize(value: string, color: string, enabled: boolean) {
  return enabled ? `${color}${value}${ANSI.reset}` : value;
}

function timeStamp() {
  return new Date().toISOString().slice(11, 23);
}

function formatValue(value: unknown) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null ||
    value === undefined
  ) {
    return String(value);
  }
  return util.inspect(value, {
    depth: 4,
    breakLength: Infinity,
    compact: true,
    maxArrayLength: 25,
    maxStringLength: 320,
  });
}

function formatContext(context: LogContext | undefined) {
  if (!context) return "";
  const entries = Object.entries(context).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return "";
  return entries.map(([key, value]) => `${key}=${formatValue(value)}`).join(" ");
}

function shouldWrite(level: LogLevel, minimumLevel: LogLevel) {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minimumLevel];
}

function write(
  level: LogLevel,
  scope: string,
  message: string,
  context?: LogContext,
  options?: LoggerOptions,
) {
  const minimumLevel = options?.minimumLevel ?? "info";
  if (!shouldWrite(level, minimumLevel)) {
    return;
  }
  const colorEnabled = useColors();
  const ts = colorize(timeStamp(), ANSI.dim, colorEnabled);
  const levelLabel = colorize(LEVEL_LABEL[level], LEVEL_COLOR[level], colorEnabled);
  const contextText = formatContext(context);
  const line = `${ts} ${levelLabel} [${scope}] ${message}${contextText ? ` ${contextText}` : ""}`;

  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "error") {
    console.error(line);
    return;
  }
  console.log(line);
}

export function createLogger(scope: string, options?: LoggerOptions) {
  return {
    info(message: string, context?: LogContext) {
      write("info", scope, message, context, options);
    },
    warn(message: string, context?: LogContext) {
      write("warn", scope, message, context, options);
    },
    error(message: string, context?: LogContext) {
      write("error", scope, message, context, options);
    },
    event(message: string, context?: LogContext) {
      write(EVENT_LEVEL, scope, message, context, options);
    },
  };
}
