// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const gateway = vi.hoisted(() => ({ create: vi.fn(), runtime: vi.fn() }));
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
vi.mock("@/lib/rspay.server", () => ({
  createRspayDeposit: gateway.create,
  rspayRuntimeState: gateway.runtime,
}));
import { startRspayDeposit, setAdminRspayControl } from "@/lib/rspay.functions";

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
  gateway.runtime
    .mockReset()
    .mockResolvedValue({ serverEnabled: true, configured: true, storageReady: true });
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

const update = setAdminRspayControl as unknown as (args: unknown) => Promise<{ ok: boolean }>;
it("denies non-admin control changes even if the request is crafted directly", async () => {
  const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
  expect(
    (
      await update({
        data: { control: "bkash", enabled: false },
        context: { userId: "agent", supabase: { rpc } },
      })
    ).ok,
  ).toBe(false);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("does not bypass the deployment lock when an admin tries to enable the gateway", async () => {
  gateway.runtime.mockResolvedValue({ serverEnabled: false, configured: true, storageReady: true });
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  expect(
    (
      await update({
        data: { control: "enabled", enabled: true },
        context: { userId: "admin", supabase: { rpc } },
      })
    ).ok,
  ).toBe(false);
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("allows an admin to stop payments or prepare methods while the deployment lock is closed", async () => {
  gateway.runtime.mockResolvedValue({ serverEnabled: false, configured: true, storageReady: true });
  for (const control of ["enabled", "nagad"]) {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    expect(
      (
        await update({
          data: { control, enabled: false },
          context: { userId: "admin", supabase: { rpc } },
        })
      ).ok,
    ).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("set_rspay_gateway_control", {
      _control: control,
      _enabled: false,
    });
  }
});
