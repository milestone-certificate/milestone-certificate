import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Candidate = Database["public"]["Tables"]["candidates"]["Row"];
export type Exam = Database["public"]["Tables"]["exams"]["Row"];
export type ResultRow = Database["public"]["Tables"]["results"]["Row"];
export type Ttc = Database["public"]["Tables"]["ttc_centers"]["Row"];
export type Occupation = Database["public"]["Tables"]["occupations"]["Row"];
export type Reminder = Database["public"]["Tables"]["reminders"]["Row"];
export type ExamResult = Database["public"]["Enums"]["exam_result"];

export const rspayDepositsQ = (userId: string, compact: boolean, page = 0) =>
  queryOptions({
    queryKey: ["rspay-records", userId, compact, page],
    queryFn: async () => {
      const size = compact ? 5 : 25;
      const { data, error } = await supabase
        .from("wallet_deposits")
        .select(
          "id, user_id, amount, method, gateway_status, gateway_short_code, gateway_transaction_id, created_at",
        )
        .eq("provider", "rspay")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page * size, (page + 1) * size - 1);
      if (error) throw new Error("Payment records unavailable");
      return data;
    },
    retry: false,
    refetchInterval: 30_000,
  });

export const walletPaymentProfilesQ = (userId: string, ids: string[]) =>
  queryOptions({
    queryKey: ["wallet-payment-profiles", userId, ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id,full_name,email")
        .in("id", ids);
      if (error) throw new Error("Profiles unavailable");
      return data;
    },
    staleTime: 60_000,
  });

export const RESULTS: ExamResult[] = ["PENDING", "PASS", "FAIL", "ABSENT", "CANCELLED"];
export const RESULT_LABEL: Record<ExamResult, string> = {
  PENDING: "অপেক্ষমান",
  PASS: "পাস",
  FAIL: "ফেল",
  ABSENT: "অনুপস্থিত",
  CANCELLED: "বাতিল",
};

async function all<T>(p: PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const { data, error } = await p;
  if (error) throw error;
  return data ?? [];
}

export const candidatesQ = queryOptions({
  queryKey: ["candidates"],
  queryFn: async () =>
    (
      await all<Candidate>(
        supabase.from("candidates").select("*").order("created_at", { ascending: false }),
      )
    ).map((c) => ({
      ...c,
      name: (c.name ?? "").toUpperCase(),
      passport_no: c.passport_no ? c.passport_no.toUpperCase() : c.passport_no,
    })),
});
export const examsQ = queryOptions({
  queryKey: ["exams"],
  queryFn: () =>
    all<Exam>(supabase.from("exams").select("*").order("exam_date", { ascending: false })),
});
export const resultsQ = queryOptions({
  queryKey: ["results"],
  queryFn: () =>
    all<ResultRow>(supabase.from("results").select("*").order("created_at", { ascending: false })),
});
export const ttcQ = queryOptions({
  queryKey: ["ttc"],
  queryFn: () =>
    all<Ttc>(supabase.from("ttc_centers").select("*").order("sort_order").order("name")),
});
export const occQ = queryOptions({
  queryKey: ["occ"],
  queryFn: async () =>
    pinOcc(await all<Occupation>(supabase.from("occupations").select("*").order("name"))),
});
export const remindersQ = queryOptions({
  queryKey: ["reminders"],
  queryFn: () => all<Reminder>(supabase.from("reminders").select("*").order("due_date")),
});
export const settingsQ = queryOptions({
  queryKey: ["settings"],
  queryFn: async () => {
    const rows = await all<{ key: string; value: string | null }>(
      supabase.from("settings").select("*"),
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value ?? ""])) as Record<string, string>;
  },
});

export function useRefreshAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function lookup<T extends { id: string; name: string }>(rows: T[] | undefined) {
  const m = new Map((rows ?? []).map((r) => [r.id, r.name]));
  return (id: string | null | undefined) => (id ? (m.get(id) ?? "—") : "—");
}

// ---------- dates ----------
export const todayStr = () => toISO(new Date());
// Bangladesh time (UTC+6, no DST) helpers for datetime-local inputs
export const dhakaInputToISO = (v: string) => (v ? new Date(`${v}:00+06:00`).toISOString() : null);
export const isoToDhakaInput = (iso: string | null | undefined) =>
  iso ? new Date(new Date(iso).getTime() + 6 * 3600000).toISOString().slice(0, 16) : "";
export function fmtDhaka(iso: string | null | undefined) {
  if (!iso) return "—";
  const [d, t] = isoToDhakaInput(iso).split("T");
  return `${fmtDate(d)}, ${fmtTime(t)}`;
}
export function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toISO(d);
}
const bnDigits = "০১২৩৪৫৬৭৮৯";
export const bn = (v: string | number) => String(v).replace(/\d/g, (d) => bnDigits[+d]);
const MONTHS = [
  "জানু",
  "ফেব্রু",
  "মার্চ",
  "এপ্রিল",
  "মে",
  "জুন",
  "জুলাই",
  "আগস্ট",
  "সেপ্ট",
  "অক্টো",
  "নভে",
  "ডিসে",
];
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${bn(d)} ${MONTHS[+m - 1]} ${bn(y)}`;
}
export function fmtTime(t: string | null | undefined) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  const ap = h < 12 ? "সকাল" : h < 16 ? "দুপুর" : "বিকাল";
  return `${ap} ${bn(((h + 11) % 12) + 1)}:${bn(String(m).padStart(2, "0"))}`;
}
export function dayLabel(iso: string) {
  const t = todayStr();
  if (iso === t) return "আজ";
  if (iso === addDays(t, 1)) return "আগামীকাল";
  return null;
}
export function fmtDhakaDate(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ---------- export ----------
// Neutralize spreadsheet formulas in user-supplied text cells.
function safeCell(v: unknown): string {
  const s = String(v ?? "");
  return typeof v === "string" && /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
export function exportCSV(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const esc = (v: unknown) => `"${safeCell(v).replace(/"/g, '""')}"`;
  const csv =
    "\uFEFF" +
    [keys.map(esc).join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${name}.csv`);
}
export async function exportXLSX(name: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(
    rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? safeCell(v) : v]),
      ),
    ),
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${name}.xlsx`);
}
function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Always keep "Load and Unload Worker" pinned at the top of every occupation list. */
export const PINNED_OCC = "load and unload worker";
export function pinOcc<T extends { name: string }>(rows: T[]): T[] {
  const isPin = (r: T) => r.name.trim().toLowerCase() === PINNED_OCC;
  return [...rows.filter(isPin), ...rows.filter((r) => !isPin(r))];
}
