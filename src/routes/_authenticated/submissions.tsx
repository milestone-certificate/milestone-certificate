import { ListLoadStatus } from "@/components/app/ui-bits";
import { DateSelect } from "@/components/app/DateSelect";
import { PassportHistory } from "@/components/app/PassportHistory";
import { AppointmentScan } from "@/components/app/AppointmentScan";
import { ReceiveToggle } from "@/components/app/ReceiveStatus";
import { CandidatePhoto } from "@/components/app/CandidatePhoto";
import { AgentPhoto } from "@/components/app/AgentPhoto";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Eye, EyeOff, FileText, RefreshCw, X } from "lucide-react";
import { AdminEditWorkDialog } from "@/components/app/AdminEditWorkDialog";
import { worksQ, openTicket, fmtDhakaDateTime, type Work } from "@/lib/works";
import { ttcQ, occQ, lookup, bn, fmtDhakaDate } from "@/lib/data";
import { checkSubmissionSvp } from "@/lib/svp.functions";
import { listAccounts } from "@/lib/accounts.functions";
import { StatusPill, SvpPill } from "@/components/app/WorkBits";
import { ResultShareActions, workShareInfo } from "@/components/app/ResultListShare";
import { Button } from "@/components/ui/button";
import { WorkNotes } from "@/components/app/WorkNotes";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { reviewSubmission } from "@/lib/workflow.functions";

export const Route = createFileRoute("/_authenticated/submissions")({
  head: () => ({
    meta: [
      { title: "Submitted Works — অ্যাডমিন অনুমোদন | Milestone Certificate Institute" },
      { name: "description", content: "এজেন্টদের জমা দেওয়া কাজ যাচাই, অনুমোদন বা বাতিল।" },
      {
        property: "og:title",
        content: "Submitted Works — অ্যাডমিন অনুমোদন | Milestone Certificate Institute",
      },
      { property: "og:description", content: "এজেন্টদের জমা দেওয়া কাজ যাচাই, অনুমোদন বা বাতিল।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Submissions,
});

const FILTERS: [string, string][] = [
  ["pending_approval", "অপেক্ষমান"],
  ["approved_old", "📦 পুরোনো অনুমোদিত"],
  ["duplicate", "⚠️ ডুপ্লিকেট পাসপোর্ট"],
  ["pending_agent", "📁 সাব-এজেন্টের অপেক্ষমান"],
  ["approved", "অনুমোদিত"],
  ["rejected", "বাতিল"],
  ["all", "সব"],
];

function Submissions() {
  const { roles } = Route.useRouteContext();
  const canReview = roles.includes("admin") || roles.includes("staff");
  const qc = useQueryClient();
  const listQuery = useQuery(worksQ);
  const { data: works = [] } = listQuery;
  const { data: accounts = [] } = useQuery({
    queryKey: ["accounts"],
    queryFn: () => listAccounts(),
    retry: false,
  });
  const ttc = lookup(useQuery(ttcQ).data);
  const occ = lookup(useQuery(occQ).data);
  const [filter, setFilter] = useState("pending_approval");
  const [agent, setAgent] = useState("all");
  const [day, setDay] = useState("all");
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("all");
  const [q, setQ] = useState("");
  const [rejecting, setRejecting] = useState<Work | null>(null);
  const [reason, setReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const agentName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a ? `${a.name}${a.agent_code ? ` (${a.agent_code})` : ""}` : "—";
  };
  const dhakaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  const dhakaTime = (d: Date) =>
    d.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Dhaka",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  const offset = (n: number) => dhakaDay(new Date(Date.now() + n * 86400000));
  const targetDay =
    day === "today"
      ? offset(0)
      : day === "tomorrow"
        ? offset(1)
        : day === "day_after"
          ? offset(2)
          : day === "date"
            ? date
            : "";
  const base = works.filter((w) => {
    if (agent !== "all" && w.submitted_by !== agent) return false;
    if (targetDay && (!w.exam_at || dhakaDay(new Date(w.exam_at)) !== targetDay)) return false;
    if (slot !== "all" && (!w.exam_at || dhakaTime(new Date(w.exam_at)) !== slot)) return false;
    const s = q.trim().toLowerCase();
    if (
      s &&
      ![
        w.candidate_name,
        w.passport_no,
        w.mobile,
        w.secondary_mobile,
        w.ref_code.toLowerCase(),
        occ(w.occupation_id),
      ].some((v) => v?.toLowerCase().includes(s))
    )
      return false;
    return true;
  });
  const cutoff = Date.now() - 2 * 86400000;
  const isOldApproved = (w: Work) =>
    w.status === "approved" &&
    new Date(w.exam_at ?? w.reviewed_at ?? w.created_at).getTime() < cutoff;
  const searching = q.trim().length > 0;
  const passCount = new Map<string, number>();
  for (const w of works) passCount.set(w.passport_no, (passCount.get(w.passport_no) ?? 0) + 1);
  const isDup = (w: Work) => (passCount.get(w.passport_no) ?? 0) > 1;
  const list = (
    filter === "all"
      ? base
      : filter === "duplicate"
        ? base.filter(isDup)
        : filter === "approved_old"
          ? base.filter(isOldApproved)
          : filter === "approved"
            ? base.filter((w) => w.status === "approved" && (searching || !isOldApproved(w)))
            : base.filter((w) => w.status === filter)
  )
    .slice()
    .sort((a, b) => {
      if (day !== "all") return (a.exam_at ?? "").localeCompare(b.exam_at ?? "");
      const ap = a.status === "approved" ? 0 : 1,
        bp = b.status === "approved" ? 0 : 1;
      return ap - bp || b.created_at.localeCompare(a.created_at);
    });
  const agentIds = Array.from(new Set(works.map((w) => w.submitted_by)));
  const agencySummary = agentIds
    .map((id) => ({
      id,
      name: agentName(id),
      total: works.filter((w) => w.submitted_by === id).length,
      pending: works.filter((w) => w.submitted_by === id && w.status === "pending_approval").length,
    }))
    .sort((a, b) => b.pending - a.pending || b.total - a.total);
  const reset = () => {
    setAgent("all");
    setDay("all");
    setDate("");
    setSlot("all");
    setQ("");
  };
  const sel = "h-9 rounded-lg border bg-card px-2 text-sm";
  const slotLabel = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const ap = h < 12 ? "AM" : "PM";
    return `${String(((h + 11) % 12) + 1).padStart(2, "0")}:${String(m).padStart(2, "0")} ${ap} (${h < 12 ? "MORNING" : "AFTERNOON"})`;
  };
  const copyText = async () => {
    const groups = new Map<string, Work[]>();
    for (const w of list) {
      const k = `${occ(w.occupation_id) ?? "—"}|${w.exam_at ? fmtDhakaDate(w.exam_at) : "—"}|${w.exam_at ? dhakaTime(new Date(w.exam_at)) : "—"}`;
      groups.set(k, [...(groups.get(k) ?? []), w]);
    }
    const text = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, ws]) => {
        const [o, d, t] = k.split("|");
        return [
          o,
          d,
          t === "—" ? t : slotLabel(t),
          "",
          ...ws.flatMap((w) => [w.candidate_name, w.passport_no, ""]),
        ].join("\n");
      })
      .join("\n")
      .trim();
    if (!text) return toast.error("কপি করার মতো কিছু নেই");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${bn(list.length)} জনের তালিকা কপি হয়েছে`);
    } catch {
      toast.error("কপি করা যায়নি");
    }
  };

  const review = async (w: Work, status: "approved" | "rejected", why?: string) => {
    setBusyId(w.id);
    const result = await reviewSubmission({ data: { id: w.id, status, reason: why } })
      .then(() => ({ error: null }))
      .catch((error) => ({ error }));
    setBusyId(null);
    if (result.error) return toast.error("আপডেট করা যায়নি");
    toast.success(status === "approved" ? "অনুমোদন করা হয়েছে" : "বাতিল করা হয়েছে");
    qc.invalidateQueries({ queryKey: ["works"] });
  };

  const svp = async (w: Work) => {
    setBusyId(w.id);
    const r = await checkSubmissionSvp({ data: { id: w.id } }).catch(() => ({
      status: "error" as const,
      message: "চেক করা যায়নি",
    }));
    setBusyId(null);
    if (r.status === "error") toast.error(r.message);
    else
      toast.success(
        r.status === "found" ? `SVP রেজাল্ট: ${r.result}` : "SVP-তে রেজাল্ট পাওয়া যায়নি",
      );
    qc.invalidateQueries({ queryKey: ["works"] });
  };

  if (listQuery.isLoading || listQuery.isLoadingError)
    return <ListLoadStatus query={listQuery} />;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="font-display text-2xl font-bold">Submitted Works</h1>
      {agencySummary.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {agencySummary.map((a) => (
            <button
              key={a.id}
              onClick={() => setAgent(agent === a.id ? "all" : a.id)}
              className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs ${agent === a.id ? "border-primary bg-primary/15" : "bg-card hover:bg-muted"}`}
            >
              <div className="font-semibold text-sm">{a.name}</div>
              <div className="text-muted-foreground">
                মোট {bn(a.total)} · অপেক্ষমান {bn(a.pending)}
              </div>
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-2 rounded-2xl border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <input
          className={sel}
          placeholder="নাম / পাসপোর্ট / মোবাইল / রেফ"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={sel} value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="all">সকল এজেন্সি</option>
          {agencySummary.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select className={sel} value={day} onChange={(e) => setDay(e.target.value)}>
          <option value="all">সব তারিখ</option>
          <option value="today">আজকের পরীক্ষা</option>
          <option value="tomorrow">আগামীকাল</option>
          <option value="day_after">পরশু</option>
          <option value="date">নির্দিষ্ট তারিখ</option>
        </select>
        <select className={sel} value={slot} onChange={(e) => setSlot(e.target.value)}>
          <option value="all">সব ব্যাচ</option>
          <optgroup label="MORNING">
            <option value="10:00">10:00 AM</option>
            <option value="11:00">11:00 AM</option>
          </optgroup>
          <optgroup label="AFTERNOON">
            <option value="13:00">01:00 PM</option>
            <option value="14:00">02:00 PM</option>
          </optgroup>
        </select>
        {day === "date" && (
          <DateSelect className={sel} value={date} onChange={(e) => setDate(e.target.value)} />
        )}
        <Button variant="ghost" size="sm" onClick={reset}>
          সব রিসেট
        </Button>
        <Button variant="secondary" size="sm" onClick={copyText}>
          <Copy className="mr-1 h-4 w-4" /> টেক্সট কপি
        </Button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${filter === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            {l} (
            {bn(
              k === "all"
                ? base.length
                : k === "duplicate"
                  ? base.filter(isDup).length
                  : k === "approved_old"
                    ? base.filter(isOldApproved).length
                    : k === "approved"
                      ? base.filter((w) => w.status === "approved" && !isOldApproved(w)).length
                      : base.filter((w) => w.status === k).length,
            )}
            )
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          কোনো কাজ নেই।
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((w) =>
            !openIds.includes(w.id) ? (
              <li
                key={w.id}
                className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/80 px-3 py-2.5 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/50"
              >
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${isOldApproved(w) ? "border-primary/40 bg-primary-soft text-primary" : w.status === "approved" ? "border-success/40 bg-success-soft text-success" : w.status === "rejected" ? "border-danger/40 bg-danger-soft text-danger" : "border-warning/40 bg-warning-soft text-warning"}`}
                >
                  {isOldApproved(w)
                    ? "✓ Completed"
                    : w.status === "approved"
                      ? "অনুমোদিত"
                      : w.status === "rejected"
                        ? "বাতিল"
                        : "অপেক্ষমাণ"}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-bold ${w.svp_result === "PASS" ? "bg-success-soft text-success" : w.svp_result === "FAIL" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"}`}
                  >
                    {w.svp_result === "PASS" || w.svp_result === "FAIL" ? w.svp_result : "Pending"}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="rounded-full text-primary hover:bg-primary-soft"
                    aria-label="বিস্তারিত দেখুন"
                    onClick={() => setOpenIds((s) => [...s, w.id])}
                  >
                    <Eye className="h-5 w-5" />
                  </Button>
                </div>
                <div className="grid min-w-0 w-full grid-cols-1 gap-y-0.5 text-sm sm:w-auto sm:flex-1 sm:grid-cols-5 sm:gap-x-3">
                  <span className="break-words font-semibold">{w.candidate_name}</span>
                  <span className="break-words text-muted-foreground">{w.passport_no}</span>
                  <span className="break-words text-muted-foreground">
                    💼 {w.occupation_id ? occ(w.occupation_id) : "—"}
                  </span>
                  <span className="break-words text-muted-foreground">
                    👤 {agentName(w.submitted_by)}
                  </span>
                  <span className="break-words text-muted-foreground">
                    📅 {w.exam_at ? fmtDhakaDate(w.exam_at) : "—"}
                  </span>
                </div>
              </li>
            ) : (
              <li
                key={w.id}
                className={`rounded-2xl border border-l-4 bg-card p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 ${w.svp_result === "PASS" ? "border-l-emerald-500 shadow-[0_0_14px_-4px_rgb(16_185_129/0.6)] hover:shadow-[0_0_22px_-4px_rgb(16_185_129/0.8)]" : "border-l-amber-400 shadow-[0_0_14px_-4px_rgb(251_191_36/0.55)] hover:shadow-[0_0_22px_-4px_rgb(251_191_36/0.8)]"}`}
              >
                <div className="mb-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setOpenIds((s) => s.filter((x) => x !== w.id))}
                  >
                    <EyeOff className="mr-1 h-4 w-4" /> সংক্ষিপ্ত করুন
                  </Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3 font-semibold">
                    <CandidatePhoto
                      path={w.candidate_photo_path}
                      name={w.candidate_name}
                      size={44}
                      deferUntilVisible
                    />
                    <span>{w.candidate_name}</span>{" "}
                    <span className="text-sm font-normal text-muted-foreground">#{w.ref_code}</span>
                  </div>
                  <div className="flex gap-2">
                    <StatusPill status={w.status} />
                    {w.status === "approved" && <SvpPill result={w.svp_result} work={w} />}
                  </div>
                </div>
                <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-3">
                  <AgentPhoto id={w.submitted_by} name={agentName(w.submitted_by)} />
                  <span>
                    পাসপোর্ট: {w.passport_no}
                    {isDup(w) && (
                      <span className="ml-1 rounded bg-destructive/15 px-1 text-xs font-semibold text-destructive">
                        ডুপ্লিকেট
                      </span>
                    )}
                  </span>
                  <span>মোবাইল: {w.mobile}</span>
                  {w.secondary_mobile && <span>অতিরিক্ত মোবাইল: {w.secondary_mobile}</span>}
                  <span>পেশা: {occ(w.occupation_id)}</span>
                  <span>TTC: {ttc(w.ttc_id)}</span>
                  <span>পরীক্ষা: {fmtDhakaDateTime(w.exam_at)}</span>
                  <span>শিক্ষা: {w.education === "educated" ? "শিক্ষিত" : "অশিক্ষিত"}</span>
                  <span>অভিজ্ঞতা: {w.experience === "yes" ? "আছে" : "নেই"}</span>
                  <span>জমা: {fmtDhakaDateTime(w.created_at)}</span>
                  {w.reviewed_at && <span>রিভিউ: {fmtDhakaDateTime(w.reviewed_at)}</span>}
                  {w.svp_checked_at && <span>SVP চেক: {fmtDhakaDateTime(w.svp_checked_at)}</span>}
                  <span>
                    রিসেপশন:{" "}
                    {w.arrival_status === "received"
                      ? "রিসিভ করা হয়েছে"
                      : w.arrival_status === "absent"
                        ? "অনুপস্থিত"
                        : "এখনো আসেননি"}
                  </span>
                  <div className="sm:col-span-2">
                    <ReceiveToggle w={w} />
                  </div>
                </div>
                {w.skill_details && (
                  <p className="mt-2 rounded-lg bg-muted p-2 text-sm">দক্ষতা: {w.skill_details}</p>
                )}
                {w.rejection_reason && (
                  <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
                    কারণ: {w.rejection_reason}
                  </p>
                )}
                {roles.includes("admin") &&
                  w.ocr_meta &&
                  (() => {
                    const m = w.ocr_meta as {
                      overall: number;
                      fields: {
                        label: string;
                        extracted: string | null;
                        current: string;
                        confidence: number;
                        status: string;
                      }[];
                      warnings: string[];
                      confirmed_mismatch: boolean;
                    };
                    const st = m.fields.some((x) => x.status === "mismatch")
                      ? ["Mismatch Detected", "text-destructive"]
                      : m.fields.some((x) => x.status === "review") || m.warnings.length
                        ? ["Review Required", "text-yellow-500"]
                        : ["Verified", "text-primary"];
                    return (
                      <div className="mt-2 space-y-1 rounded-lg border border-primary/30 bg-muted/50 p-2 text-sm">
                        <p className="font-semibold">
                          Smart PDF: Confidence {Math.round(m.overall * 100)}% ·{" "}
                          <span className={st[1]}>{st[0]}</span>
                        </p>
                        {m.fields.map((x) => (
                          <p
                            key={x.label}
                            className={
                              x.status === "mismatch"
                                ? "text-destructive"
                                : x.status === "review"
                                  ? "text-yellow-500"
                                  : ""
                            }
                          >
                            {x.label}: {x.extracted ?? "—"} ({Math.round(x.confidence * 100)}%)
                            {x.status === "mismatch" && ` → জমা: ${x.current}`}
                          </p>
                        ))}
                        {m.warnings
                          .filter((x) => !/report|arriv|minute|early|মিনিট|উপস্থিত/i.test(x))
                          .map((x, i) => (
                            <p key={i} className="text-yellow-500">
                              ⚠️ {x}
                            </p>
                          ))}
                        {m.confirmed_mismatch && (
                          <p className="text-destructive">এজেন্ট অমিল জেনে নিশ্চিত করেছেন</p>
                        )}
                      </div>
                    );
                  })()}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openTicket(w.ticket_path)}>
                    <FileText className="mr-1 h-4 w-4" /> Ticket
                  </Button>
                  {roles.includes("admin") && (
                    <AppointmentScan
                      submissionId={w.id}
                      examAt={w.exam_at}
                      saved={{
                        name: w.candidate_name,
                        passport: w.passport_no,
                        occupation: occ(w.occupation_id) ?? "",
                      }}
                    />
                  )}
                  {(() => {
                    const d = workShareInfo(w, occ, ttc);
                    return d ? <ResultShareActions d={d} /> : null;
                  })()}
                  {roles.includes("admin") && <AdminEditWorkDialog w={w} />}
                  {canReview && w.status !== "approved" && (
                    <Button
                      size="sm"
                      disabled={busyId === w.id}
                      onClick={() => review(w, "approved")}
                    >
                      <Check className="mr-1 h-4 w-4" /> Approve
                    </Button>
                  )}
                  {canReview && w.status !== "rejected" && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busyId === w.id}
                      onClick={() => {
                        setReason("");
                        setRejecting(w);
                      }}
                    >
                      <X className="mr-1 h-4 w-4" /> Reject
                    </Button>
                  )}
                  {canReview && w.status === "approved" && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === w.id}
                      onClick={() => svp(w)}
                    >
                      <RefreshCw className="mr-1 h-4 w-4" /> SVP চেক
                    </Button>
                  )}
                </div>
                {isDup(w) && <PassportHistory passport={w.passport_no} excludeRef={w.ref_code} />}
                <WorkNotes submissionId={w.id} canAdd={false} />
              </li>
            ),
          )}
        </ul>
      )}

      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>বাতিলের কারণ</DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder="যেমন: Payment বকেয়া আছে"
          />
          <Button
            variant="destructive"
            disabled={reason.trim().length < 3}
            onClick={async () => {
              if (rejecting) await review(rejecting, "rejected", reason.trim());
              setRejecting(null);
            }}
          >
            বাতিল নিশ্চিত করুন
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
