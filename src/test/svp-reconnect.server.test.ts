// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  saved: vi.fn(),
  request: vi.fn(),
  login: vi.fn(),
  pending: vi.fn(),
  writePending: vi.fn(),
  activate: vi.fn(),
  decrypt: vi.fn(),
}));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = { middleware: () => b, inputValidator: () => b, handler: (f: unknown) => f };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/svp-credentials.server", () => ({
  decryptSvpPassword: m.decrypt,
  encryptSvpPassword: vi.fn(),
}));
vi.mock("@/lib/svp-session.server", () => ({
  readStoredSvpAccount: m.saved,
  svpAuthedRequest: m.request,
  svpLoginRequest: m.login,
  readPendingSvpSession: m.pending,
  writePendingSvpSession: m.writePending,
  setActiveStoredSvpAccount: m.activate,
  requireSvpAllowedRole: vi.fn(),
  mergeCookiePairs: (a: string, b: string) => a + b,
  responseCookies: () => "cookie",
  SvpSessionMissingError: class extends Error {},
}));
import { reconnectSvpAccount, resendStoredSvpOtp } from "@/lib/svp-session.functions";
import { SvpSessionMissingError } from "@/lib/svp-session.server";
const context = { supabase: {}, userId: "owner" };
const reconnect = () =>
  (
    reconnectSvpAccount as unknown as (
      a: unknown,
    ) => Promise<{ ok: boolean; otpRequired?: boolean }>
  )({ context, data: { login: "test@dakbox.net" } });
beforeEach(() => {
  vi.clearAllMocks();
  m.saved.mockReturnValue({ login: "test@dakbox.net", passwordCipher: "encrypted" });
  m.decrypt.mockResolvedValue("fixture-password");
  m.login.mockResolvedValue({ response: { ok: true }, message: null });
});
describe("saved SVP connection", () => {
  it("reuses a healthy session without decrypting the password or sending OTP", async () => {
    m.request.mockResolvedValue({ ok: true, status: 200 });
    expect(await reconnect()).toMatchObject({ ok: true, otpRequired: false });
    expect(m.login).not.toHaveBeenCalled();
    expect(m.decrypt).not.toHaveBeenCalled();
    expect(m.activate).toHaveBeenCalledWith("owner", "test@dakbox.net");
  });
  it("requests a new OTP only after the saved session is rejected", async () => {
    m.request.mockRejectedValue(new SvpSessionMissingError());
    expect(await reconnect()).toMatchObject({ ok: true, otpRequired: true });
    expect(m.login).toHaveBeenCalledWith("/sessions/login", expect.anything());
    expect(m.writePending).toHaveBeenCalledWith(
      "owner",
      expect.objectContaining({ passwordCipher: "encrypted" }),
    );
  });
  it.each([503, 429])(
    "keeps temporary HTTP %i failures from starting a fresh OTP login",
    async (status) => {
      m.request.mockResolvedValue({ ok: false, status });
      expect((await reconnect()).ok).toBe(false);
      expect(m.login).not.toHaveBeenCalled();
    },
  );
  it("keeps network failures from sending OTP", async () => {
    m.request.mockRejectedValue(new Error("offline"));
    expect((await reconnect()).ok).toBe(false);
    expect(m.login).not.toHaveBeenCalled();
  });
  it("resends the pending stored challenge without requiring a browser password", async () => {
    m.pending.mockReturnValue({
      login: "test@dakbox.net",
      passwordCipher: "encrypted",
      refreshCookies: "old",
    });
    const result = await (
      resendStoredSvpOtp as unknown as (a: unknown) => Promise<{ ok: boolean }>
    )({ context });
    expect(result.ok).toBe(true);
    expect(m.login).toHaveBeenCalledWith(
      "/sessions/resend_otp",
      expect.objectContaining({
        user: expect.objectContaining({ login: "test@dakbox.net", password: "fixture-password" }),
      }),
    );
  });
});
