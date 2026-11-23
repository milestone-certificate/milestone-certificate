import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route } from "@/routes/_authenticated/route";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  roles: vi.fn(),
  active: vi.fn(),
  checkDeviceSession: vi.fn(),
  forceSignOut: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
    from: () => ({ select: () => ({ eq: mocks.roles }) }),
    rpc: mocks.active,
  },
}));
vi.mock("@/lib/device-session", () => ({
  checkDeviceSession: mocks.checkDeviceSession,
  forceSignOut: mocks.forceSignOut,
}));
vi.mock("@/components/app/AppShell", () => ({ AppShell: () => null }));

const openCandidates = () =>
  Route.options.beforeLoad!({ location: { pathname: "/candidates" } } as Parameters<
    NonNullable<typeof Route.options.beforeLoad>
  >[0]);

describe("candidates route access", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ data: { user: { id: "staff-user" } }, error: null });
    mocks.roles.mockResolvedValue({ data: [{ role: "staff" }], error: null });
    mocks.checkDeviceSession.mockResolvedValue(null);
  });

  it("shows a retryable error during an auth outage", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("Timed out", 504),
    });
    await expect(openCandidates()).rejects.toThrow("আবার চেষ্টা করুন");
    expect(mocks.forceSignOut).not.toHaveBeenCalled();
  });

  it("preserves the login if the role lookup fails, then allows a retry", async () => {
    mocks.roles.mockResolvedValueOnce({ data: null, error: { message: "Timed out" } });
    await expect(openCandidates()).rejects.toThrow("আবার চেষ্টা করুন");
    expect(mocks.forceSignOut).not.toHaveBeenCalled();
    await expect(openCandidates()).resolves.toMatchObject({ roles: ["staff"] });
    expect(mocks.active).not.toHaveBeenCalled();
  });

  it("still redirects a missing session to sign-in", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    await expect(openCandidates()).rejects.toMatchObject({ options: { to: "/auth" } });
  });

  it("still signs out a replaced device", async () => {
    mocks.checkDeviceSession.mockResolvedValue("Device replaced");
    await expect(openCandidates()).rejects.toMatchObject({ options: { to: "/auth" } });
    expect(mocks.forceSignOut).toHaveBeenCalledWith("Device replaced");
  });
});
