import { ListLoadStatus } from "@/components/app/ui-bits";
import { DateSelect } from "@/components/app/DateSelect";
import { ReceiveToggle, ReceiveBanner } from "@/components/app/ReceiveStatus";
import { ResultCheckButton } from "@/components/app/ResultCheckButton";
import { ResultShareActions, workShareInfo } from "@/components/app/ResultListShare";
import { EditMobileDialog } from "@/components/app/EditMobileDialog";
import { EditWorkDialog } from "@/components/app/EditWorkDialog";
import { CandidatePhoto } from "@/components/app/CandidatePhoto";
import { AgentPhoto } from "@/components/app/AgentPhoto";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Copy, FileText } from "lucide-react";
import { toast } from "sonner";
import { worksQ, openTicket, fmtDhakaDateTime } from "@/lib/works";
import { ttcQ, occQ, lookup, bn, fmtDhakaDate } from "@/lib/data";
import { StatusPill, SvpPill } from "@/components/app/WorkBits";
import { Button } from "@/components/ui/button";
import { WorkNotes } from "@/components/app/WorkNotes";
import { UnpaidNotice, useMyUnpaid } from "@/components/app/AgentNotice";
import { SvpBookingHistory } from "@/components/app/SvpBookingHistory";

type Tab =
  "active" | "today" | "tomorrow" | "day_after" | "done" | "rejected" | "archive" | "all" | "svp";

export const Route = createFileRoute("/_authenticated/my-works")({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({
    tab: (s.tab as Tab) || undefined,
  }),
  head: () => ({
    meta: [
      { title: "আমার জমা দেওয়া কাজ — এজেন্ট | Milestone Certificate Institute" },
      { name: "description", content: "এজেন্টের জমা দেওয়া কাজ, অনুমোদন অবস্থা ও SVP রেজাল্ট।" },
      {
        property: "og:title",
        content: "আমার জমা দেওয়া কাজ — এজেন্ট | Milestone Certificate Institute",
      },
      {
        property: "og:description",
        content: "এজেন্টের জমা দেওয়া কাজ, অনুমোদন অবস্থা ও SVP রেজাল্ট।",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MyWorks,
});

const TABS: [Tab, string][] = [
  ["svp", "SVP বুকিং"],
  ["all", "সব কাজ"],
  ["active", "চলমান কাজ"],
  ["today", "আজকে"],
  ["tomorrow", "আগামীকাল"],
  ["day_after", "পরশু"],
  ["done", "সম্পন্ন"],
  ["archive", "আর্কাইভ (১ মাস+)"],
  ["rejected", "বাতিল"],
];

const dhakaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
const dayOffset = (n: number) => dhakaDay(new Date(Date.now() + n * 86400000));

function MyWorks() {
  const unpaid = useMyUnpaid();
  const search = Route.useSearch();
  const [tab, setTab] = useState<Tab>(search.tab ?? "all");
  const listQuery = useQuery(worksQ);
  const { data: allWorks = [] } = listQuery;
  const { user } = Route.useRouteContext();
  // Only this ID's own submissions, even for accounts that also have reception/admin access.
  const works = allWorks.filter((w) => w.submitted_by === user.id);
  const ttc = lookup(useQuery(ttcQ).data);
  const occ = lookup(useQuery(occQ).data);
  const isDone = (w: (typeof works)[number]) =>
    w.status === "approved" && (w.svp_result === "PASS" || w.svp_result === "FAIL");
  const isArchived = (w: (typeof works)[number]) =>
    isDone(w) && Date.now() - new Date(w.exam_at ?? w.created_at).getTime() > 30 * 86400000;
  const isActive = (w: (typeof works)[number]) => w.status !== "rejected" && !isDone(w);
  const onDay = (n: number) => (w: (typeof works)[number]) =>
    isActive(w) && !!w.exam_at && dhakaDay(new Date(w.exam_at)) === dayOffset(n);
  const filterFor = (k: Tab) => {
    switch (k) {
      case "active":
        return works.filter(isActive);
      case "today":
        return works.filter(onDay(0));
      case "tomorrow":
        return works.filter(onDay(1));
      case "day_after":
        return works.filter(onDay(2));
      case "done":
        return works.filter((w) => isDone(w) && !isArchived(w));
      case "archive":
        return works.filter(isArchived);
      case "rejected":
        return works.filter((w) => w.status === "rejected");
      case "svp":
        return [];
      default:
        return works;
    }
  };
  const [q, setQ] = useState("");
  const [pick, setPick] = useState("");
  const s = q.trim().toLowerCase().replace(/^#/, "");
  const list = (s || pick ? works : filterFor(tab))
    .filter((w) => !pick || (!!w.exam_at && dhakaDay(new Date(w.exam_at)) === pick))
    .filter(
      (w) =>
        !s ||
        [
          w.candidate_name,
          w.passport_no,
          w.mobile,
          w.secondary_mobile,
          w.ref_code.toLowerCase(),
          occ(w.occupation_id),
        ].some((v) => v?.toLowerCase().includes(s)),
    );

  const copyText = async () => {
    const groups = new Map<string, typeof list>();
    for (const w of list) {
      const k = `${occ(w.occupation_id) ?? "—"}|${w.exam_at ? fmtDhakaDate(w.exam_at) : "—"}|${w.exam_at ? new Date(w.exam_at).toLocaleTimeString("en-US", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit", hour12: false }) : "—"}`;
      groups.set(k, [...(groups.get(k) ?? []), w]);
    }
    const text = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, ws]) => {
        const [o, d, t] = k.split("|");
        return [o, d, t, "", ...ws.flatMap((w) => [w.candidate_name, w.passport_no, ""])].join(
          "\n",
        );
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-bold">আমার জমা দেওয়া কাজ</h1>
      {unpaid && <UnpaidNotice />}
      {tab !== "svp" && (
        <>
          <div className="flex gap-2">
            <input
              className="h-10 w-full rounded-lg border bg-card px-3 text-sm"
              placeholder="নাম / পাসপোর্ট / মোবাইল / পেশা / রেফারেন্স দিয়ে খুঁজুন"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <Button variant="secondary" size="sm" className="h-10 shrink-0" onClick={copyText}>
              <Copy className="mr-1 h-4 w-4" /> টেক্সট কপি
            </Button>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="shrink-0 text-muted-foreground">নির্দিষ্ট তারিখ:</span>
            <DateSelect
              autoToday={false}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-9 rounded-lg border bg-card px-2"
            />
            {pick && (
              <Button variant="ghost" size="sm" onClick={() => setPick("")}>
                মুছুন
              </Button>
            )}
          </div>
        </>
      )}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${tab === k ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted"}`}
          >
            {k === "svp" ? l : `${l} (${bn(filterFor(k).length)})`}
          </button>
        ))}
      </div>
      {tab === "svp" ? (
        <SvpBookingHistory />
      ) : listQuery.isLoading || listQuery.isLoadingError ? (
        <ListLoadStatus query={listQuery} />
      ) : list.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          কোনো কাজ নেই।
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((w) => (
            <li
              key={w.id}
              className={`rounded-2xl border border-l-4 bg-card p-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 ${w.svp_result === "PASS" ? "border-l-emerald-500 shadow-[0_0_14px_-4px_rgb(16_185_129/0.6)] hover:shadow-[0_0_22px_-4px_rgb(16_185_129/0.8)]" : "border-l-amber-400 shadow-[0_0_14px_-4px_rgb(251_191_36/0.55)] hover:shadow-[0_0_22px_-4px_rgb(251_191_36/0.8)]"}`}
            >
              <ReceiveBanner w={w} />
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
              <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                <span>পাসপোর্ট: {w.passport_no}</span>
                <span>পেশা: {w.occupation_id ? occ(w.occupation_id) : "—"}</span>
                <span>TTC: {w.ttc_id ? ttc(w.ttc_id) : "—"}</span>
                <span>পরীক্ষা: {fmtDhakaDateTime(w.exam_at)}</span>
                <span>
                  রিসেপশন:{" "}
                  {w.arrival_status === "received"
                    ? "রিসিভ করা হয়েছে"
                    : w.arrival_status === "absent"
                      ? "অনুপস্থিত"
                      : "এখনো আসেননি"}
                </span>
                <div className="flex flex-wrap gap-2 sm:col-span-2">
                  <ResultCheckButton w={w} />
                  <ReceiveToggle w={w} />
                  {(() => {
                    const d = workShareInfo(w, occ, ttc);
                    return d ? <ResultShareActions d={d} /> : null;
                  })()}
                </div>
                {w.svp_checked_at && <span>রেজাল্ট চেক: {fmtDhakaDateTime(w.svp_checked_at)}</span>}
              </div>
              {w.skill_details && (
                <p className="mt-2 rounded-lg bg-muted p-2 text-sm">দক্ষতা: {w.skill_details}</p>
              )}
              {w.status === "rejected" && w.rejection_reason && (
                <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-sm text-destructive">
                  বাতিলের কারণ: {w.rejection_reason}
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => openTicket(w.ticket_path)}
              >
                <FileText className="mr-1 h-4 w-4" /> Takamul Ticket
              </Button>
              {w.status === "pending_approval" || w.status === "pending_agent" ? (
                <EditWorkDialog w={w} />
              ) : (
                w.status === "approved" && (
                  <p className="mt-2 text-xs text-muted-foreground">অনুমোদিত — এডিট বন্ধ</p>
                )
              )}
              <EditMobileDialog w={w} />
              <div className="mt-3">
                <AgentPhoto id={w.submitted_by} />
              </div>
              <WorkNotes submissionId={w.id} canAdd />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
