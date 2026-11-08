import { DateSelect } from "@/components/app/DateSelect";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createClientOnlyFn, useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ScanLine, Loader2, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { scanAppointment, verifyAppointment } from "@/lib/appointment-ocr.functions";
import type { Extracted } from "@/lib/appointment-ocr.functions";

const readTicket = createClientOnlyFn(async (file: File, signal: AbortSignal) => {
  const { readAppointment } = await import("@/lib/ticket-reader.client");
  return readAppointment(file, signal, () => {});
});
type Ext = { id: string; extracted: Extracted; confidence: number | null; warnings: unknown };
type Saved = { name: string; passport: string; occupation: string };

const norm = (s?: string | null) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const dDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
const dTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
const HIDE = /report|arriv|minute|early|before|মিনিট|উপস্থিত|আগে/i;

export function AppointmentScan({
  submissionId,
  examAt,
  saved,
}: {
  submissionId: string;
  examAt: string;
  saved?: Saved;
}) {
  const scan = useServerFn(scanAppointment);
  const verify = useServerFn(verifyAppointment);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const [ext, setExt] = useState<Ext | null>(null);
  const [f, setF] = useState({ date: "", time: "", reason: "" });

  async function run() {
    setBusy(true);
    let timeout: number | undefined;
    try {
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      timeout = window.setTimeout(() => abort.abort(), 90_000);
      const prepared = await scan({ data: { submissionId } });
      if ("error" in prepared) return toast.error(prepared.error);
      if (!("document" in prepared) || !prepared.document) return toast.error("টিকিট পাওয়া যায়নি।");
      const response = await fetch(prepared.document.url, { signal: abort.signal });
      if (!response.ok) throw new Error("Document unavailable");
      const file = new File([await response.blob()], prepared.document.name);
      const result = await readTicket(file, abort.signal);
      if (!result || abort.signal.aborted) return;
      const recorded = await scan({ data: { submissionId, extraction: result.extraction } });
      if ("error" in recorded) return toast.error(recorded.error);
      if (!("extraction" in recorded) || !recorded.extraction) return;
      const e = recorded.extraction as unknown as Ext;
      setExt(e);
      setF({ date: e.extracted.exam_date ?? "", time: e.extracted.exam_time ?? "", reason: "" });
    } catch {
      if (!controller.current?.signal.aborted) toast.error("টিকিট পড়া যায়নি। আবার চেষ্টা করুন।");
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  async function save() {
    if (!ext || !f.date || !f.time) return toast.error("তারিখ ও সময় দিন");
    setBusy(true);
    try {
      const r = await verify({
        data: {
          extractionId: ext.id,
          examDate: f.date,
          examTime: f.time,
          reportingTime: null,
          reason: f.reason || null,
        },
      });
      if ("error" in r && r.error) return toast.error(r.error);
      toast.success("পরীক্ষার সময় যাচাই করে আপডেট হয়েছে");
      setExt(null);
      qc.invalidateQueries();
    } catch {
      toast.error("যাচাই সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  const x: Partial<Extracted> = ext?.extracted ?? {};
  const warnings: string[] = (
    Array.isArray(ext?.warnings) ? (ext!.warnings as string[]) : []
  ).filter((w) => !HIDE.test(w));
  const rows: [string, string, string | null][] = [
    ["পরীক্ষার তারিখ", examAt ? dDate(examAt) : "", x.exam_date ?? null],
    ["পরীক্ষার সময়", examAt ? dTime(examAt) : "", x.exam_time ?? null],
    ["পরীক্ষার্থীর নাম", saved?.name ?? "", x.candidate_name ?? null],
    ["পাসপোর্ট নম্বর", saved?.passport ?? "", x.passport_no ?? null],
    ["পেশা", saved?.occupation ?? "", x.occupation ?? null],
  ];
  return (
    <>
      <Button variant="outline" size="sm" disabled={busy} onClick={run}>
        {busy && !ext ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
        ) : (
          <ScanLine className="mr-1 h-4 w-4" />
        )}{" "}
        টিকিট স্ক্যান
      </Button>
      <Dialog open={!!ext} onOpenChange={(o) => !o && setExt(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>টিকিট যাচাই</DialogTitle>
          </DialogHeader>
          <div className="overflow-hidden rounded-xl border text-sm">
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 bg-muted px-2 py-1.5 text-xs font-semibold">
              <span>বিষয়</span>
              <span>জমা দেওয়া</span>
              <span>টিকিটে</span>
              <span />
            </div>
            {rows.map(([label, cur, tk]) => {
              const ok = !!tk && !!cur && norm(cur) === norm(tk);
              const bad = !!tk && !!cur && !ok;
              return (
                <div
                  key={label}
                  className={`grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 border-t px-2 py-1.5 ${bad ? "bg-destructive/10" : ""}`}
                >
                  <span className="font-medium">{label}</span>
                  <span className="break-all">{cur || "—"}</span>
                  <span className={`break-all ${bad ? "font-semibold text-destructive" : ""}`}>
                    {tk ?? "পাওয়া যায়নি"}
                  </span>
                  {ok ? (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  ) : bad ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            নির্ভরযোগ্যতা: {Math.round((ext?.confidence ?? 0) * 100)}% · লাল চিহ্নিত ঘরে টিকিটের
            সাথে অমিল আছে।
          </p>
          {warnings.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
              {warnings.map((w, i) => (
                <li key={i} className="flex gap-1">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {w}
                </li>
              ))}
            </ul>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs">
              পরীক্ষার তারিখ
              <DateSelect value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </label>
            <label className="text-xs">
              পরীক্ষার সময়
              <Input
                type="time"
                value={f.time}
                onChange={(e) => setF({ ...f, time: e.target.value })}
              />
            </label>
          </div>
          <Textarea
            placeholder="সংশোধন করলে কারণ লিখুন"
            value={f.reason}
            onChange={(e) => setF({ ...f, reason: e.target.value })}
          />
          <Button disabled={busy} onClick={save}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}যাচাই করে সংরক্ষণ
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
