/**
 * Minimal structured logging.
 *
 * No external log/metrics service is wired up yet (no Datadog, no Sentry), so
 * this writes one-line JSON to stdout — which Railway (and any container
 * platform) already captures and lets you search/filter. Swap the `write`
 * function for a real sink later without touching any call site.
 */

export type LogFields = Record<string, string | number | boolean | null | undefined>;

function write(level: "info" | "warn" | "error", event: string, fields: LogFields = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logInfo(event: string, fields?: LogFields): void {
  write("info", event, fields);
}

export function logWarn(event: string, fields?: LogFields): void {
  write("warn", event, fields);
}

export function logError(event: string, fields?: LogFields): void {
  write("error", event, fields);
}

/** Wrap an async operation, logging its start, success/duration, or failure. */
export async function timed<T>(
  event: string,
  fields: LogFields,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await fn();
    logInfo(`${event}.ok`, { ...fields, durationMs: Date.now() - startedAt });
    return result;
  } catch (err) {
    logWarn(`${event}.error`, {
      ...fields,
      durationMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
