import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildSvpLoginBody,
  buildSvpOtpBody,
  extractSvpSessionUser,
  findSvpPassport,
  svpLoginInputSchema,
  svpSessionInputSchema,
  type SvpSessionResult,
  type SvpSystemConfig,
} from "@/lib/svp-session.shared";
import {
  buildStoredSession,
  clearAllSvpSessions,
  clearPendingSvpSession,
  clearStoredSvpSession,
  listStoredSvpAccounts,
  mergeCookiePairs,
  readPendingSvpSession,
  readStoredSvpAccount,
  readStoredSvpSession,
  removeStoredSvpAccount,
  requireSvpAllowedRole,
  responseCookies,
  setActiveStoredSvpAccount,
  SvpSessionMissingError,
  svpAuthedRequest,
  svpLoginRequest,
  writePendingSvpSession,
  writeStoredSvpSession,
} from "@/lib/svp-session.server";
import { decryptSvpPassword, encryptSvpPassword } from "@/lib/svp-credentials.server";
import type { SvpAccountSummary } from "@/lib/svp-session.vault";
import { parseSvpPermissions } from "@/lib/svp-api.shared";

// Fixed values from the real SVP portal login request. Server-managed, never form fields.
const SVP_SYSTEM_CONFIG: SvpSystemConfig = {
  feApp: "legislator",
  otpMethod: "email",
};

export type SvpSessionStatus = {
  signedIn: boolean;
  userName: string | null;
  userPassport: string | null;
  login: string | null;
  countryTargeted: boolean | null;
  countryLoadBalancer: boolean | null;
  expiresAt: number;
  accountCount: number;
};

export type SvpAccountsResult = {
  accounts: SvpAccountSummary[];
  activeLogin: string | null;
};

function loginFailure(
  step: "login" | "otp",
  status: number,
  message: string | null,
): SvpSessionResult {
  return {
    step,
    httpStatus: status,
    ok: false,
    otpRequired: false,
    authenticated: false,
    message:
      message ??
      (step === "login"
        ? "SVP rejected this username or password."
        : "SVP rejected this OTP. Check the code and try again."),
    session: null,
  };
}

function describePayloadFields(payload: unknown): string {
  const record = (value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const root = record(payload);
  const accessPayload =
    record(root?.["access_payload"]) ?? record(record(root?.["data"])?.["access_payload"]);
  const rootFields = root ? Object.keys(root).slice(0, 12).join(",") : "none";
  const accessFields = accessPayload ? Object.keys(accessPayload).slice(0, 12).join(",") : "none";
  return `response fields: ${rootFields} · access payload: ${accessFields}`;
}

/**
 * Real SVP sign-in: POST /sessions/login, then POST /sessions/otp.
 * A successful OTP stores the bearer token in the server-only session cookie.
 */
export const submitSvpLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => svpSessionInputSchema.parse(input))
  .handler(async ({ context, data }): Promise<SvpSessionResult> => {
    await requireSvpAllowedRole(context.supabase, context.userId);

    if (data.step === "login") {
      const { response, message } = await svpLoginRequest(
        "/sessions/login",
        buildSvpLoginBody(data, SVP_SYSTEM_CONFIG),
      );
      if (!response.ok) return loginFailure("login", response.status, message);

      writePendingSvpSession(context.userId, {
        login: data.login,
        refreshCookies: mergeCookiePairs("", responseCookies(response)),
        savedAt: Date.now(),
      });

      return {
        step: "login",
        httpStatus: response.status,
        ok: true,
        otpRequired: true,
        authenticated: false,
        message:
          message ??
          "SVP accepted the username and password. Enter the OTP sent to the registered email.",
        session: null,
      };
    }

    const { response, payload, message } = await svpLoginRequest(
      "/sessions/otp",
      buildSvpOtpBody(data, SVP_SYSTEM_CONFIG),
    );
    if (!response.ok) return loginFailure("otp", response.status, message);

    const pending = readPendingSvpSession(context.userId);
    const refreshCookies = mergeCookiePairs(
      pending?.refreshCookies ?? "",
      responseCookies(response),
    );
    const user = extractSvpSessionUser(payload);
    const passwordCipher = await encryptSvpPassword(data.password);
    const session = buildStoredSession(
      data.login,
      payload,
      refreshCookies,
      user.name,
      user.id,
      null,
      null,
      user.passport,
      passwordCipher,
    );

    if (!session) {
      return {
        step: "otp",
        httpStatus: response.status,
        ok: false,
        otpRequired: false,
        authenticated: false,
        message:
          "SVP accepted the OTP but did not return an access token. Try again or use the official portal.",
        session: null,
      };
    }

    writeStoredSvpSession(context.userId, session);
    clearPendingSvpSession(context.userId);

    // Verify the stored bearer token before claiming a working session.
    let verificationStatus: number | null = null;
    try {
      const verification = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/occupations",
        { query: { locale: "en", per_page: 1, page: 1, name: "" } },
        session,
      );
      verificationStatus = verification.status;
    } catch (error) {
      if (error instanceof SvpSessionMissingError) verificationStatus = 401;
    }
    if (verificationStatus === 401) {
      clearStoredSvpSession(context.userId);
      return {
        step: "otp",
        httpStatus: 401,
        ok: false,
        otpRequired: false,
        authenticated: false,
        message: "SVP accepted the OTP but rejected the session token. Try signing in again.",
        session: null,
        details: describePayloadFields(payload),
      };
    }

    return {
      step: "otp",
      httpStatus: response.status,
      ok: true,
      otpRequired: false,
      authenticated: true,
      message: message ?? "Signed in to SVP.",
      session: {
        userName: session.userName,
        login: session.login,
        expiresAt: session.expiresAt,
      },
    };
  });

/** Whether this app user currently holds an SVP web session. */
export const getSvpSessionStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SvpSessionStatus> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    const session = readStoredSvpSession(context.userId);
    const now = Math.floor(Date.now() / 1000);
    let active =
      session && (session.expiresAt > now || Boolean(session.refreshCookies)) ? session : null;
    if (session && !active) clearStoredSvpSession(context.userId);

    // Older sessions predate the country flags; fetch them once from permissions.
    const flagsStale = !active?.flagsVerifiedAt || Date.now() - active.flagsVerifiedAt > 5 * 60_000;
    if (
      active &&
      (active.countryTargeted === null || active.countryLoadBalancer === null || flagsStale)
    ) {
      try {
        const permissionsResponse = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/permissions",
          { query: { locale: "en" }, timeoutMs: 5000, retries: 0 },
          active,
        );
        if (permissionsResponse.ok) {
          const permissions = parseSvpPermissions(permissionsResponse.payload);
          const identity = extractSvpSessionUser(permissionsResponse.payload);
          const passport =
            active.passport ?? identity.passport ?? findSvpPassport(permissionsResponse.payload);
          active = {
            ...active,
            passport,
            userName: active.userName ?? identity.name,
            countryTargeted: permissions.targeted,
            countryLoadBalancer: permissions.loadBalancer,
            flagsVerifiedAt: Date.now(),
          };
          writeStoredSvpSession(context.userId, active);
        }
      } catch (error) {
        // If SVP rejected the token, the helper already cleared it.
        if (error instanceof SvpSessionMissingError) active = null;
      }
    }

    // Older stored sessions can predate passport capture; heal it from the labor record.
    if (active && !active.passport) {
      try {
        const reservationsResponse = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/exam_reservations",
          { query: { locale: "en" }, timeoutMs: 5000, retries: 0 },
          active,
        );
        if (reservationsResponse.ok) {
          const passport = findSvpPassport(reservationsResponse.payload);
          if (passport) {
            active = { ...active, passport };
            writeStoredSvpSession(context.userId, active);
          }
        }
      } catch (error) {
        if (error instanceof SvpSessionMissingError) active = null;
      }
    }

    // Last resort: the labor's own user record carries the passport on most SVP tenants.
    if (active && !active.passport && active.svpUserId) {
      try {
        const userResponse = await svpAuthedRequest(
          context.userId,
          `/users/${encodeURIComponent(active.svpUserId)}`,
          { query: { locale: "en" }, timeoutMs: 5000, retries: 0 },
          active,
        );
        if (userResponse.ok) {
          const identity = extractSvpSessionUser(userResponse.payload);
          const passport = findSvpPassport(userResponse.payload) ?? identity.passport;
          if (passport) {
            active = {
              ...active,
              passport,
              userName: active.userName ?? identity.name,
            };
            writeStoredSvpSession(context.userId, active);
          }
        }
      } catch (error) {
        if (error instanceof SvpSessionMissingError) active = null;
      }
    }
    return {
      signedIn: Boolean(active),
      userName: active?.userName ?? null,
      userPassport: active?.passport ?? null,
      login: active?.login ?? null,
      countryTargeted: active?.countryTargeted ?? null,
      countryLoadBalancer: active?.countryLoadBalancer ?? null,
      expiresAt: active?.expiresAt ?? 0,
      accountCount: listStoredSvpAccounts(context.userId).length,
    };
  });

/**
 * Reconnect a saved SVP account: re-send the OTP with the stored credentials so the
 * operator only has to type the OTP. The password never reaches the browser.
 */
export const reconnectSvpAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ login: z.string().trim().min(1).max(254) }).parse(input),
  )
  .handler(
    async ({ context, data }): Promise<{ ok: boolean; message: string; otpRequired?: boolean }> => {
      await requireSvpAllowedRole(context.supabase, context.userId);
      const account = readStoredSvpAccount(context.userId, data.login);
      if (!account) {
        return { ok: false, message: "This SVP account is not saved. Sign in once to save it." };
      }
      // Check/refresh the saved session before requesting a new login challenge.
      try {
        const checked = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/occupations",
          { query: { locale: "en", per_page: 1, page: 1 }, timeoutMs: 5000, retries: 0 },
          account,
        );
        if (checked.ok) {
          setActiveStoredSvpAccount(context.userId, account.login);
          return { ok: true, otpRequired: false, message: "সেশন সক্রিয় আছে" };
        }
        return { ok: false, message: "সংযোগ যাচাই হয়নি। আবার চেষ্টা করুন।" };
      } catch (error) {
        if (!(error instanceof SvpSessionMissingError)) {
          return { ok: false, message: "সংযোগ যাচাই হয়নি। আবার চেষ্টা করুন।" };
        }
      }
      const password = await decryptSvpPassword(account.passwordCipher);
      if (!password) {
        return {
          ok: false,
          message:
            "No saved password for this SVP account. Sign in once with the password to enable reconnect.",
        };
      }
      const { response, message } = await svpLoginRequest(
        "/sessions/login",
        buildSvpLoginBody({ login: account.login, password }, SVP_SYSTEM_CONFIG),
      );
      if (!response.ok) {
        return { ok: false, message: message ?? "SVP rejected the saved credentials." };
      }
      writePendingSvpSession(context.userId, {
        login: account.login,
        refreshCookies: mergeCookiePairs("", responseCookies(response)),
        savedAt: Date.now(),
        passwordCipher: account.passwordCipher ?? null,
      });
      return { ok: true, otpRequired: true, message: "ইমেইলে OTP পাঠানো হয়েছে" };
    },
  );

/** Resend a reconnect challenge without exposing the saved password to the browser. */
export const resendStoredSvpOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; message: string }> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    const pending = readPendingSvpSession(context.userId);
    const password = pending ? await decryptSvpPassword(pending.passwordCipher) : null;
    if (!pending || !password) return { ok: false, message: "আবার লগইন করুন" };
    const { response } = await svpLoginRequest(
      "/sessions/resend_otp",
      buildSvpLoginBody({ login: pending.login, password }, SVP_SYSTEM_CONFIG),
    );
    if (response.ok)
      writePendingSvpSession(context.userId, {
        ...pending,
        savedAt: Date.now(),
        refreshCookies: mergeCookiePairs(pending.refreshCookies, responseCookies(response)),
      });
    return {
      ok: response.ok,
      message: response.ok ? "নতুন OTP পাঠানো হয়েছে" : "OTP পাঠানো যায়নি। আবার চেষ্টা করুন।",
    };
  });

/** Finish a reconnect using only the OTP; the saved password completes the login. */
export const submitStoredSvpOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ otpAttempt: z.string().trim().min(1).max(128) }).parse(input),
  )
  .handler(async ({ context, data }): Promise<{ ok: boolean; message: string }> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    const pending = readPendingSvpSession(context.userId);
    if (!pending) return { ok: false, message: "Start the SVP login again." };
    const password = await decryptSvpPassword(pending.passwordCipher);
    if (!password) {
      return {
        ok: false,
        message: "The saved SVP password is unavailable. Sign in with the password once.",
      };
    }
    const { response, payload, message } = await svpLoginRequest(
      "/sessions/otp",
      buildSvpOtpBody(
        { login: pending.login, password, otpAttempt: data.otpAttempt },
        SVP_SYSTEM_CONFIG,
      ),
    );
    if (!response.ok) return { ok: false, message: message ?? "SVP rejected this OTP." };

    const refreshCookies = mergeCookiePairs(pending.refreshCookies, responseCookies(response));
    const user = extractSvpSessionUser(payload);
    const session = buildStoredSession(
      pending.login,
      payload,
      refreshCookies,
      user.name,
      user.id,
      null,
      null,
      user.passport,
      pending.passwordCipher ?? null,
    );
    if (!session) {
      return { ok: false, message: "SVP accepted the OTP but did not return a session token." };
    }
    writeStoredSvpSession(context.userId, session);
    clearPendingSvpSession(context.userId);

    try {
      const verification = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/occupations",
        { query: { locale: "en", per_page: 1, page: 1, name: "" } },
        session,
      );
      if (verification.status === 401) {
        clearStoredSvpSession(context.userId);
        return { ok: false, message: "SVP rejected the session token. Try reconnecting again." };
      }
    } catch (error) {
      if (error instanceof SvpSessionMissingError) {
        return { ok: false, message: "SVP rejected the session token. Try reconnecting again." };
      }
    }
    return { ok: true, message: message ?? "Signed in to SVP." };
  });

/** Forget the stored SVP session for this app user. */
/** Resend the email OTP for a pending SVP login. */
export const resendSvpOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => svpLoginInputSchema.parse(input))
  .handler(
    async ({ context, data }): Promise<{ ok: boolean; message: string; httpStatus: number }> => {
      await requireSvpAllowedRole(context.supabase, context.userId);
      const { response, message } = await svpLoginRequest(
        "/sessions/resend_otp",
        buildSvpLoginBody(data, SVP_SYSTEM_CONFIG),
      );
      return {
        httpStatus: response.status,
        ok: response.ok,
        message: response.ok
          ? (message ?? "A new OTP has been sent to the registered email.")
          : (message ?? "SVP could not resend the OTP. Try again."),
      };
    },
  );

export const listSvpAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SvpAccountsResult> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    const accounts = listStoredSvpAccounts(context.userId);
    return {
      accounts,
      activeLogin: accounts.find((account) => account.active)?.login ?? null,
    };
  });

/** Switch the active SVP account without signing in again. */
export const switchSvpAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ login: z.string().trim().min(1).max(254) }).parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpAccountsResult> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    const accounts = setActiveStoredSvpAccount(context.userId, data.login);
    return {
      accounts,
      activeLogin: accounts.find((account) => account.active)?.login ?? null,
    };
  });

/** Remove one saved SVP account. */
export const removeSvpAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ login: z.string().trim().min(1).max(254) }).parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpAccountsResult> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    const accounts = removeStoredSvpAccount(context.userId, data.login);
    return {
      accounts,
      activeLogin: accounts.find((account) => account.active)?.login ?? null,
    };
  });

/** Forget the active SVP account, one account, or every saved account. */
export const signOutSvpSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ all: z.boolean().optional(), login: z.string().trim().min(1).max(254).optional() })
      .optional()
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }): Promise<{ ok: true }> => {
    if (data?.all) clearAllSvpSessions(context.userId);
    else if (data?.login) removeStoredSvpAccount(context.userId, data.login);
    else clearStoredSvpSession(context.userId);
    return { ok: true };
  });
