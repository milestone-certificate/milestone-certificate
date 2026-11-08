// @vitest-environment node
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const cookies = vi.hoisted(() => new Map<string, string>());
vi.mock("@tanstack/react-start/server", () => ({
  getCookie: (n: string) => cookies.get(n),
  setCookie: (n: string, v: string) => cookies.set(n, v),
  deleteCookie: (n: string) => cookies.delete(n),
}));
import {
  listStoredSvpAccounts,
  svpAuthedRequest,
  SvpSessionMissingError,
} from "@/lib/svp-session.server";
import type { SvpStoredSession } from "@/lib/svp-session.vault";
const session = (login: string): SvpStoredSession => ({
  login,
  access: "fixture-token",
  refreshCookies: "fixture-cookie",
  expiresAt: 1900000000,
  savedAt: 1,
  userName: null,
  svpUserId: null,
  passport: null,
  countryTargeted: null,
  countryLoadBalancer: null,
  flagsVerifiedAt: null,
});
const active = session("active@test.local"),
  other = session("other@test.local");
beforeEach(() => {
  cookies.clear();
  cookies.set(
    "svp_session_owner",
    JSON.stringify({
      version: 2,
      active: active.login,
      sessions: { [active.login]: active, [other.login]: other },
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());
describe("SVP session refresh safety", () => {
  it.each([503, 429])("preserves saved sessions when refresh returns HTTP %i", async (status) => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      svpAuthedRequest("owner", "/individual_labor_space/occupations", {}, other),
    ).rejects.not.toBeInstanceOf(SvpSessionMissingError);
    expect(listStoredSvpAccounts("owner")).toHaveLength(2);
    expect(listStoredSvpAccounts("owner").find((x) => x.active)?.login).toBe(active.login);
  });
  it("removes the rejected account without deleting another active account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(
      svpAuthedRequest("owner", "/individual_labor_space/occupations", {}, other),
    ).rejects.toBeInstanceOf(SvpSessionMissingError);
    expect(listStoredSvpAccounts("owner").map((x) => x.login)).toEqual([active.login]);
  });
  it("keeps a network refresh failure retryable without deleting a saved session", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 401 }))
        .mockRejectedValueOnce(new Error("network")),
    );
    await expect(
      svpAuthedRequest("owner", "/individual_labor_space/occupations", {}, other),
    ).rejects.not.toBeInstanceOf(SvpSessionMissingError);
    expect(listStoredSvpAccounts("owner")).toHaveLength(2);
  });
});
