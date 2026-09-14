/**
 * Aexyl structured logger — one-line JSON logs (parseable by any log drain).
 * Secrets/credentials are redacted by key-name patterns, so a stray
 * `console.log` of a connection object can never leak a token into logs.
 */
type Level = "debug" | "info" | "warn" | "error";

const SECRET_KEY_PATTERN = /(secret|token|password|api[_-]?key|credential|authorization|cookie)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[deep]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Never print anything that looks like a bearer token or API key value.
    return value.length > 0 && /^(sk|re_|ghp|gho|xox)[-_]/.test(value) ? "[redacted]" : value;
  }
  if (typeof value === "object") {
    if (value instanceof Error) return { name: value.name, message: value.message };
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY_PATTERN.test(k) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: Level, msg: string, meta?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ? { meta: redact(meta) as Record<string, unknown> } : {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (maybeErrorOrMsg: unknown, meta?: Record<string, unknown>) => {
    const msg = maybeErrorOrMsg instanceof Error ? maybeErrorOrMsg.message : String(maybeErrorOrMsg ?? "warning");
    emit("warn", msg, meta);
  },
  error: (msgOrError: unknown, meta?: Record<string, unknown>) => {
    const msg = msgOrError instanceof Error ? msgOrError.message : String(msgOrError ?? "error");
    emit("error", msg, meta);
  },
};
