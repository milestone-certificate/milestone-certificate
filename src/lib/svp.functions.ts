import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readBoundedJson, releaseResponseBody } from "@/lib/bounded-json";

const API = "https://svp-international-api.pacc.sa/api/v1/visitor_space";
const HEADERS = {
  Origin: "https://svp-international.qiwa.sa",
  Referer: "https://svp-international.qiwa.sa/",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
};
export const BANGLADESH_CODE = "BGD";

export type { SvpCatalogueOccupation as SvpOccupation } from "./svp-occupations.server";
import type { SvpCatalogueOccupation as SvpOccupation } from "./svp-occupations.server";
export type SvpCheck =
  | {
      status: "found";
      result: "PASS" | "FAIL" | "PENDING";
      examDate: string | null;
      applicantName: string | null;
      occupation: string | null;
    }
  | { status: "not_found" | "error"; message: string };

export const listSvpOccupations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<SvpOccupation[]> => {
    const { fetchSvpOccupationCatalogue } = await import("./svp-occupations.server");
    return fetchSvpOccupationCatalogue();
  });

/** Only admins may import the complete official reference catalogue. */
export const syncSvpOccupationCatalogue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (role.error || role.data !== true)
      return { ok: false as const, message: "শুধু admin পেশার তালিকা sync করতে পারবেন।" };
    try {
      const { fetchSvpOccupationCatalogue } = await import("./svp-occupations.server");
      const items = await fetchSvpOccupationCatalogue();
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.rpc("sync_svp_occupation_catalogue", {
        _items: items,
      });
      const stats = z
        .object({
          official: z.number().int(),
          inserted: z.number().int(),
          linked: z.number().int(),
          unchanged: z.number().int(),
          conflicts: z.number().int(),
          total: z.number().int(),
        })
        .safeParse(data);
      if (error || !stats.success) throw new Error("Catalogue import failed");
      return { ok: true as const, ...stats.data };
    } catch {
      return {
        ok: false as const,
        message: "SVP পেশার সম্পূর্ণ তালিকা আনা যায়নি। আবার চেষ্টা করুন।",
      };
    }
  });

const MAP: Record<string, "PASS" | "FAIL" | "PENDING"> = {
  passed: "PASS",
  failed: "FAIL",
  pending: "PENDING",
};

async function fetchRetry(url: string, tries = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 15000);
    try {
      const r = await fetch(url, { headers: HEADERS, signal: ac.signal });
      if (r.status >= 500 && i < tries - 1) {
        last = new Error(`status ${r.status}`);
        // An unconsumed body pins a pooled connection while we back off.
        await releaseResponseBody(r);
        continue;
      }
      return r;
    } catch (e) {
      last = e;
      await new Promise((s) => setTimeout(s, 700 * (i + 1)));
    } finally {
      clearTimeout(t);
    }
  }
  throw last;
}

export async function querySvp(passport: string, occupationKey: string): Promise<SvpCheck> {
  const pp = passport.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const qs = new URLSearchParams({
    passport_number: pp,
    occupation_key: occupationKey.trim(),
    nationality_id: BANGLADESH_CODE,
    locale: "en",
  });
  try {
    const r = await fetchRetry(`${API}/labors?${qs}`);
    // Bounded read: a huge or malformed gateway body becomes an empty result, not memory pressure.
    const j = ((await readBoundedJson(r)) ?? {}) as Record<string, unknown>;
    if (r.status === 404 || j.error)
      return { status: "not_found", message: "SVP-তে কোনো রেজাল্ট পাওয়া যায়নি" };
    if (!r.ok) return { status: "error", message: "SVP সার্ভারে সমস্যা, পরে চেষ্টা করুন" };
    const rec =
      ((j.labor ?? j.data ?? (Array.isArray(j.labors) ? j.labors[0] : null) ?? j) as Record<
        string,
        unknown
      >) || {};
    const result = MAP[String(rec.exam_result ?? "").toLowerCase()];
    if (!result) return { status: "not_found", message: "SVP-তে কোনো রেজাল্ট পাওয়া যায়নি" };
    const nameOf = (v: unknown) =>
      v && typeof v === "object"
        ? String(
            (v as Record<string, unknown>).english_name ??
              (v as Record<string, unknown>).name ??
              "",
          )
        : v
          ? String(v)
          : null;
    return {
      status: "found",
      result,
      examDate: rec.exam_date ? String(rec.exam_date).slice(0, 10) : null,
      applicantName: rec.applicant_name ? String(rec.applicant_name) : null,
      occupation: nameOf(rec.occupation),
    };
  } catch (e) {
    console.error("SVP check failed", e);
    return {
      status: "error",
      message: "SVP সার্ভার এই মুহূর্তে সাড়া দিচ্ছে না — কিছুক্ষণ পর আবার চেষ্টা করুন",
    };
  }
}

export const checkSvpResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        passport: z
          .string()
          .transform((s) => s.replace(/[^A-Za-z0-9]/g, ""))
          .pipe(z.string().min(5).max(20)),
        occupationKey: z
          .string()
          .trim()
          .regex(/^\d{4,8}$/),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<SvpCheck> => {
    const { data: staff } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!staff) return { status: "error", message: "অনুমতি নেই" };
    return querySvp(data.passport, data.occupationKey);
  });

/** Map an SVP lookup to submission columns. A result dated before this exam day is an older attempt — never shown as the current result. */
export function svpUpdate(res: SvpCheck, examAt: string | null, prev: string) {
  const now = new Date().toISOString();
  if (res.status !== "found")
    return {
      svp_result: prev === "PASS" || prev === "FAIL" ? prev : "NOT_FOUND",
      svp_checked_at: now,
    };
  const examDay = examAt
    ? new Date(new Date(examAt).getTime() + 6 * 3600_000).toISOString().slice(0, 10)
    : null;
  const old = !!(res.examDate && examDay && res.examDate < examDay);
  if (old)
    return {
      svp_result: "NOT_FOUND",
      svp_old_result: res.result,
      svp_exam_date: res.examDate,
      svp_checked_at: now,
    };
  if (res.result === "PENDING") return { svp_result: "PENDING", svp_checked_at: now };
  return {
    svp_result: res.result,
    svp_exam_date: res.examDate,
    svp_old_result: null,
    svp_checked_at: now,
  };
}

/** Check SVP for one submitted work. Admin/staff or a service provider (approved works only, enforced by RLS). */
export const checkSubmissionSvp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SvpCheck> => {
    const roles = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (roles.error) return { status: "error", message: "অনুমতি যাচাই করা যায়নি" };
    const manager = (roles.data ?? []).some((row) => row.role === "admin" || row.role === "staff");
    const provider = (roles.data ?? []).some((row) => row.role === "service_provider");
    const agent = (roles.data ?? []).some((row) => row.role === "agent");
    if (!manager && !provider && !agent) return { status: "error", message: "অনুমতি নেই" };
    if (!manager) {
      const active = await context.supabase.rpc("is_active_account", { _user_id: context.userId });
      if (active.error || active.data !== true) return { status: "error", message: "অনুমতি নেই" };
    }
    const { data: sub } = await context.supabase
      .from("job_submissions")
      .select("id, passport_no, occupation_id, exam_at, svp_result, status, submitted_by")
      .eq("id", data.id)
      .maybeSingle();
    if (
      !sub ||
      (!manager &&
        (sub.status !== "approved" || (!provider && sub.submitted_by !== context.userId)))
    )
      return { status: "error", message: "অনুমতি নেই" };
    if (!sub.occupation_id) return { status: "error", message: "পেশা নির্বাচন করা নেই" };
    const { data: occ } = await context.supabase
      .from("occupations")
      .select("svp_key")
      .eq("id", sub.occupation_id)
      .maybeSingle();
    if (!occ?.svp_key) return { status: "error", message: "এই পেশার SVP কোড নেই" };
    const res = await querySvp(sub.passport_no, occ.svp_key);
    if (res.status === "error") return res;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const upd = svpUpdate(res, sub.exam_at, sub.svp_result);
    const { error: updErr } = await supabaseAdmin
      .from("job_submissions")
      .update(upd)
      .eq("id", sub.id);
    if (updErr) return { status: "error", message: "রেজাল্ট সংরক্ষণ করা যায়নি" };
    if ("svp_old_result" in upd && upd.svp_old_result)
      return {
        status: "not_found",
        message: `পুরোনো রেজাল্ট (${upd.svp_exam_date}): ${upd.svp_old_result} — এই পরীক্ষার রেজাল্ট এখনো আসেনি`,
      };
    return res;
  });

// Public live lookup (same data the official public Qiwa page shows; returns only the queried passport's result).
export const publicSvpLookup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        passport: z
          .string()
          .transform((s) => s.replace(/[^A-Za-z0-9]/g, ""))
          .pipe(z.string().min(5).max(20)),
        occupationId: z.string().uuid(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: o } = await supabaseAdmin
      .from("occupations")
      .select("svp_key")
      .eq("id", data.occupationId)
      .eq("active", true)
      .maybeSingle();
    const key = (o as { svp_key?: string | null } | null)?.svp_key;
    if (!key) return { status: "error", message: "এই পেশার SVP কোড সেট করা নেই" } as SvpCheck;
    return querySvp(data.passport, key);
  });
