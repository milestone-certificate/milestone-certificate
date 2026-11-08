// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn(), run: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: m.rpc } }));
vi.mock("@/lib/svp-result-automation.server", () => ({ runSvpAutoResults: m.run }));
import { Route } from "@/routes/api/public/cron/svp-results";
const post = (authorization?: string) =>
  (
    Route as unknown as {
      server: { handlers: { POST: (a: { request: Request }) => Promise<Response> } };
    }
  ).server.handlers.POST({
    request: new Request("https://example.test/api/public/cron/svp-results", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.rpc.mockResolvedValue({ data: true });
  m.run.mockResolvedValue({ ok: true, checked: 0, saved: 0 });
});
describe("automatic result dispatcher authentication", () => {
  it.each([undefined, "Bearer short", "Basic fixture", "Bearer a,b"])(
    "rejects missing/malformed credentials without looking up results",
    async (header) => {
      expect((await post(header)).status).toBe(401);
      expect(m.rpc).not.toHaveBeenCalled();
      expect(m.run).not.toHaveBeenCalled();
    },
  );
  it("rejects a database-denied token before running the worker", async () => {
    m.rpc.mockResolvedValue({ data: false });
    expect((await post("Bearer " + "a".repeat(64))).status).toBe(401);
    expect(m.run).not.toHaveBeenCalled();
  });
  it("dispatches only after checking the server-held result token", async () => {
    expect((await post("Bearer " + "a".repeat(64))).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("verify_cron_token", {
      _name: "svp_results",
      _token: "a".repeat(64),
    });
    expect(m.run).toHaveBeenCalledTimes(1);
  });
});
