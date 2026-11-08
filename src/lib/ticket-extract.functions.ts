import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const FIELD = {
  type: "object",
  additionalProperties: false,
  required: ["value", "confidence"],
  properties: {
    value: { type: ["string", "null"] },
    confidence: { type: "number", description: "0-1 how clearly this field is printed/readable" },
  },
} as const;
const KEYS = [
  "candidate_name",
  "passport_no",
  "occupation",
  "exam_date",
  "exam_time",
  "center",
  "booking_no",
  "agency_name",
] as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...KEYS, "candidate_count", "ambiguities"],
  properties: {
    candidate_name: FIELD,
    passport_no: FIELD,
    occupation: FIELD,
    exam_date: { ...FIELD, description: "value YYYY-MM-DD" },
    exam_time: { ...FIELD, description: "value HH:MM 24h exam start (not reporting time)" },
    center: FIELD,
    booking_no: FIELD,
    agency_name: FIELD,
    candidate_count: { type: "number" },
    ambiguities: { type: "array", items: { type: "string" } },
  },
} as const;

export type TicketField = { value: string | null; confidence: number };
export type TicketExtraction = Record<(typeof KEYS)[number], TicketField> & {
  candidate_count: number;
  ambiguities: string[];
};

const MIMES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export const extractTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        mime: z.enum(MIMES as [string, ...string[]]),
        b64: z.string().min(100).max(14_000_000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const roles = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (
      roles.error ||
      !(roles.data ?? []).some(
        (r) => r.role === "admin" || r.role === "staff" || r.role === "agent",
      )
    )
      return { error: "অনুমতি নেই" };
    const { data: active, error: activeError } = await context.supabase.rpc("is_active_account", {
      _user_id: context.userId,
    });
    if (activeError || active !== true) return { error: "অ্যাকাউন্ট সক্রিয় নয়" };
    const head = atob(data.b64.slice(0, 8));
    const ok =
      data.mime === "application/pdf"
        ? head.startsWith("%PDF")
        : data.mime === "image/png"
          ? head.slice(1, 4) === "PNG"
          : data.mime === "image/jpeg"
            ? head.charCodeAt(0) === 0xff
            : head.startsWith("RIFF");
    if (!ok) return { error: "ফাইলের ধরন সঠিক নয়" };
    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { error: "PDF পড়ার সার্ভিস কনফিগার করা নেই — ম্যানুয়ালি পূরণ করুন" };
    const part =
      data.mime === "application/pdf"
        ? {
            type: "input_file",
            filename: "ticket.pdf",
            file_data: `data:application/pdf;base64,${data.b64}`,
          }
        : { type: "input_image", image_url: `data:${data.mime};base64,${data.b64}` };
    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "Lovable-API-Key": key,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        stream: true,
        store: false,
        reasoning: { effort: "medium" },
        instructions:
          "You read Saudi SVP / Takamul exam appointment tickets (may be rotated or blurry). Extract only what is clearly printed; value null when missing or unreadable — never guess. Give an honest per-field confidence (lower it for blurry, partially hidden or conflicting text). Exam time is the exam start, not reporting time. Report how many candidates appear. List any conflicting dates/times or unclear characters in ambiguities.",
        text: { format: { type: "json_schema", name: "ticket", strict: true, schema: SCHEMA } },
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "Extract the appointment details from this ticket." },
              part,
            ],
          },
        ],
      }),
    });
    if (!res.ok || !res.body) {
      console.error("ticket extract gateway", res.status, await res.text().catch(() => ""));
      if (res.status === 429) return { error: "অনেক অনুরোধ, একটু পরে আবার চেষ্টা করুন" };
      if (res.status === 402 || res.status === 403)
        return { error: "PDF পড়ার সার্ভিস এখন বন্ধ — ম্যানুয়ালি পূরণ করুন" };
      return { error: "PDF পড়া যায়নি — ম্যানুয়ালি পূরণ করুন" };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "",
      text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.type === "response.output_text.delta") text += ev.delta;
        } catch {
          /* partial */
        }
      }
    }
    try {
      return { extraction: JSON.parse(text) as TicketExtraction };
    } catch {
      return { error: "PDF পড়া যায়নি — ম্যানুয়ালি পূরণ করুন" };
    }
  });
