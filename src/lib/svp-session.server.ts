// Server-only SVP web-session storage and authenticated API transport.
// The SVP bearer token and refresh cookies never reach the browser: they live in
// an httpOnly, per-app-user cookie handled exclusively by server functions.
import { deleteCookie, getCookie, setCookie } from "@tanstack/react-start/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  extractSvpAuthPayload,
  normalizeSvpPassport,
  svpErrorMessage,
  type SvpAuthPayload,
} from "@/lib/svp-session.shared";
import {
  activeSession,
  accountKey,
  createVault,
  isEmptyVault,
  listAccounts,
  parseVault,
  removeAccount,
  setActiveAccount,
  upsertSession,
  type SvpAccountSummary,
  type SvpSessionVault,
  type SvpStoredSession,
} from "@/lib/svp-session.vault";

export type { SvpStoredSession } from "@/lib/svp-session.vault";

export const SVP_API_BASE = "https://svp-international-api.pacc.sa/api/v1";
export const SVP_PORTAL_URL = "https://svp-international.qiwa.sa";

const SESSION_COOKIE_PREFIX = "svp_session_";
const PENDING_COOKIE_PREFIX = "svp_pending_";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const PENDING_TTL_SECONDS = 60 * 15;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 512 * 1024;

export class SvpSessionMissingError extends Error {
  constructor() {
    super("Sign in to SVP first.");
    this.name = "SvpSessionMissingError";
  }
}

export type SvpSessionInfo = {
  login: string;
  userName: string | null;
  svpUserId: string | null;
  passport: string | null;
  countryTargeted: boolean | null;
  countryLoadBalancer: boolean | null;
  expiresAt: number;
};

export type SvpPendingSession = {
  login: string;
  refreshCookies: string;
  savedAt: number;
  passwordCipher?: string | null;
};

export type SvpApiResponse = {
  ok: boolean;
  status: number;
  payload: unknown;
  message: string | null;
};

function cookieSuffix(appUserId: string) {
  return appUserId.replace(/[^A-Za-z0-9_-]/g, "");
}

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function safeParse<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function readVault(appUserId: string): SvpSessionVault {
  return parseVault(
    safeParse<unknown>(getCookie(`${SESSION_COOKIE_PREFIX}${cookieSuffix(appUserId)}`)),
  );
}

function writeVault(appUserId: string, vault: SvpSessionVault): void {
  const suffix = cookieSuffix(appUserId);
  if (isEmptyVault(vault)) {
    deleteCookie(`${SESSION_COOKIE_PREFIX}${suffix}`, { path: "/" });
    return;
  }
  setCookie(
    `${SESSION_COOKIE_PREFIX}${suffix}`,
    JSON.stringify(vault),
    cookieOptions(SESSION_TTL_SECONDS),
  );
}

/** Active SVP account for this app user. */
export function readStoredSvpSession(appUserId: string): SvpStoredSession | null {
  return activeSession(readVault(appUserId));
}

/** One saved SVP account by login (used by the reconnect button). */
export function readStoredSvpAccount(appUserId: string, login: string): SvpStoredSession | null {
  const vault = readVault(appUserId);
  return vault.sessions[accountKey(login)] ?? null;
}

/** Add or update one SVP account and make it active. */
export function writeStoredSvpSession(appUserId: string, session: SvpStoredSession): void {
  writeVault(appUserId, upsertSession(readVault(appUserId), session));
}

export function listStoredSvpAccounts(appUserId: string): SvpAccountSummary[] {
  return listAccounts(readVault(appUserId));
}

export function setActiveStoredSvpAccount(appUserId: string, login: string): SvpAccountSummary[] {
  const vault = setActiveAccount(readVault(appUserId), login);
  writeVault(appUserId, vault);
  return listAccounts(vault);
}

export function removeStoredSvpAccount(appUserId: string, login: string): SvpAccountSummary[] {
  const vault = removeAccount(readVault(appUserId), login);
  writeVault(appUserId, vault);
  return listAccounts(vault);
}

/** Drop the active account (used when SVP rejects its token) and fall back to the next one. */
export function clearStoredSvpSession(appUserId: string): void {
  const vault = readVault(appUserId);
  const active = activeSession(vault);
  if (!active) {
    writeVault(appUserId, createVault());
  } else {
    writeVault(appUserId, removeAccount(vault, active.login));
  }
  deleteCookie(`${PENDING_COOKIE_PREFIX}${cookieSuffix(appUserId)}`, { path: "/" });
}

/** Forget every saved SVP account for this app user. */
export function clearAllSvpSessions(appUserId: string): void {
  deleteCookie(`${SESSION_COOKIE_PREFIX}${cookieSuffix(appUserId)}`, { path: "/" });
  deleteCookie(`${PENDING_COOKIE_PREFIX}${cookieSuffix(appUserId)}`, { path: "/" });
}

export function readPendingSvpSession(appUserId: string): SvpPendingSession | null {
  return safeParse<SvpPendingSession>(
    getCookie(`${PENDING_COOKIE_PREFIX}${cookieSuffix(appUserId)}`),
  );
}

export function writePendingSvpSession(appUserId: string, pending: SvpPendingSession): void {
  setCookie(
    `${PENDING_COOKIE_PREFIX}${cookieSuffix(appUserId)}`,
    JSON.stringify(pending),
    cookieOptions(PENDING_TTL_SECONDS),
  );
}

function cookiePairs(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  const raw =
    typeof withGetSetCookie.getSetCookie === "function"
      ? withGetSetCookie.getSetCookie()
      : headers.get("set-cookie")
        ? [headers.get("set-cookie") as string]
        : [];
  const parts =
    typeof withGetSetCookie.getSetCookie === "function"
      ? raw
      : raw.flatMap((entry) =>
          entry.includes(",")
            ? entry.split(/,\s*(?=[^;,=]+=[^;,]*)/).map((part) => part.trim())
            : [entry],
        );
  return parts
    .map((entry) => entry.split(";", 1)[0]?.trim())
    .filter((entry): entry is string => Boolean(entry && entry.includes("=")));
}

export function mergeCookiePairs(existing: string, incoming: string[]): string {
  const merged = new Map<string, string>();
  const add = (pair: string) => {
    const index = pair.indexOf("=");
    if (index <= 0) return;
    merged.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
  };
  for (const pair of existing.split(";")) add(pair.trim());
  for (const pair of incoming) add(pair);
  return [...merged.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

export function responseCookies(response: Response): string[] {
  return cookiePairs(response.headers);
}

async function readBoundedBody(response: Response): Promise<unknown> {
  const text = (await response.text()).slice(0, MAX_BODY_BYTES);
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } finally {
    clearTimeout(timeout);
  }
}

const BASE_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  // The portal always identifies the tenant; some endpoints need it.
  "X-Tenant-Name": "svp-international",
  Origin: SVP_PORTAL_URL,
  Referer: `${SVP_PORTAL_URL}/`,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
} as const;

type SvpQueryValue = string | number | null | undefined | Array<string | number>;

export function apiUrl(path: string, query?: Record<string, SvpQueryValue>) {
  const url = new URL(path.replace(/^\//, ""), `${SVP_API_BASE}/`);
  url.searchParams.set("locale", "en");
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(`${key}[]`, String(item));
      continue;
    }
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export async function svpLoginRequest(
  path: "/sessions/login" | "/sessions/otp" | "/sessions/resend_otp",
  body: unknown,
): Promise<{ response: Response; payload: unknown; message: string | null }> {
  const response = await timedFetch(apiUrl(path), {
    method: "POST",
    headers: { ...BASE_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readBoundedBody(response);
  return { response, payload, message: svpErrorMessage(payload) };
}

async function refreshStoredSession(
  appUserId: string,
  session: SvpStoredSession,
): Promise<SvpStoredSession> {
  if (!session.refreshCookies) {
    removeStoredSvpAccount(appUserId, session.login);
    throw new SvpSessionMissingError();
  }
  let response: Response;
  try {
    // The portal sends the current access token to /refresh (cookies are only a fallback).
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      Authorization: `Bearer ${session.access}`,
    };
    if (session.refreshCookies) headers["Cookie"] = session.refreshCookies;
    response = await timedFetch(apiUrl("/refresh"), {
      method: "POST",
      headers,
    });
  } catch {
    throw new Error("SVP সংযোগ যাচাই হয়নি। আবার চেষ্টা করুন।");
  }
  if (!response.ok) {
    if (response.status !== 401 && response.status !== 403)
      throw new Error("SVP সংযোগ যাচাই হয়নি। আবার চেষ্টা করুন।");
    removeStoredSvpAccount(appUserId, session.login);
    throw new SvpSessionMissingError();
  }
  const payload = await readBoundedBody(response);
  const auth = extractSvpAuthPayload(payload);
  if (!auth) {
    removeStoredSvpAccount(appUserId, session.login);
    throw new SvpSessionMissingError();
  }
  const next: SvpStoredSession = {
    ...session,
    access: auth.access,
    expiresAt: auth.accessExpiresAt,
    refreshCookies: mergeCookiePairs(session.refreshCookies, responseCookies(response)),
    savedAt: Date.now(),
  };
  writeStoredSvpSession(appUserId, next);
  return next;
}

function authFromPayload(payload: unknown): SvpAuthPayload | null {
  return extractSvpAuthPayload(payload);
}

export function buildStoredSession(
  login: string,
  payload: unknown,
  refreshCookies: string,
  userName: string | null,
  svpUserId: string | null,
  countryTargeted: boolean | null = null,
  countryLoadBalancer: boolean | null = null,
  passport: string | null = null,
  passwordCipher: string | null = null,
): SvpStoredSession | null {
  const auth = authFromPayload(payload);
  if (!auth) return null;
  return {
    login,
    userName,
    svpUserId,
    passport: normalizeSvpPassport(passport),
    passwordCipher,
    countryTargeted,
    countryLoadBalancer,
    flagsVerifiedAt: Date.now(),
    access: auth.access,
    expiresAt: auth.accessExpiresAt,
    refreshCookies,
    savedAt: Date.now(),
  };
}

export type SvpBinaryResponse = {
  ok: boolean;
  status: number;
  contentType: string | null;
  base64: string | null;
  message: string | null;
};

const MAX_BINARY_BYTES = 5 * 1024 * 1024;

type AuthedOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, SvpQueryValue>;
  body?: unknown;
  /** Per-call timeout; the session-status heal uses a short one. */
  timeoutMs?: number;
  /** Retry budget for transient GET failures (default 2). */
  retries?: number;
};

/** Fetch with the stored session, refresh once on 401, and persist rotated cookies. */
async function performAuthedResponse(
  appUserId: string,
  path: string,
  options: AuthedOptions,
  sessionOverride?: SvpStoredSession,
): Promise<Response> {
  let session = sessionOverride ?? readStoredSvpSession(appUserId);
  if (!session) throw new SvpSessionMissingError();

  const send = async (active: SvpStoredSession) => {
    const headers: Record<string, string> = {
      ...BASE_HEADERS,
      Authorization: `Bearer ${active.access}`,
    };
    if (active.refreshCookies) headers["Cookie"] = active.refreshCookies;
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    return timedFetch(
      apiUrl(path, options.query),
      {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      },
      options.timeoutMs,
    );
  };

  let response = await send(session);
  if (response.status === 401) {
    session = await refreshStoredSession(appUserId, session);
    response = await send(session);
  }

  const method = options.method ?? "GET";
  const retryable = new Set([429, 502, 503, 504, 529]);
  let retries = 0;
  const maxRetries = options.retries ?? 2;
  while (method === "GET" && retryable.has(response.status) && retries < maxRetries) {
    retries += 1;
    await new Promise((resolve) => setTimeout(resolve, retries * 1500));
    response = await send(session);
  }

  // A rejected token means the stored SVP session is dead; force a fresh login.
  if (response.status === 401) {
    removeStoredSvpAccount(appUserId, session.login);
    throw new SvpSessionMissingError();
  }

  const rotated = responseCookies(response);
  if (rotated.length > 0) {
    session = { ...session, refreshCookies: mergeCookiePairs(session.refreshCookies, rotated) };
  }
  writeStoredSvpSession(appUserId, session);
  return response;
}

/**
 * Perform an authenticated SVP JSON request for the current app user.
 * Refreshes the bearer token once on 401 and persists rotated cookies.
 */
export async function svpAuthedRequest(
  appUserId: string,
  path: string,
  options: AuthedOptions = {},
  sessionOverride?: SvpStoredSession,
): Promise<SvpApiResponse> {
  const response = await performAuthedResponse(appUserId, path, options, sessionOverride);
  const payload = await readBoundedBody(response);
  return {
    ok: response.ok,
    status: response.status,
    payload,
    message: response.ok
      ? null
      : (svpErrorMessage(payload) ?? `SVP returned HTTP ${response.status}.`),
  };
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

/** Download a binary SVP document (ticket PDF) with the same session/refresh rules. */
export async function svpAuthedBinary(
  appUserId: string,
  path: string,
  options: AuthedOptions = {},
): Promise<SvpBinaryResponse> {
  const response = await performAuthedResponse(appUserId, path, options);
  const contentType = response.headers.get("content-type");

  if (!response.ok) {
    let message: string | null = null;
    try {
      message = svpErrorMessage(await readBoundedBody(response));
    } catch {
      message = null;
    }
    return {
      ok: false,
      status: response.status,
      contentType,
      base64: null,
      message: message ?? `SVP returned HTTP ${response.status}.`,
    };
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) {
    return {
      ok: false,
      status: response.status,
      contentType,
      base64: null,
      message: "SVP returned an empty ticket file.",
    };
  }
  if (buffer.byteLength > MAX_BINARY_BYTES) {
    return {
      ok: false,
      status: response.status,
      contentType,
      base64: null,
      message: "The SVP ticket is too large to download here. Use the official portal.",
    };
  }
  if (contentType && contentType.includes("json")) {
    let message: string | null = null;
    try {
      message = svpErrorMessage(JSON.parse(new TextDecoder().decode(buffer)));
    } catch {
      message = null;
    }
    return {
      ok: false,
      status: response.status,
      contentType,
      base64: null,
      message: message ?? "SVP did not return a ticket PDF.",
    };
  }

  return {
    ok: true,
    status: response.status,
    contentType: contentType ?? "application/pdf",
    base64: toBase64(buffer),
    message: null,
  };
}

/** Shared role gate for every SVP booking server function. */
export async function requireSvpAllowedRole(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data: rows, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (
    error ||
    !rows?.some((row: { role: string }) => ["admin", "staff", "agent"].includes(row.role))
  ) {
    throw new Error("Unauthorized");
  }
}

export function clearPendingSvpSession(appUserId: string): void {
  deleteCookie(`${PENDING_COOKIE_PREFIX}${cookieSuffix(appUserId)}`, { path: "/" });
}
