// Plain module (NOT a server-action file) so it can export non-function values.
import type { SiteReport } from "@/lib/crawler/assess-site";

/** Result of a site-wide (sitemap) assessment, shaped for `useActionState`. */
export type SiteReportState =
  | { status: "idle" }
  | { status: "success"; report: SiteReport }
  | { status: "error"; error: string; input: string };

export const initialSiteReportState: SiteReportState = { status: "idle" };
