// Plain module (NOT a server-action file) so it can export non-function values.
import type { BenchmarkReport } from "@/lib/benchmark/types";

export type BenchmarkState =
  | { status: "idle" }
  | { status: "success"; report: BenchmarkReport }
  | { status: "error"; error: string };

export const initialBenchmarkState: BenchmarkState = { status: "idle" };
