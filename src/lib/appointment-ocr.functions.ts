import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { ticketExtractionSchema, appointmentDate } from "@/lib/ticket-extraction";

export type Extracted = {
  candidate_name: string | null;
  passport_no: string | null;
  booking_no: string | null;
  exam_date: string | null;
  exam_time: string | null;
  reporting_time: string | null;
  center: string | null;
  occupation: string | null;
  confidence: number;
  ambiguities: string[];
};

async function assertAdmin(ctx: { supabase: SupabaseClient<Database>; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("শুধু অ্যাডমিন এটি করতে পারবেন");
}
const norm = (value: string | null) => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** Prepare a private document, or save the administrator's locally recognized review data. */
export const scanAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ submissionId: z.string().uuid(), extraction: ticketExtractionSchema.optional() })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const sb = context.supabase;
    const { data: work, error } = await sb
      .from("job_submissions")
      .select("id,ticket_path,passport_no,candidate_name,exam_at")
      .eq("id", data.submissionId)
      .maybeSingle();
    if (error || !work) return { error: "কাজটি পাওয়া যায়নি।" };
    if (!work.ticket_path) return { error: "এই কাজে টিকিট দেওয়া হয়নি।" };
    if (!data.extraction) {
      const signed = await sb.storage
        .from("candidate-photos")
        .createSignedUrl(work.ticket_path, 300);
      if (signed.error || !signed.data?.signedUrl)
        return { error: "টিকিট খোলা যায়নি। আবার চেষ্টা করুন।" };
      return {
        document: {
          url: signed.data.signedUrl,
          name: work.ticket_path.split("/").pop() || "appointment.pdf",
        },
      };
    }
    const x = data.extraction;
    const fields = [x.candidate_name, x.passport_no, x.exam_date, x.exam_time].filter(
      (f) => f.value,
    );
    const confidence = fields.length
      ? fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length
      : 0;
    const extracted: Extracted = {
      candidate_name: x.candidate_name.value,
      passport_no: x.passport_no.value,
      booking_no: x.booking_no.value,
      exam_date: x.exam_date.value,
      exam_time: x.exam_time.value,
      reporting_time: null,
      center: x.center.value,
      occupation: x.occupation.value,
      confidence,
      ambiguities: x.ambiguities,
    };
    const warnings = [...x.ambiguities];
    if (confidence < 0.8) warnings.push("কম নির্ভরযোগ্যতা—মূল টিকিট মিলিয়ে দেখুন।");
    if (x.candidate_count > 1) warnings.push("টিকিটে একাধিক পরীক্ষার্থী আছে।");
    if (x.passport_no.value && norm(x.passport_no.value) !== norm(work.passport_no))
      warnings.push("পাসপোর্ট মিলছে না।");
    if (x.candidate_name.value && norm(x.candidate_name.value) !== norm(work.candidate_name))
      warnings.push("নাম মিলছে না।");
    if (!x.exam_date.value || !x.exam_time.value)
      warnings.push("পরীক্ষার তারিখ/সময় নিজে যাচাই করুন।");
    const saved = await sb
      .from("appointment_extractions")
      .insert({
        submission_id: work.id,
        created_by: context.userId,
        old_exam_at: work.exam_at,
        status: "needs_review",
        extracted,
        confidence,
        warnings: [...new Set(warnings)],
      })
      .select("id,extracted,confidence,warnings")
      .single();
    if (saved.error || !saved.data) return { error: "স্ক্যানের তথ্য সংরক্ষণ করা যায়নি।" };
    return { extraction: saved.data };
  });
export const verifyAppointment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        extractionId: z.string().uuid(),
        examDate: z.string().refine((v) => appointmentDate(v) === v),
        examTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        reportingTime: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .nullable(),
        reason: z.string().max(500).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const result = await context.supabase.rpc("verify_appointment_scan", {
      _extraction_id: data.extractionId,
      _exam_date: data.examDate,
      _exam_time: data.examTime,
      _reporting_time: data.reportingTime,
      _reason: data.reason?.trim() || null,
    });
    if (result.error || result.data !== true)
      return { error: "যাচাই সংরক্ষণ করা যায়নি। সংশোধনের কারণ দিন অথবা আবার স্ক্যান করুন।" };
    return { ok: true };
  });
