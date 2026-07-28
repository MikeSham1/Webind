import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guard against the E352 class of bug: a "use server" module may only export
 * async functions. Exporting a plain value (e.g. `export const initialState =
 * {...}`) compiles fine but throws "a use server file can only export async
 * functions, found object" the moment the action is invoked at runtime — which
 * unit tests, typecheck, and `next build` all miss. This asserts the contract
 * statically so it can never regress.
 */

const SRC = join(process.cwd(), "src");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function isUseServerFile(source: string): boolean {
  // The directive must be the first statement; find the first meaningful line.
  const firstCode = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"));
  return firstCode === '"use server";' || firstCode === "'use server';";
}

/** Non-async, non-type value exports that are illegal in a "use server" file. */
function illegalValueExports(source: string): string[] {
  const violations: string[] = [];
  // `export const/let/var NAME[: Type] = <rhs>` is only allowed when rhs is an async fn.
  const re = /^export\s+(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(async\b)?/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    if (!m[2]) violations.push(m[1]);
  }
  // `export default <something-not-a-function>` is also unsafe; flag defaults
  // that aren't clearly (async) functions.
  const def = /^export\s+default\s+(?!async\b|function\b)/m;
  if (def.test(source)) violations.push("default");
  return violations;
}

describe('"use server" module contract', () => {
  const serverFiles = walk(SRC)
    .map((file) => ({ file, source: readFileSync(file, "utf8") }))
    .filter(({ source }) => isUseServerFile(source));

  it("finds the known server-action files (sanity check the scanner works)", () => {
    expect(serverFiles.length).toBeGreaterThan(0);
  });

  it.each(serverFiles.map(({ file, source }) => [file, source]))(
    "%s exports only async functions (no value exports)",
    (file, source) => {
      const bad = illegalValueExports(source);
      expect(
        bad,
        `${file} exports non-function value(s): ${bad.join(", ")}. Move them to a plain module — a "use server" file may only export async functions.`,
      ).toEqual([]);
    },
  );
});
