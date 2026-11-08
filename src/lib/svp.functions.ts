import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { readBoundedJson, releaseResponseBody } from "@/lib/bounded-json";
import { svpResultDate, svpResultSaveIssue } from "@/lib/svp-result.shared";

const API = "https://svp-international-api.pacc.sa/api/v1/visitor_space";
const HEADERS = {
  Origin: "https://svp-international.qiwa.sa",
  Referer: "https://svp-international.qiwa.sa/",
  Accept: "application/json",
  "X-Tenant-Name": "svp-international",
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

async function fetchRetry(url: string, tries = 3, timeoutMs = 15000): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeoutMs) });
      if (r.status >= 500 && i < tries - 1) {
        last = new Error(`status ${r.status}`);
        // An unconsumed body pins a pooled connection while we back off.
        await releaseResponseBody(r);
        continue;
      }
      return r;
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((s) => setTimeout(s, 700 * (i + 1)));
    }
  }
  throw last;
}

export async function querySvp(
  passport: string,
  occupationKey: string,
  options: { tries?: number; timeoutMs?: number } = {},
): Promise<SvpCheck> {
  const pp = passport.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  const qs = new URLSearchParams({
    passport_number: pp,
    occupation_key: occupationKey.trim(),
    nationality_id: BANGLADESH_CODE,
    locale: "en",
  });
  try {
    const r = await fetchRetry(
      `${API}/labors?${qs}`,
      Math.max(1, Math.min(options.tries ?? 3, 3)),
      Math.max(1000, Math.min(options.timeoutMs ?? 15000, 15000)),
    );
    // Bounded read: a huge or malformed gateway body becomes an empty result, not memory pressure.
    const body = await readBoundedJson(r);
    if (r.status === 404)
      return { status: "not_found", message: "SVP-তে কোনো রেজাল্ট পাওয়া যায়নি" };
    if (!r.ok) return { status: "error", message: "SVP সার্ভারে সমস্যা, পরে চেষ্টা করুন" };
    if (!body || typeof body !== "object" || Array.isArray(body))
      return { status: "error", message: "SVP-এর উত্তর পড়া যায়নি। আবার চেষ্টা করুন।" };
    const j = body as Record<string, unknown>;
    if (j.error) return { status: "not_found", message: "SVP-তে কোনো রেজাল্ট পাওয়া যায়নি" };
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
      examDate: svpResultDate(rec.exam_date),
      applicantName: rec.applicant_name ? String(rec.applicant_name) : null,
      occupation: nameOf(rec.occupation),
    };
  } catch (e) {
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

/** The browser selects an exam; its passport, occupation and result come from trusted sources. */
export const checkSvpExamResult = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ examId: z.string().uuid() }).strict().parse(input))
  .handler(
    async ({ data, context }): Promise<{ result: SvpCheck; saved: boolean; message: string }> => {
      const fail = (message: string) => ({
        result: { status: "error" as const, message },
        saved: false,
        message,
      });
      const role = await context.supabase.rpc("is_staff", { _user_id: context.userId });
      if (role.error || role.data !== true) return fail("অনুমতি নেই");
      const { data: exam, error: examError } = await context.supabase
        .from("exams")
        .select("id,candidate_id,occupation_id,exam_date,exam_time,result")
        .eq("id", data.examId)
        .maybeSingle();
      if (examError || !exam?.candidate_id) return fail("পরীক্ষার তথ্য পাওয়া যায়নি।");
      const { data: candidate, error: candidateError } = await context.supabase
        .from("candidates")
        .select("id,passport_no,occupation_id")
        .eq("id", exam.candidate_id)
        .maybeSingle();
      if (candidateError || !candidate?.passport_no)
        return fail("পরীক্ষার্থীর পাসপোর্ট পাওয়া যায়নি।");
      const occupationId = exam.occupation_id ?? candidate.occupation_id;
      if (!occupationId) return fail("এই পরীক্ষার পেশা নির্বাচন করা নেই।");
      const { data: occupation, error: occupationError } = await context.supabase
        .from("occupations")
        .select("svp_key")
        .eq("id", occupationId)
        .maybeSingle();
      if (occupationError || !occupation?.svp_key) return fail("এই পেশার SVP কোড নেই।");
      const passport = candidate.passport_no.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
      const result = await querySvp(passport, occupation.svp_key);
      if (result.status !== "found") return { result, saved: false, message: result.message };
      const issue = svpResultSaveIssue(result, exam.exam_date);
      if (issue) return { result, saved: false, message: issue };
      if (exam.result !== "PENDING")
        return { result, saved: false, message: "এই পরীক্ষার রেজাল্ট আগেই দেওয়া হয়েছে।" };
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const applied = await supabaseAdmin.rpc("apply_verified_svp_exam_result", {
        _exam_id: exam.id,
        _snapshot: {
          candidate_id: candidate.id,
          passport,
          occupation_id: exam.occupation_id,
          resolved_occupation_id: occupationId,
          occupation_key: occupation.svp_key,
          exam_date: exam.exam_date,
          exam_time: exam.exam_time,
        },
        _result: result.result,
        _result_date: result.examDate!,
      });
      const parsed = z.object({ ok: z.boolean(), reason: z.string() }).safeParse(applied.data);
      if (applied.error || !parsed.success)
        return { result, saved: false, message: "রেজাল্ট সংরক্ষণ হয়নি। আবার চেষ্টা করুন।" };
      return {
        result,
        saved: parsed.data.ok,
        message: parsed.data.ok
          ? `রেজাল্ট সংরক্ষিত: ${result.result}`
          : "পরীক্ষার তথ্য বদলেছে বা রেজাল্ট আগেই দেওয়া হয়েছে। Refresh করে দেখুন।",
      };
    },
  );

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
  if (res.result === "PENDING")
    return {
      svp_result: prev === "PASS" || prev === "FAIL" ? prev : "PENDING",
      svp_checked_at: now,
    };
  if (!examDay || svpResultSaveIssue(res, examDay))
    return {
      svp_result: prev === "PASS" || prev === "FAIL" ? prev : "NOT_FOUND",
      svp_old_result: res.result,
      svp_exam_date: res.examDate,
      svp_checked_at: now,
    };
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
    let update = supabaseAdmin
      .from("job_submissions")
      .update(upd)
      .eq("id", sub.id)
      .eq("passport_no", sub.passport_no)
      .eq("occupation_id", sub.occupation_id);
    update = sub.exam_at ? update.eq("exam_at", sub.exam_at) : update.is("exam_at", null);
    const { error: updErr, data: updated } = await update.select("id");
    if (updErr) return { status: "error", message: "রেজাল্ট সংরক্ষণ করা যায়নি" };
    if (!updated?.length)
      return { status: "error", message: "পরীক্ষার তথ্য বদলেছে। Refresh করে আবার দেখুন।" };
    if ("svp_old_result" in upd && upd.svp_old_result)
      return {
        status: "not_found",
        message: `অন্য পরীক্ষার রেজাল্ট (${upd.svp_exam_date ?? "তারিখ নেই"}): ${upd.svp_old_result} — এই পরীক্ষায় সেভ করা হয়নি`,
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

/** Aggregate operational status is staff-only; no applicant identifiers are returned. */
export const getSvpResultAutomationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (role.error || role.data !== true) throw new Error("অনুমতি নেই");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const result = await supabaseAdmin.rpc("svp_result_automation_status");
    if (result.error) throw new Error("অটো চেকের তথ্য আসেনি");
    return z
      .object({
        enabled: z.boolean(),
        lastRunAt: z.string().nullable(),
        lastChecked: z.number(),
        lastSaved: z.number(),
        lastErrors: z.number(),
        delayMinutes: z.literal(120),
        intervalMinutes: z.literal(5),
        pending: z.number(),
        missingInfo: z.number(),
        nextCheckAt: z.string().nullable(),
      })
      .parse(result.data);
  });
