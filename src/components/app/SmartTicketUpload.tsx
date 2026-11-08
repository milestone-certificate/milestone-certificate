import { useEffect, useRef, useState } from "react";
import {
  FileUp,
  Loader2,
  ScanLine,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";
import { createClientOnlyFn } from "@tanstack/react-start";
const readTicket = createClientOnlyFn(
  async (file: File, signal: AbortSignal, progress: (message: string) => void) => {
    const { readAppointment } = await import("@/lib/ticket-reader.client");
    return readAppointment(file, signal, progress);
  },
);
import { type TicketExtraction, MAX_TICKET_BYTES } from "@/lib/ticket-extraction";

export type Stage = "idle" | "uploaded" | "processing" | "done" | "review" | "failed";
const STAGE: Record<Stage, string> = {
  idle: "",
  uploaded: "PDF আপলোড হয়েছে",
  processing: "প্রসেসিং চলছে...",
  done: "ডাটা এক্সট্র্যাকশন সম্পন্ন",
  review: "রিভিউ প্রয়োজন",
  failed: "প্রসেসিং ব্যর্থ — ম্যানুয়ালি পূরণ করুন",
};

export type FieldCheck = {
  label: string;
  extracted: string | null;
  current: string;
  confidence: number;
};
export const fieldStatus = (c: FieldCheck) =>
  !c.extracted
    ? "review"
    : c.current && c.current.toUpperCase() !== c.extracted.toUpperCase()
      ? "mismatch"
      : c.confidence >= 0.9
        ? "verified"
        : "review";

export function SmartTicketUpload({
  file,
  onFile,
  onExtract,
  checks,
  warnings,
  stage,
  setStage,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  onExtract: (x: TicketExtraction) => void;
  checks: FieldCheck[];
  warnings: string[];
  stage: Stage;
  setStage: (s: Stage) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const current = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!file) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  useEffect(() => () => current.current?.abort(), []);
  async function pick(f: File | undefined) {
    if (!f) return;
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    setMessage("");
    if (!f.size || f.size > MAX_TICKET_BYTES) {
      onFile(null);
      setMessage("৮ MB-এর মধ্যে PDF বা ছবি দিন।");
      setStage("failed");
      return;
    }
    onFile(f);
    setStage("processing");
    const timeout = window.setTimeout(() => {
      controller.abort();
      if (current.current === controller) {
        setMessage("সময় বেশি লাগছে। তথ্য নিজে পূরণ করুন অথবা আবার চেষ্টা করুন।");
        setStage("failed");
      }
    }, 90_000);
    try {
      const result = await readTicket(f, controller.signal, (message) => {
        if (!controller.signal.aborted && current.current === controller) setMessage(message);
      });
      if (controller.signal.aborted || !result) return;
      if (result.file.type !== f.type) onFile(result.file);
      onExtract(result.extraction);
      setMessage("");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (
        error instanceof Error &&
        (error.message.startsWith("সঠিক PDF") || error.name === "InvalidPDFException")
      )
        onFile(null);
      setMessage(
        error instanceof Error && /^(৮ MB|সঠিক PDF|একজন পরীক্ষার্থীর)/.test(error.message)
          ? error.message
          : "টিকিট স্বয়ংক্রিয়ভাবে পড়া যায়নি। নিচের তথ্য নিজে পূরণ করুন অথবা অন্য ফাইল দিন।",
      );
      setStage("failed");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  const overall = checks.length
    ? Math.round(
        (checks.reduce((s, c) => s + (c.extracted ? c.confidence : 0), 0) / checks.length) * 100,
      )
    : 0;
  const sts = checks.map(fieldStatus);
  const match = sts.includes("mismatch")
    ? "mismatch"
    : sts.includes("review") || warnings.length
      ? "review"
      : "verified";
  const color = {
    verified: "text-primary",
    review: "text-yellow-500",
    mismatch: "text-destructive",
  } as const;
  const label = {
    verified: "মিলেছে",
    review: "যাচাই করুন",
    mismatch: "অমিল আছে",
  } as const;
  const Icon = { verified: CheckCircle2, review: AlertTriangle, mismatch: XCircle } as const;
  const M = Icon[match];

  return (
    <section className="space-y-3 rounded-2xl border border-primary/40 bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <ScanLine className="h-5 w-5 text-primary" />
        <h2 className="font-display text-lg font-bold">Smart Appointment PDF Upload</h2>
      </div>
      <p className="text-sm text-muted-foreground">
        টিকিট দিন। পাওয়া তথ্য ফর্মে বসবে—জমা দেওয়ার আগে মিলিয়ে নিন।
      </p>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-primary/60 p-4 text-sm font-semibold hover:bg-muted">
        {stage === "processing" ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : (
          <FileUp className="h-5 w-5 text-primary" />
        )}
        <span className="truncate">
          {file ? file.name : "PDF বা ছবি নির্বাচন করুন (সর্বোচ্চ ৮ MB)"}
        </span>
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          aria-label="Appointment PDF বা ছবি"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {stage !== "idle" && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className={stage === "failed" ? "text-destructive" : "text-primary"}>
            ● {stage === "processing" && message ? message : STAGE[stage]}
          </span>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary underline"
            >
              <ExternalLink className="h-4 w-4" />
              মূল PDF দেখুন
            </a>
          )}
        </div>
      )}
      {stage === "failed" && message && (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}
      {(stage === "done" || stage === "review") && checks.length > 0 && (
        <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm">
          <div className="flex flex-wrap justify-between gap-2 font-semibold">
            <span>তথ্য পড়ার নিশ্চয়তা: {overall}%</span>
            <span className={`inline-flex items-center gap-1 ${color[match]}`}>
              <M className="h-4 w-4" />
              তথ্য মিল: {label[match]}
            </span>
          </div>
          <ul className="grid gap-1 sm:grid-cols-2">
            {checks.map((c, i) => {
              const s = sts[i]!;
              const I = Icon[s === "mismatch" ? "mismatch" : s];
              return (
                <li key={c.label} className={`flex items-center gap-1 ${color[s]}`}>
                  <I className="h-4 w-4 shrink-0" />
                  {c.label}: {c.extracted ? `${Math.round(c.confidence * 100)}%` : "পাওয়া যায়নি"}
                  {s === "mismatch" && ` (টিকিটে ${c.extracted})`}
                </li>
              );
            })}
          </ul>
          {warnings.length > 0 && (
            <ul className="space-y-1 text-yellow-500">
              {warnings.map((w, i) => (
                <li key={i}>⚠️ {w}</li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            স্কোর শুধু পড়ার নিশ্চয়তা বোঝায় — সঠিকতা নিশ্চিত করতে মূল PDF মিলিয়ে দেখুন।
          </p>
        </div>
      )}
    </section>
  );
}
