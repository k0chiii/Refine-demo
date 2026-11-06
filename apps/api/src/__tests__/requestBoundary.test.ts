import { describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "../app.ts";
import { FakeGateway, MemoryStore, fakeVerifier } from "./fakes.ts";

function app(options: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({
    verifier: fakeVerifier,
    gateway: new FakeGateway(),
    store: new MemoryStore(),
    allowedOrigins: ["http://localhost:5173"],
    ...options,
  });
}

describe("HTTP boundary controls", () => {
  it("limits authenticated expensive requests before any transfer and keeps reads available", async () => {
    const allow = vi.fn(async () => false);
    const server = app({ allowExpensiveRequest: allow });
    expect((await server.request("/uploads/items/private", { method: "PUT" })).status).toBe(401);
    expect(allow).not.toHaveBeenCalled();
    const response = await server.request("/uploads/items/private", {
      method: "PUT",
      headers: { Authorization: "Bearer valid:creator" },
      body: "x",
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(allow).toHaveBeenCalledWith("creator", "upload");
    expect((await server.request("/health")).status).toBe(200);
    expect(allow).toHaveBeenCalledTimes(1);
  });

  it("logs a route template and generated correlation ID without request data", async () => {
    const report = vi.fn();
    const server = app({ reportRequest: report });
    const response = await server.request("/files/private-file?token=sensitive", {
      headers: { Authorization: "Bearer bogus", "X-Request-ID": "untrusted" },
    });
    expect(response.status).toBe(401);
    const metric = report.mock.calls[0]![0];
    expect(metric.status).toBe(401);
    expect(metric.requestId).toBe(response.headers.get("X-Request-ID"));
    expect(metric.requestId).not.toBe("untrusted");
    expect(JSON.stringify(metric)).not.toMatch(/sensitive|private-file|bogus/);
  });

  it("permits the gzip upload contract through CORS preflight", async () => {
    const response = await app().request("/uploads/items/a", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:5173",
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "x-mf100-encoding,x-mf100-original-size",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-MF100-Encoding");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-MF100-Original-Size");
  });
});
