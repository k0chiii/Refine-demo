import { createMiddleware } from "hono/factory";

export interface RequestMetric {
  event: "http_request";
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
}

/** Only server-generated IDs and route templates enter logs. Never log URLs, tokens, file keys or bodies. */
export function requestTelemetry(report?: (metric: RequestMetric) => void, suppliedId?: string) {
  return createMiddleware(async (c, next) => {
    const requestId = suppliedId ?? crypto.randomUUID();
    const started = performance.now();
    c.header("X-Request-ID", requestId);
    try {
      await next();
    } finally {
      report?.({
        event: "http_request",
        requestId,
        method: c.req.method,
        route: c.req.routePath ?? "unmatched",
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      });
    }
  });
}
