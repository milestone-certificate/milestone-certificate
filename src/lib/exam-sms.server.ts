const ORG = "Milestone Certificate Institute";

function toPhone(m: string | null | undefined) {
  const d = (m ?? "").replace(/\D/g, "").slice(-11);
  return /^01[3-9]\d{8}$/.test(d) ? `88${d}` : null;
}

async function sendSms(phone: string, message: string) {
  const params = new URLSearchParams({
    api_key: process.env["BULKSMSBD_API_KEY"] ?? "",
    type: "text",
    number: phone,
    senderid: process.env["BULKSMSBD_SENDER_ID"] ?? "",
    message,
  });
  try {
    const res = await fetch(`http://bulksmsbd.net/api/smsapi?${params}`);
    const text = await res.text();
    let code: unknown;
    try {
      code = (JSON.parse(text) as { response_code?: unknown }).response_code;
    } catch {
      code = undefined;
    }
    if (String(code) !== "202") console.error("BulkSMSBD send failed", res.status, text);
    return String(code) === "202";
  } catch (e) {
    console.error("BulkSMSBD request error", e);
    return false;
  }
}

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" });

/** Sends today's (Dhaka) Bogura exam SMS to candidates and one summary per agent. Skips already-sent. */
export async function sendTodayExamSms() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  const start = new Date(`${today}T00:00:00+06:00`);
  const end = new Date(start.getTime() + 24 * 3600_000);

  const { data: ttcs } = await supabaseAdmin.from("ttc_centers").select("id,name");
  const bogura = (ttcs ?? []).find((t) => t.name.includes("বগুড়া") || /bogura/i.test(t.name));
  if (!bogura) return { candidates: 0, agents: 0, failed: 0 };

  const [{ data: works }, { data: occs }, { data: agents }, { data: sent }] = await Promise.all([
    supabaseAdmin
      .from("job_submissions")
      .select("id,candidate_name,passport_no,mobile,exam_at,occupation_id,submitted_by")
      .eq("status", "approved")
      .eq("ttc_id", bogura.id)
      .gte("exam_at", start.toISOString())
      .lt("exam_at", end.toISOString())
      .order("exam_at"),
    supabaseAdmin.from("occupations").select("id,name"),
    supabaseAdmin.from("agent_accounts").select("user_id,full_name,mobile"),
    supabaseAdmin
      .from("sms_log")
      .select("kind,ref_key,phone")
      .eq("ok", true)
      .like("ref_key", `%${today}%`),
  ]);
  const occName = new Map((occs ?? []).map((o) => [o.id, o.name]));
  const done = new Set((sent ?? []).map((s) => `${s.kind}|${s.ref_key}|${s.phone}`));
  let candidates = 0,
    agentsSent = 0,
    failed = 0;

  const log = async (kind: string, ref: string, phone: string, ok: boolean) => {
    await supabaseAdmin
      .from("sms_log")
      .upsert({ kind, ref_key: ref, phone, ok }, { onConflict: "kind,ref_key,phone" });
  };

  for (const w of works ?? []) {
    const phone = toPhone(w.mobile);
    const ref = `${w.id}:${today}`;
    if (!phone || done.has(`candidate|${ref}|${phone}`)) continue;
    const at = new Date(w.exam_at);
    const msg = `📢 পরীক্ষার নির্দেশনা\n\nপ্রিয় ${w.candidate_name},\nআপনার পরীক্ষার বিস্তারিত তথ্য:\n\n📍 কেন্দ্র: টিটিসি বগুড়া\n📅 তারিখ: ${fmtDate(at)}\n⏰ সময়: ${fmtTime(at)}\n🕘 উপস্থিতি: পরীক্ষার অন্তত ১ ঘণ্টা আগে\n🏫 ভবন: একাডেমিক ভবন\n🚪 ৩য় তলা, কক্ষ নং ৩০৮\n\nযানজট বিবেচনায় পর্যাপ্ত সময় হাতে নিয়ে রওনা দিন।\n\nধন্যবাদান্তে,\n${ORG}`;
    const ok = await sendSms(phone, msg);
    await log("candidate", ref, phone, ok);
    if (ok) candidates++;
    else failed++;
  }

  const byAgent = new Map<string, NonNullable<typeof works>>();
  for (const w of works ?? [])
    byAgent.set(w.submitted_by, [...(byAgent.get(w.submitted_by) ?? []), w]);
  for (const a of agents ?? []) {
    const list = byAgent.get(a.user_id);
    const phone = toPhone(a.mobile);
    const ref = `${a.user_id}:${today}`;
    if (!list?.length || !phone || done.has(`agent|${ref}|${phone}`)) continue;
    const lines = list.map(
      (w, i) =>
        `${i + 1}. ${w.candidate_name.toUpperCase()} | ${w.passport_no} | ${fmtTime(new Date(w.exam_at))} | ${occName.get(w.occupation_id ?? "") ?? "-"}`,
    );
    const msg = `📋 আজকের পরীক্ষা (${fmtDate(start)}) — টিটিসি বগুড়া\nপ্রিয় ${a.full_name}, আপনার ${list.length} জন পরীক্ষার্থী:\n\n${lines.join("\n")}\n\nপরীক্ষার্থীদের অন্তত ১ ঘণ্টা আগে একাডেমিক ভবন, ৩য় তলা, কক্ষ ৩০৮-এ উপস্থিত রাখুন।\n— ${ORG}`;
    const ok = await sendSms(phone, msg);
    await log("agent", ref, phone, ok);
    if (ok) agentsSent++;
    else failed++;
  }
  return { candidates, agents: agentsSent, failed };
}
