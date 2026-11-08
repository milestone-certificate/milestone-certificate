import {
  appointmentDate,
  appointmentTime,
  isTicketHeading,
  parseAppointmentText,
  type TicketExtraction,
} from "./ticket-extraction";

export type TicketTextItem = { text: string; x: number; y: number; width: number; height: number };
export type TicketPage = { items: TicketTextItem[] };
type Cell = { text: string; x: number; right: number };
type Row = { y: number; height: number; items: TicketTextItem[]; cells: Cell[] };
const clean = (text: string) =>
  text
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
const section = (text: string) =>
  /^(?:test taker|test details|instructions|important notice)$/i.test(clean(text));
const passport = (text: string) =>
  /^[A-Z]{1,3}\d{5,9}$/.test(text.replace(/\s/g, "").toUpperCase());

/** PDF words are joined within a cell; large physical gaps preserve column boundaries. */
export function ticketRows(items: TicketTextItem[]): Row[] {
  const rows: Row[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    if (!item.text.trim()) continue;
    let row = rows.find(
      (r) => Math.abs(r.y - item.y) <= Math.max(1, Math.min(r.height, item.height || 7) * 0.3),
    );
    if (!row) {
      row = { y: item.y, height: item.height || 7, items: [], cells: [] };
      rows.push(row);
    }
    row.items.push(item);
  }
  for (const row of rows) {
    for (const item of row.items.sort((a, b) => a.x - b.x)) {
      const last = row.cells.at(-1);
      if (last && item.x - last.right < Math.max(8, row.height * 1.2)) {
        last.text = clean(last.text + " " + item.text);
        last.right = Math.max(last.right, item.x + item.width);
      } else row.cells.push({ text: clean(item.text), x: item.x, right: item.x + item.width });
    }
  }
  return rows.sort((a, b) => b.y - a.y);
}
function headerKind(
  text: string,
): "candidate_name" | "passport_no" | "occupation" | "other" | null {
  const value = clean(text).replace(/[:：]/g, "").toLowerCase();
  if (/^(?:name|full name|candidate name)$/.test(value)) return "candidate_name";
  if (/^passport\s*(?:number|no[.]?|#)$/.test(value)) return "passport_no";
  if (value === "occupation") return "occupation";
  if (/^(?:nationality|occupation code|test language)$/.test(value)) return "other";
  return null;
}

/** Read PACC ticket tables and the unlabeled test-details card, without guessing from notices. */
export function parseAppointmentLayout(
  pages: TicketPage[],
  confidence = 0.98,
): {
  extraction: TicketExtraction;
  hasConflicts: boolean;
} {
  const pageRows = pages.map((p) => ticketRows(p.items));
  const text = pageRows
    .map((rows) => rows.map((r) => r.cells.map((c) => c.text).join("  ")).join("\n"))
    .join("\n");
  const out = parseAppointmentText(text, confidence);
  const values = new Map<keyof TicketExtraction, Set<string>>();
  const add = (field: keyof TicketExtraction, value: string | null) => {
    if (!value || isTicketHeading(value)) return;
    const set = values.get(field) ?? new Set<string>();
    set.add(clean(value));
    values.set(field, set);
  };
  for (const rows of pageRows) {
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const headers = row.cells.map((cell) => ({ ...cell, kind: headerKind(cell.text) }));
      if (headers.filter((h) => h.kind).length < 2) continue;
      for (let col = 0; col < headers.length; col++) {
        const header = headers[col];
        if (!header.kind || header.kind === "other") continue;
        const parts: string[] = [];
        for (let next = index + 1; next < rows.length; next++) {
          const data = rows[next];
          if (
            row.y - data.y > Math.max(80, row.height * 12) ||
            section(data.cells.map((c) => c.text).join(" ")) ||
            data.cells.some((c) => headerKind(c.text))
          )
            break;
          const cells = data.cells.filter(
            (c) =>
              c.x >= header.x - 5 && (col === headers.length - 1 || c.x < headers[col + 1].x - 5),
          );
          const value = clean(cells.map((c) => c.text).join(" "));
          if (value && !isTicketHeading(value)) {
            if (header.kind === "passport_no") {
              if (passport(value)) add("passport_no", value.replace(/\s/g, "").toUpperCase());
            } else parts.push(value);
          }
        }
        if (parts.length) add(header.kind, parts.join(" "));
      }
    }
    const start = rows.findIndex((r) => r.cells.some((c) => /^test details$/i.test(c.text)));
    if (start < 0) continue;
    const end = rows.findIndex(
      (r, i) =>
        i > start &&
        (r.cells.some((c) => /^occupation$/i.test(c.text)) ||
          section(r.cells.map((c) => c.text).join(" "))),
    );
    const details = rows.slice(start + 1, end < 0 ? rows.length : end);
    for (let index = 0; index < details.length; index++) {
      const row = details[index];
      for (const cell of row.cells) {
        const date = appointmentDate(cell.text);
        if (!date) continue;
        add("exam_date", date);
        for (const neighbor of details.slice(index, index + 3)) {
          if (row.y - neighbor.y > Math.max(30, row.height * 4)) break;
          for (const timeCell of neighbor.cells) {
            if (Math.abs(timeCell.x - cell.x) > 12) continue;
            const value = clean(timeCell.text);
            if (/^\d{1,2}[:.]\d{2}(?::\d{2})?\s*(?:[AP]\.?M\.?)?$/i.test(value))
              add("exam_time", appointmentTime(value));
          }
        }
      }
    }
    // Stop the centre name at its institution suffix, before address/city lines.
    for (let index = 0; index < details.length; index++) {
      for (const first of details[index].cells) {
        if (!/technical|training|cent(?:er|re)|institute|\bttc\b/i.test(first.text)) continue;
        let name = first.text;
        for (
          let next = index + 1;
          next < details.length && !/\b(?:cent(?:er|re)|institute|ttc)\b/i.test(name);
          next++
        ) {
          if (details[index].y - details[next].y > Math.max(40, details[index].height * 6)) break;
          const continuation = details[next].cells.find((c) => Math.abs(c.x - first.x) <= 8);
          if (!continuation) break;
          name += " " + continuation.text;
        }
        const institution = /^(.+?\b(?:cent(?:er|re)|institute|ttc)\b)/i.exec(name);
        if (institution) add("center", institution[1]);
      }
    }
    const titleRow = rows.find((r) => r.cells.some((c) => /^test ticket$/i.test(c.text)));
    if (titleRow) {
      const number = titleRow.cells.find((c) => /^\d{5,12}$/.test(c.text));
      if (number) add("booking_no", number.text);
    }
  }
  let hasConflicts = false;
  for (const [key, set] of values) {
    // A trailing wrapped centre line alone is not another institution.
    let choices = [...set];
    if (key === "center")
      choices = choices.filter(
        (v) => !choices.some((other) => other.length > v.length && other.endsWith(v)),
      );
    if (choices.length === 1) {
      const value = key === "candidate_name" ? choices[0].toUpperCase() : choices[0];
      (out[key] as { value: string | null; confidence: number }) = { value, confidence };
    } else if (choices.length > 1) {
      hasConflicts = true;
      (out[key] as { value: string | null; confidence: number }) = { value: null, confidence: 0 };
      out.ambiguities.push(
        `একাধিক ${key === "exam_date" ? "পরীক্ষার তারিখ" : key === "exam_time" ? "পরীক্ষার সময়" : key === "passport_no" ? "পাসপোর্ট" : "তথ্য"} পাওয়া গেছে—মূল টিকিট যাচাই করুন।`,
      );
    }
  }
  const passportValues = values.get("passport_no");
  if (passportValues?.size)
    out.candidate_count = Math.max(out.candidate_count, passportValues.size);
  out.ambiguities = out.ambiguities.filter(
    (w) => !w.includes("তারিখ ও সময়") || !out.exam_date.value || !out.exam_time.value,
  );
  if (out.candidate_count > 1 && !out.ambiguities.some((w) => w.includes("একাধিক পরীক্ষার্থী")))
    out.ambiguities.push(
      "টিকিটে একাধিক পরীক্ষার্থী আছে। একজনের টিকিট দিন বা তথ্য নিজে যাচাই করুন।",
    );
  return { extraction: out, hasConflicts };
}
