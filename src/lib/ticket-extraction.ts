import { z } from "zod";

export const MAX_TICKET_BYTES = 8 * 1024 * 1024;
const field = z.object({
  value: z.string().max(500).nullable(),
  confidence: z.number().finite().min(0).max(1),
});
export const ticketExtractionSchema = z.object({
  candidate_name: field,
  passport_no: field,
  occupation: field,
  exam_date: field,
  exam_time: field,
  center: field,
  booking_no: field,
  agency_name: field,
  mobile: field.optional(),
  candidate_count: z.number().int().min(0).max(100),
  ambiguities: z.array(z.string().max(500)).max(30),
});
export type TicketExtraction = z.infer<typeof ticketExtractionSchema>;
export type TicketField = z.infer<typeof field>;
const emptyField = (): TicketField => ({ value: null, confidence: 0 });
export function emptyTicket(): TicketExtraction {
  return {
    candidate_name: emptyField(),
    passport_no: emptyField(),
    occupation: emptyField(),
    exam_date: emptyField(),
    exam_time: emptyField(),
    center: emptyField(),
    booking_no: emptyField(),
    agency_name: emptyField(),
    mobile: emptyField(),
    candidate_count: 0,
    ambiguities: [],
  };
}
export const asciiDigits = (text: string) =>
  text.replace(/[০-৯٠-٩۰-۹]/g, (c) => {
    const code = c.charCodeAt(0);
    return String(code >= 0x09e6 ? code - 0x09e6 : code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
export function appointmentDate(value: string): string | null {
  const s = asciiDigits(value).trim();
  let y = 0,
    m = 0,
    d = 0;
  const iso = /\b(20\d{2})[-/]([01]?\d)[-/]([0-3]?\d)\b/.exec(s);
  const local = /\b([0-3]?\d)[/.-]([01]?\d)[/.-](20\d{2})\b/.exec(s);
  const words = /\b(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]+)[\s,-]+(20\d{2})\b/i.exec(s);
  const monthFirst = /\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[\s,]+(20\d{2})\b/i.exec(s);
  if (iso) [, y, m, d] = iso.map(Number);
  else if (local) [, d, m, y] = local.map(Number);
  else if (words) {
    d = Number(words[1]);
    m =
      ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
        words[2].slice(0, 3).toLowerCase(),
      ) + 1;
    y = Number(words[3]);
  } else if (monthFirst) {
    d = Number(monthFirst[2]);
    m =
      ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
        monthFirst[1].slice(0, 3).toLowerCase(),
      ) + 1;
    y = Number(monthFirst[3]);
  } else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    date.getUTCDate() === d &&
    date.getUTCMonth() === m - 1
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : null;
}
export function appointmentTime(value: string): string | null {
  const s = asciiDigits(value)
    .toUpperCase()
    .replace(/\b([AP])\s*\.\s*M\.?/g, "$1M");
  const match = /\b(\d{1,2})[:.](\d{2})(?::\d{2})?\s*([AP]M)?\b/.exec(s);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2]),
    period = match[3];
  if (m > 59 || h > 23 || (period && (h < 1 || h > 12))) return null;
  if (period) h = (h % 12) + (period === "PM" ? 12 : 0);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
const labels = {
  candidate_name:
    "(?:candidate(?:\\s+full)?\\s+name|applicant(?:\\s+full)?\\s+name|full\\s+name|name)",
  passport_no: "(?:passport\\s*(?:number|no[.]?|#))",
  occupation:
    "(?:occupation(?!\\s+code\\b)(?:\\s+name)?|trade(?:\\s+name)?|profession|job\\s+title)",
  exam_date: "(?:exam(?:ination)?\\s+date|test\\s+date|appointment\\s+date|scheduled\\s+date|date)",
  exam_time:
    "(?:exam(?:ination)?\\s+(?:start\\s+)?time|test\\s+(?:start\\s+)?time|appointment\\s+time|start\\s+time|time)",
  center:
    "(?:(?:test|exam|examination|assessment)\\s+cent(?:er|re)(?:\\s+name)?|cent(?:er|re)\\s+name|venue)",
  booking_no: "(?:(?:booking|reservation|appointment)\\s*(?:number|no[.]?|id|#))",
  agency_name: "(?:agency\\s+name)",
  mobile: "(?:(?:mobile|phone|contact)(?:\\s+(?:number|no[.]?))?)",
} as const;
const labelStart = new RegExp(`^(?:${Object.values(labels).join("|")})\\s*(?::|：|$)`, "i");
/** Column headings are never field values, even when PDF extraction joins them. */
export function isTicketHeading(value: string): boolean {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!clean) return false;
  return /^(?:(?:name|full name|candidate name|passport number|passport no|nationality|occupation code|occupation|test language|exam date|test date|exam time|test time|test center|test centre|test taker|test details|instructions|important notice)\s*)+$/.test(
    clean,
  );
}
function printedValue(lines: string[], pattern: string): string | null {
  const re = new RegExp(`^${pattern}\\s*(?::|：)?\\s*(.*)$`, "i");
  for (let i = 0; i < lines.length; i++) {
    // Reporting/arrival instructions must never become the exam start time.
    if (
      /^date\s+of\s+(?:birth|expiry)|^expiry|reporting|arrival|arrive|minutes?\s+(?:before|early)/i.test(
        lines[i],
      )
    )
      continue;
    const match = re.exec(lines[i]);
    if (!match) continue;
    let v = match[1].trim();
    if (!v && lines[i + 1] && !labelStart.test(lines[i + 1])) v = lines[i + 1];
    // Some PDF rows contain two labelled columns.
    const later = new RegExp(`\\s{2,}(?=${Object.values(labels).join("|")})`, "i");
    v = v.split(later)[0]?.trim();
    if (v && !labelStart.test(v) && !isTicketHeading(v)) return v.slice(0, 500);
  }
  return null;
}
export function parseAppointmentText(raw: string, confidence = 0.98): TicketExtraction {
  const out = emptyTicket();
  const text = asciiDigits(raw).replace(/\u00a0/g, " ");
  const lines = text
    .split(/[\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const [key, pattern] of Object.entries(labels)) {
    const value = printedValue(lines, pattern);
    if (value) out[key as keyof typeof labels] = { value, confidence };
  }
  if (out.passport_no.value) {
    const pp = out.passport_no.value.replace(/\s/g, "").toUpperCase();
    out.passport_no.value = /^[A-Z]{1,3}\d{5,9}$/.test(pp) ? pp : null;
  }
  if (out.candidate_name.value) out.candidate_name.value = out.candidate_name.value.toUpperCase();
  out.exam_date.value = out.exam_date.value ? appointmentDate(out.exam_date.value) : null;
  out.exam_time.value = out.exam_time.value ? appointmentTime(out.exam_time.value) : null;
  if (out.mobile?.value) {
    const mobile = out.mobile.value.replace(/\D/g, "").replace(/^88/, "");
    out.mobile.value = /^01[3-9]\d{8}$/.test(mobile) ? mobile : null;
  }
  const passports = [
    ...text.matchAll(/passport\s*(?:number|no[.]?|#)\s*[:：]?\s*([A-Z]{1,3}\d{5,9})\b/gi),
  ].map((m) => m[1].toUpperCase());
  out.candidate_count = new Set(passports).size || (out.candidate_name.value ? 1 : 0);
  if (out.candidate_count > 1)
    out.ambiguities.push(
      "টিকিটে একাধিক পরীক্ষার্থী আছে। একজনের টিকিট দিন বা তথ্য নিজে যাচাই করুন।",
    );
  if (!out.exam_date.value || !out.exam_time.value)
    out.ambiguities.push("পরীক্ষার তারিখ ও সময় মূল টিকিটের সঙ্গে মিলিয়ে নিন।");
  return out;
}
export function hasAppointmentIdentity(x: TicketExtraction) {
  return (
    !!(x.candidate_name.value && x.passport_no.value && x.exam_date.value && x.exam_time.value) &&
    x.candidate_count === 1
  );
}
const catalogueText = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKC")
    .replace(/loading/g, "load")
    .replace(/unloading/g, "unload")
    .replace(/[&/]/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
/** A shared generic word such as "Technical" is never enough to choose a centre. */
export function matchTicketCatalogue<T extends { id: string; name: string; active?: boolean }>(
  value: string | null,
  rows: T[],
): T | undefined {
  if (!value) return;
  const needle = catalogueText(value);
  const available = rows.filter((r) => r.active !== false);
  const exact = available.filter((r) => catalogueText(r.name) === needle);
  if (exact.length === 1) return exact[0];
  const stop = new Set([
    "and",
    "the",
    "of",
    "test",
    "technical",
    "training",
    "centre",
    "center",
    "ttc",
    "institute",
    "in",
    "a",
    "worker",
  ]);
  const tokens = (s: string) =>
    new Set(
      catalogueText(s)
        .split(" ")
        .filter((t) => t.length > 2 && !stop.has(t)),
    );
  const n = tokens(value);
  if (!n.size) return;
  const contained = available.filter((r) => {
    const name = catalogueText(r.name);
    return name.length > 5 && (needle.includes(name) || name.includes(needle));
  });
  if (contained.length === 1) return contained[0];
  const fullyNamed = available.filter((row) => {
    const t = tokens(row.name);
    return t.size > 0 && [...t].every((x) => n.has(x));
  });
  if (
    fullyNamed.length === 1 &&
    available.filter((row) => [...tokens(row.name)].some((x) => n.has(x))).length === 1
  )
    return fullyNamed[0];
  const scored = available
    .map((row) => {
      const t = tokens(row.name);
      const common = [...t].filter((x) => n.has(x)).length;
      return { row, score: t.size ? common / Math.max(t.size, n.size) : 0 };
    })
    .sort((a, b) => b.score - a.score);
  if (scored[0]?.score >= 0.67 && (!scored[1] || scored[0].score - scored[1].score >= 0.2))
    return scored[0].row;
}
export function ticketMime(bytes: Uint8Array): string | null {
  if (String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
