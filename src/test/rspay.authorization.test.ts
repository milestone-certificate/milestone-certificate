// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const gateway = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      inputValidator: () => builder,
      handler: (handler: unknown) => handler,
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/rspay.server", () => ({ createRspayDeposit: gateway.create }));
import { startRspayDeposit } from "@/lib/rspay.functions";

// Invoke the handler with its middleware-established identity, without a network request.
const invoke = startRspayDeposit as unknown as (args: unknown) => Promise<{ ok: boolean }>;
const args = (roles: string[], active = true, error: unknown = null) => ({
  data: {
    requestId: "ff000000-0000-4000-8000-000000000001",
    amount: 500,
    method: "bkash",
    userId: "attacker-chosen-id",
  },
  context: {
    userId: "signed-owner",
    supabase: {
      from: () => ({
        select: () => ({ eq: async () => ({ data: roles.map((role) => ({ role })), error }) }),
      }),
      rpc: async () => ({ data: active, error: null }),
      auth: { getUser: async () => ({ data: { user: { email: "signed@example.com" } } }) },
    },
  },
});
beforeEach(() => {
  vi.stubEnv("RSPAY_AUTO_DEPOSIT_ENABLED", "true");
  gateway.create.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());
it("denies customers without a wallet role", async () => {
  expect((await invoke(args([]))).ok).toBe(false);
  expect(gateway.create).not.toHaveBeenCalled();
});
it("denies inactive agents", async () => {
  expect((await invoke(args(["agent"], false))).ok).toBe(false);
  expect(gateway.create).not.toHaveBeenCalled();
});
it("fails closed if roles cannot be verified", async () => {
  expect((await invoke(args(["admin"], true, new Error("unavailable")))).ok).toBe(false);
  expect(gateway.create).not.toHaveBeenCalled();
});
it("uses the signed identity and owner for an active agent", async () => {
  expect((await invoke(args(["agent"]))).ok).toBe(true);
  expect(gateway.create).toHaveBeenCalledWith(
    "signed-owner",
    "signed@example.com",
    expect.objectContaining({ amount: 500 }),
  );
});
it("allows an administrator using the existing manager access rules", async () => {
  expect((await invoke(args(["admin"], false))).ok).toBe(true);
});
it("does not create payments when disabled", async () => {
  vi.stubEnv("RSPAY_AUTO_DEPOSIT_ENABLED", "false");
  expect((await invoke(args(["admin"]))).ok).toBe(false);
  expect(gateway.create).not.toHaveBeenCalled();
});
