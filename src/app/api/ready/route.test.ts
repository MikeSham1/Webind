import { afterEach, describe, expect, it } from "vitest";
import { __setTestDb } from "@/lib/db";
import { GET } from "./route";

afterEach(() => {
  __setTestDb(null);
});

describe("GET /api/ready", () => {
  it("reports ok with database not_configured when no DB is set", async () => {
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.database).toBe("not_configured");
    expect(body.crawler).toMatchObject({
      active: expect.any(Number),
      queued: expect.any(Number),
      maxConcurrent: expect.any(Number),
      maxQueued: expect.any(Number),
    });
  });

  it("returns 503 and status degraded when the database is unreachable", async () => {
    __setTestDb({
      execute: async () => {
        throw new Error("connection refused");
      },
    });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.database).toBe("unreachable");
  });
});
