import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vitest";
import * as schema from "./schema";
import { __setTestDb } from "./index";
import { checkDatabaseHealth } from "./health";

afterEach(() => {
  __setTestDb(null);
});

describe("checkDatabaseHealth", () => {
  it("reports not_configured when there's no database", async () => {
    expect(await checkDatabaseHealth()).toBe("not_configured");
  });

  it("reports ok against a real, reachable database", async () => {
    const client = new PGlite();
    __setTestDb(drizzle(client, { schema }));
    const dir = join(process.cwd(), "drizzle");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      await client.exec(readFileSync(join(dir, f), "utf8"));
    }
    expect(await checkDatabaseHealth()).toBe("ok");
  }, 30_000);

  it("reports unreachable when the query fails", async () => {
    __setTestDb({
      execute: async () => {
        throw new Error("connection refused");
      },
    });
    expect(await checkDatabaseHealth()).toBe("unreachable");
  });
});
