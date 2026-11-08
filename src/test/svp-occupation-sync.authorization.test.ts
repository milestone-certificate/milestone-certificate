// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), rpc: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = { middleware: () => b, inputValidator: () => b, handler: (f: unknown) => f };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/svp-occupations.server", () => ({ fetchSvpOccupationCatalogue: mocks.fetch }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
import { syncSvpOccupationCatalogue } from "@/lib/svp.functions";
const invoke = syncSvpOccupationCatalogue as unknown as (
  args: unknown,
) => Promise<{ ok: boolean; inserted?: number }>;
const args = (data: boolean | null, error: unknown = null) => ({
  context: { userId: "admin-id", supabase: { rpc: vi.fn().mockResolvedValue({ data, error }) } },
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockResolvedValue([{ key: "100001", name: "Trade", arabic: "" }]);
  mocks.rpc.mockResolvedValue({
    data: { official: 1, inserted: 1, linked: 0, unchanged: 0, conflicts: 0, total: 1 },
    error: null,
  });
});
it("denies non-admin and failed authorization before contacting SVP or writing data", async () => {
  for (const input of [args(false), args(null), args(true, new Error("offline"))])
    expect((await invoke(input)).ok).toBe(false);
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("imports a fully fetched catalogue through the atomic server RPC for admins", async () => {
  const input = args(true);
  expect(await invoke(input)).toMatchObject({ ok: true, inserted: 1 });
  expect(input.context.supabase.rpc).toHaveBeenCalledWith("has_role", {
    _user_id: "admin-id",
    _role: "admin",
  });
  expect(mocks.rpc).toHaveBeenCalledWith("sync_svp_occupation_catalogue", {
    _items: [{ key: "100001", name: "Trade", arabic: "" }],
  });
});
it("never writes a partial catalogue after upstream failure and reports database errors", async () => {
  mocks.fetch.mockRejectedValueOnce(new Error("page 2 failed"));
  expect((await invoke(args(true))).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({ data: null, error: new Error("offline") });
  expect((await invoke(args(true))).ok).toBe(false);
});
