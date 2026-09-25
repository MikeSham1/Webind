// Plain module (NOT "use server") so it can export non-function values.

export type SiteActionState = { status: "idle" } | { status: "error"; error: string };

export const initialSiteActionState: SiteActionState = { status: "idle" };
