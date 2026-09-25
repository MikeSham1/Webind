import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(async () => ({ id: "u1", email: "u1@example.com", isAdmin: false })),
  testWordPressConnection: vi.fn(),
  saveWordPressConnection: vi.fn(async () => true),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  revokeOtherSessions: vi.fn(),
  revokeSession: vi.fn(),
}));
vi.mock("@/lib/integrations/connections", () => ({
  saveWordPressConnection: mocks.saveWordPressConnection,
  deleteWordPressConnection: vi.fn(),
}));
vi.mock("@/lib/integrations/wordpress", () => ({
  testConnection: mocks.testWordPressConnection,
}));
vi.mock("@/lib/integrations/githubConnections", () => ({
  saveGitHubConnection: vi.fn(),
  deleteGitHubConnection: vi.fn(),
}));
vi.mock("@/lib/integrations/github", () => ({ testConnection: vi.fn() }));

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("connectWordPressAction", () => {
  it("refuses a plain http:// site — Basic auth sends a real credential on every request", async () => {
    const { connectWordPressAction } = await import("./actions");
    const result = await connectWordPressAction(
      { status: "idle" },
      form({ siteUrl: "http://acme.example", username: "editor", appPassword: "abcd efgh ijkl mnop" }),
    );
    expect(result.status).toBe("error");
    expect(mocks.testWordPressConnection).not.toHaveBeenCalled();
    expect(mocks.saveWordPressConnection).not.toHaveBeenCalled();
  });

  it("accepts an https:// site", async () => {
    mocks.testWordPressConnection.mockResolvedValue({ ok: true, name: "Editor" });
    const { connectWordPressAction } = await import("./actions");
    const result = await connectWordPressAction(
      { status: "idle" },
      form({ siteUrl: "https://acme.example", username: "editor", appPassword: "abcd efgh ijkl mnop" }),
    );
    expect(result.status).toBe("connected");
    expect(mocks.saveWordPressConnection).toHaveBeenCalled();
  });
});
