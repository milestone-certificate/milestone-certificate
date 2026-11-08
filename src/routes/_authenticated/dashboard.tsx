import { DateSelect } from "@/components/app/DateSelect";
import { ReceiveAnalyticsButton } from "@/components/app/ReceiveStatus";
import { CandidatePhoto } from "@/components/app/CandidatePhoto";
import { AgentDashboard } from "@/components/app/AgentDashboard";
import { AdminActivity } from "@/components/app/AdminActivity";
import { RspayDepositRecords } from "@/components/app/RspayDeposits";
import { AdminSystemOverview } from "@/components/app/AdminSystemOverview";
import { AdminRspayGateway } from "@/components/app/AdminRspayGateway";
import { AgentWhatsAppReminder } from "@/components/app/AgentWhatsAppReminder";
import { isManager } from "@/lib/roles";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Building2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Eye,
  EyeOff,
  Clock,
  MessageSquare,
  Plus,
  Search,
  Users,
  XCircle,
  UserX,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { sendTodayExamSmsNow } from "@/lib/exam-sms.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard, PageHeader, ResultBadge, Empty } from "@/components/app/ui-bits";
import { CandidateDialog, ExamDialog } from "@/components/app/forms";
import { ChartCard, SimpleBar, SimpleLine, SimplePie } from "@/components/app/Charts";
import { supabase } from "@/integrations/supabase/client";
import type { Exam, Ttc } from "@/lib/data";
import {
  candidatesQ,
  examsQ,
  occQ,
  ttcQ,
  remindersQ,
  lookup,
  bn,
  fmtDate,
  fmtTime,
  todayStr,
  addDays,
  dayLabel,
  RESULT_LABEL,
} from "@/lib/data";
import {
  RANGE_LABEL,
  rangeBounds,
  inRange,
  stats,
  groupCount,
  monthly,
  byDate,
  type RangeKey,
} from "@/lib/analytics";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "ড্যাশবোর্ড — পরীক্ষা ব্যবস্থাপনা | Milestone Certificate Institute" },
      { name: "description", content: "পরিসংখ্যান, রিমাইন্ডার ও আসন্ন পরীক্ষা।" },
      { property: "og:title", content: "ড্যাশবোর্ড | Milestone Certificate Institute" },
      { property: "og:description", content: "পরিসংখ্যান, রিমাইন্ডার ও আসন্ন পরীক্ষা।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DashboardSwitch,
});

function DashboardSwitch() {
  const { roles } = Route.useRouteContext();
  return isManager(roles) ? <Dashboard /> : <AgentDashboard />;
}

function Dashboard() {
  const { roles, user } = Route.useRouteContext();
  const { data: cands = [] } = useQuery(candidatesQ);
  const { data: exams = [] } = useQuery(examsQ);
  const { data: occ } = useQuery(occQ);
  const { data: ttc } = useQuery(ttcQ);
  const { data: reminders = [] } = useQuery(remindersQ);
  const [range, setRange] = useState<RangeKey>("all");
  const [from, setFrom] = useState(addDays(todayStr(), -30));
  const [to, setTo] = useState(todayStr());
  const [candOpen, setCandOpen] = useState(false);
  const [examOpen, setExamOpen] = useState(false);

  const occName = lookup(occ);
  const ttcName = lookup(ttc);
  const candMap = useMemo(() => new Map(cands.map((c) => [c.id, c])), [cands]);
  const filtered = useMemo(
    () => inRange(exams, rangeBounds(range, from, to)),
    [exams, range, from, to],
  );
  const s = stats(filtered, cands);
  const t = todayStr();
  const tomorrow = addDays(t, 1);
  const soon = exams
    .filter((e) => e.exam_date >= t && e.exam_date <= addDays(t, 7) && e.result === "PENDING")
    .sort((a, b) => (a.exam_date + a.exam_time).localeCompare(b.exam_date + b.exam_time));
  const pendingResults = exams.filter((e) => e.result === "PENDING" && e.exam_date < t);

  const alerts = [
    ...exams
      .filter((e) => e.exam_date === t && e.result === "PENDING")
      .map((e) => ({
        tone: "danger",
        text: `আজ পরীক্ষা: ${candMap.get(e.candidate_id)?.name}`,
        id: e.candidate_id,
      })),
    ...exams
      .filter((e) => e.exam_date === tomorrow && e.result === "PENDING")
      .map((e) => ({
        tone: "warning",
        text: `আগামীকাল পরীক্ষা: ${candMap.get(e.candidate_id)?.name}`,
        id: e.candidate_id,
      })),
    ...pendingResults.map((e) => ({
      tone: "info",
      text: `রেজাল্ট অপেক্ষমান: ${candMap.get(e.candidate_id)?.name} (${fmtDate(e.exam_date)})`,
      id: e.candidate_id,
    })),
    ...cands
      .filter((c) => c.needs_follow_up)
      .map((c) => ({ tone: "muted", text: `ফলো-আপ প্রয়োজন: ${c.name}`, id: c.id })),
    ...reminders
      .filter((r) => !r.done && r.due_date <= addDays(t, 1))
      .map((r) => ({
        tone: "warning",
        text: `${r.title} — ${candMap.get(r.candidate_id ?? "")?.name ?? ""}`,
        id: r.candidate_id ?? "",
      })),
  ];
  const toneCls: Record<string, string> = {
    danger: "bg-danger-soft text-danger",
    warning: "bg-warning-soft text-warning",
    info: "bg-info-soft text-info",
    muted: "bg-muted text-muted-foreground",
  };

  const passFail = [
    { name: RESULT_LABEL.PASS, value: s.pass },
    { name: RESULT_LABEL.FAIL, value: s.fail },
    { name: RESULT_LABEL.ABSENT, value: s.absent },
  ].filter((x) => x.value);

  return (
    <div>
      <PageHeader title="ড্যাশবোর্ড" subtitle={`আজ ${fmtDate(t)}`} />
      <div className="mb-4">
        <ReceiveAnalyticsButton />
      </div>
      {roles.includes("admin") && <AdminActivity />}
      {roles.includes("admin") && <AdminSystemOverview />}
      {roles.includes("admin") && <AdminRspayGateway userId={user.id} />}
      <RspayDepositRecords userId={user.id} compact />
      {roles.includes("admin") && <AgentWhatsAppReminder />}

      <div className="mb-5 grid grid-cols-3 gap-2 sm:grid-cols-6">
        <QuickBtn icon={<Plus />} label="নতুন পরীক্ষার্থী" onClick={() => setCandOpen(true)} />
        <QuickBtn icon={<CalendarDays />} label="নতুন পরীক্ষা" onClick={() => setExamOpen(true)} />
        <QuickBtn icon={<ClipboardList />} label="রেজাল্ট যোগ করুন" to="/results" />
        <QuickBtn icon={<Search />} label="রেজাল্ট চেক" to="/results" />
        <QuickBtn icon={<BarChart3 />} label="রিপোর্ট" to="/reports" />
        <QuickBtn icon={<CalendarClock />} label="পরীক্ষার তালিকা" to="/exams" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={range === k ? "default" : "outline"}
            onClick={() => setRange(k)}
          >
            {RANGE_LABEL[k]}
          </Button>
        ))}
        {range === "custom" && (
          <div className="flex items-center gap-2">
            <DateSelect
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-9 w-40"
            />
            <span>—</span>
            <DateSelect value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-40" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="মোট পরীক্ষার্থী"
          value={bn(s.candidates)}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          label="মোট পরীক্ষা"
          value={bn(s.exams)}
          icon={<ClipboardList className="h-5 w-5" />}
          tone="info"
        />
        <StatCard
          label="রেজাল্ট অপেক্ষমান"
          value={bn(s.pending)}
          icon={<Clock className="h-5 w-5" />}
          tone="warning"
        />
        <StatCard
          label="আসন্ন পরীক্ষা"
          value={bn(s.upcoming)}
          icon={<CalendarClock className="h-5 w-5" />}
          tone="primary"
        />
        <StatCard
          label="পাস"
          value={bn(s.pass)}
          icon={<CheckCircle2 className="h-5 w-5" />}
          tone="success"
        />
        <StatCard
          label="ফেল"
          value={bn(s.fail)}
          icon={<XCircle className="h-5 w-5" />}
          tone="danger"
        />
        <StatCard
          label="অনুপস্থিত"
          value={bn(s.absent)}
          icon={<UserX className="h-5 w-5" />}
          tone="muted"
        />
        <StatCard
          label="পাসের হার"
          value={`${bn(s.pass + s.fail ? Math.round((s.pass / (s.pass + s.fail)) * 100) : 0)}%`}
          icon={<BarChart3 className="h-5 w-5" />}
          tone="success"
        />
      </div>

      <BoguraSummary exams={exams} ttc={ttc ?? []} occName={occName} cands={candMap} />

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <BoguraToday
          exams={exams}
          ttc={ttc ?? []}
          occName={occName}
          candName={(id) => candMap.get(id)?.name ?? "—"}
          candPhoto={(id) => candMap.get(id)?.photo_url ?? null}
        />
        <div className="card-surface p-4">
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <CalendarClock className="h-4 w-4 text-primary" /> আগামী ৭ দিনের পরীক্ষা
          </h3>
          {soon.length === 0 ? (
            <Empty>কোনো আসন্ন পরীক্ষা নেই</Empty>
          ) : (
            <ul className="max-h-72 divide-y overflow-y-auto">
              {soon.map((e) => {
                const dl = dayLabel(e.exam_date);
                return (
                  <li key={e.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <Link
                        to="/candidates/$id"
                        params={{ id: e.candidate_id }}
                        className="font-medium hover:text-primary"
                      >
                        {candMap.get(e.candidate_id)?.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {occName(e.occupation_id)} · {ttcName(e.ttc_id)}
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      {dl ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-danger">
                          <span className="pulse-dot h-2 w-2 rounded-full bg-danger" />
                          {dl}
                        </span>
                      ) : (
                        fmtDate(e.exam_date)
                      )}
                      <div className="text-xs text-muted-foreground">{fmtTime(e.exam_time)}</div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ChartCard title="তারিখ অনুযায়ী পরীক্ষা">
          <SimpleBar data={byDate(filtered).map((d) => ({ ...d, name: fmtDate(d.name) }))} />
        </ChartCard>
        <ChartCard title="পাস বনাম ফেল">
          {passFail.length ? <SimplePie data={passFail} /> : <Empty>তথ্য নেই</Empty>}
        </ChartCard>
        <ChartCard title="পেশা অনুযায়ী পরীক্ষা">
          <SimpleBar
            data={groupCount(filtered, (e) => occName(e.occupation_id))}
            color="var(--chart-4)"
          />
        </ChartCard>
        <ChartCard title="টিটিসি অনুযায়ী পরীক্ষা">
          <SimpleBar data={groupCount(filtered, (e) => ttcName(e.ttc_id))} color="var(--chart-3)" />
        </ChartCard>
        <ChartCard title="মাসিক পরীক্ষা সংখ্যা">
          <SimpleLine data={monthly(filtered)} dataKey="count" />
        </ChartCard>
        <ChartCard title="মাসিক পাসের হার (%)">
          <SimpleLine data={monthly(filtered)} dataKey="rate" unit="%" />
        </ChartCard>
      </div>

      {pendingResults.length > 0 && (
        <div className="card-surface mt-5 p-4">
          <h3 className="mb-2 text-base font-semibold">রেজাল্টের অপেক্ষায়</h3>
          <div className="flex flex-wrap gap-2">
            {pendingResults.map((e) => (
              <Link
                key={e.id}
                to="/candidates/$id"
                params={{ id: e.candidate_id }}
                className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm hover:bg-muted"
              >
                {candMap.get(e.candidate_id)?.name}{" "}
                <ResultBadge result={e.result} date={e.result_date} />
              </Link>
            ))}
          </div>
        </div>
      )}

      <CandidateDialog open={candOpen} onOpenChange={setCandOpen} />
      <ExamDialog open={examOpen} onOpenChange={setExamOpen} />
    </div>
  );
}

function QuickBtn({
  icon,
  label,
  onClick,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  to?: "/results" | "/reports" | "/exams";
}) {
  const cls =
    "card-surface flex flex-col items-center justify-center gap-1.5 p-3 text-center text-xs font-medium transition-colors hover:bg-primary-soft hover:text-primary [&_svg]:h-5 [&_svg]:w-5 [&_svg]:text-primary";
  return to ? (
    <Link to={to} className={cls}>
      {icon}
      {label}
    </Link>
  ) : (
    <button onClick={onClick} className={cls}>
      {icon}
      {label}
    </button>
  );
}

function SmsButton() {
  const send = useServerFn(sendTodayExamSmsNow);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        if (
          !confirm(
            "আজকের বগুড়া পরীক্ষার্থী ও এজেন্টদের SMS পাঠাবেন? (আগে পাঠানো হলে আবার যাবে না)",
          )
        )
          return;
        setBusy(true);
        try {
          const r = await send();
          toast.success(
            `SMS পাঠানো হয়েছে — পরীক্ষার্থী ${bn(r.candidates)}, এজেন্ট ${bn(r.agents)}${r.failed ? `, ব্যর্থ ${bn(r.failed)}` : ""}`,
          );
        } catch {
          toast.error("SMS পাঠানো যায়নি");
        } finally {
          setBusy(false);
        }
      }}
    >
      <MessageSquare className="h-4 w-4" />
      {busy ? "পাঠানো হচ্ছে…" : "SMS পাঠান"}
    </Button>
  );
}

function useAgentOf() {
  const { data: subs = [] } = useQuery({
    queryKey: ["dash-sub-agents-v2"],
    queryFn: async () =>
      (
        await supabase
          .from("job_submissions")
          .select("id,submitted_by,passport_no,mobile,secondary_mobile,ref_code")
      ).data ?? [],
  });
  const { data: agents = [] } = useQuery({
    queryKey: ["dash-agents"],
    queryFn: async () =>
      (await supabase.from("agent_accounts").select("user_id,full_name,agent_code")).data ?? [],
  });
  return { subs, agents };
}

const B_RANGES = {
  today: "আজ",
  tomorrow: "কাল",
  dayafter: "পরশু",
  week: "এই সপ্তাহ",
  month: "এই মাস",
  all: "সব আসন্ন",
} as const;
type BRange = keyof typeof B_RANGES;
function bRange(r: BRange, t: string): [string, string] {
  if (r === "today") return [t, t];
  if (r === "tomorrow") return [addDays(t, 1), addDays(t, 1)];
  if (r === "dayafter") return [addDays(t, 2), addDays(t, 2)];
  if (r === "week") return [t, addDays(t, 6)];
  if (r === "month") return [t, `${t.slice(0, 7)}-31`];
  return [t, "9999-12-31"];
}

function BoguraToday({
  exams,
  ttc,
  occName,
  candName,
  candPhoto,
}: {
  exams: Exam[];
  ttc: Ttc[];
  occName: (id: string | null | undefined) => string;
  candName: (id: string) => string;
  candPhoto: (id: string) => string | null;
}) {
  const { subs, agents } = useAgentOf();
  const bogura = ttc.find((x) => x.name.includes("বগুড়া") || /bogura/i.test(x.name));
  const [pick, setPick] = useState("");
  const t = pick || todayStr();
  const subAgent = new Map(subs.map((s) => [s.id, s.submitted_by]));
  const agentName = new Map(
    agents.map((a) => [a.user_id, `${a.full_name}${a.agent_code ? ` (${a.agent_code})` : ""}`]),
  );
  const list = exams
    .filter((e) => bogura && e.ttc_id === bogura.id && e.exam_date === t)
    .sort((a, b) => (a.exam_time ?? "").localeCompare(b.exam_time ?? ""));
  return (
    <div className="card-surface p-4">
      <h3 className="mb-3 flex flex-wrap items-center justify-between gap-2 text-base font-semibold">
        <span className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" />{" "}
          {pick ? `${fmtDate(pick)} — বগুড়া` : "আজকের রিমাইন্ডার — বগুড়া"}
        </span>
        <span className="flex items-center gap-2">
          <DateSelect
            autoToday={false}
            aria-label="নির্দিষ্ট তারিখ"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="h-8 rounded-md border bg-background px-2 text-sm font-normal"
          />
          {!pick && <SmsButton />}
          <span className="rounded-full bg-danger-soft px-3 py-0.5 text-sm text-danger">
            {bn(list.length)} জন
          </span>
        </span>
      </h3>
      {list.length === 0 ? (
        <Empty>{pick ? "এই তারিখে" : "আজ"} বগুড়া সেন্টারে কোনো পরীক্ষা নেই</Empty>
      ) : (
        <ul className="max-h-72 divide-y overflow-y-auto">
          {list.map((e) => {
            const sub = subs.find((s) => s.id === e.submission_id);
            return (
              <li key={e.id} className="flex items-start justify-between gap-2 py-2.5">
                <div className="flex min-w-0 items-start gap-2">
                  <CandidatePhoto
                    path={candPhoto(e.candidate_id)}
                    name={candName(e.candidate_id)}
                    size={40}
                  />
                  <div className="min-w-0 select-text">
                    <Link
                      to="/candidates/$id"
                      params={{ id: e.candidate_id }}
                      className="font-semibold uppercase hover:text-primary"
                    >
                      {candName(e.candidate_id)}
                    </Link>
                    {sub?.ref_code && (
                      <span className="ml-1 text-xs text-muted-foreground">#{sub.ref_code}</span>
                    )}
                    <div className="text-xs">
                      পাসপোর্ট: <span className="font-medium">{sub?.passport_no ?? "—"}</span>
                    </div>
                    <div className="text-xs">
                      মোবাইল: <span className="font-medium">{sub?.mobile ?? "—"}</span>
                      {sub?.secondary_mobile ? `, ${sub.secondary_mobile}` : ""}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {occName(e.occupation_id)} ·{" "}
                      {agentName.get(subAgent.get(e.submission_id ?? "") ?? "") ?? "সরাসরি এন্ট্রি"}
                    </div>
                  </div>
                </div>
                <span className="flex shrink-0 flex-col items-end gap-1 text-sm font-medium">
                  {fmtTime(e.exam_time)}
                  <ResultBadge result={e.result} date={e.result_date} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BoguraSummary({
  exams,
  ttc,
  occName,
  cands,
}: {
  exams: Exam[];
  ttc: Ttc[];
  occName: (id: string | null | undefined) => string;
  cands: Map<string, { name: string; passport_no: string | null }>;
}) {
  const { subs, agents } = useAgentOf();
  const [open, setOpen] = useState<string | null>(null);
  const [pick, setPick] = useState(todayStr());
  const bogura = ttc.find((t) => t.name.includes("বগুড়া") || /bogura/i.test(t.name));
  const { list, byOcc, byAgency } = useMemo(() => {
    const subMap = new Map(subs.map((s) => [s.id, s]));
    const agentName = new Map(
      agents.map((a) => [a.user_id, `${a.full_name}${a.agent_code ? ` (${a.agent_code})` : ""}`]),
    );
    const list = exams
      .filter((e) => bogura && e.ttc_id === bogura.id && e.exam_date === pick)
      .map((e) => {
        const sub = subMap.get(e.submission_id ?? "");
        const c = cands.get(e.candidate_id);
        return {
          e,
          name: c?.name ?? "—",
          passport: (sub?.passport_no ?? c?.passport_no ?? "—").toUpperCase(),
          occ: occName(e.occupation_id),
          agency: agentName.get(sub?.submitted_by ?? "") ?? "সরাসরি এন্ট্রি",
        };
      });
    const group = (k: "occ" | "agency") => {
      const m = new Map<string, typeof list>();
      for (const r of list) m.set(r[k], [...(m.get(r[k]) ?? []), r]);
      return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
    };
    return { list, byOcc: group("occ"), byAgency: group("agency") };
  }, [exams, bogura, subs, agents, pick, cands, occName]);

  const Section = ({
    title,
    rows,
    prefix,
  }: {
    title: string;
    rows: [string, typeof list][];
    prefix: string;
  }) => (
    <div className="mt-3">
      <h4 className="mb-2 text-sm font-semibold text-muted-foreground">{title}</h4>
      <ul className="space-y-2">
        {rows.map(([k, items]) => {
          const id = prefix + k;
          const pass = items.filter((r) => r.e.result === "PASS").length;
          const fail = items.filter((r) => r.e.result === "FAIL").length;
          return (
            <li key={id} className="rounded-lg border bg-muted/40">
              <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 font-medium">{k}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs">
                  <span className="rounded-full bg-success-soft px-2 py-0.5 font-semibold text-success">
                    PASS {bn(pass)}
                  </span>
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 font-semibold text-danger">
                    FAIL {bn(fail)}
                  </span>
                  <span className="rounded-full bg-primary px-2.5 py-0.5 font-bold text-primary-foreground">
                    {bn(items.length)}
                  </span>
                  <button
                    type="button"
                    aria-label="পরীক্ষার্থী দেখুন"
                    onClick={() => setOpen(open === id ? null : id)}
                    className="rounded-md p-1 hover:bg-primary/15 hover:text-primary"
                  >
                    {open === id ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </div>
              {open === id && (
                <ul className="divide-y border-t px-3 py-1 text-sm">
                  {items.map((r) => (
                    <li key={r.e.id} className="flex items-center justify-between gap-2 py-1.5">
                      <div className="min-w-0 select-text">
                        <Link
                          to="/candidates/$id"
                          params={{ id: r.e.candidate_id }}
                          className="font-semibold uppercase hover:text-primary"
                        >
                          {r.name}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          পাসপোর্ট:{" "}
                          <span className="font-medium text-foreground">{r.passport}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          পেশা: <span className="font-medium text-foreground">{r.occ}</span>
                        </div>
                      </div>
                      <ResultBadge result={r.e.result} date={r.e.result_date} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div className="card-surface mt-5 p-4">
      <h3 className="mb-1 flex flex-wrap items-center justify-between gap-2 text-base font-semibold">
        <span className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" /> বগুড়া সেন্টার — তারিখভিত্তিক পরীক্ষার
          রিপোর্ট
        </span>
        <span className="flex items-center gap-2">
          <DateSelect
            aria-label="তারিখ নির্বাচন"
            value={pick}
            onChange={(e) => setPick(e.target.value || todayStr())}
            className="h-8 rounded-md border bg-background px-2 text-sm"
          />
          <span className="rounded-full bg-primary/15 px-3 py-0.5 text-sm text-primary">
            মোট {bn(list.length)}
          </span>
        </span>
      </h3>
      {list.length === 0 ? (
        <Empty>{fmtDate(pick)} তারিখে বগুড়া সেন্টারে কোনো পরীক্ষা নেই</Empty>
      ) : (
        <div className="max-h-[32rem] overflow-y-auto">
          <Section title="পেশাভিত্তিক রিপোর্ট" rows={byOcc} prefix="o:" />
          <Section title="এজেন্সিভিত্তিক রিপোর্ট" rows={byAgency} prefix="a:" />
        </div>
      )}
    </div>
  );
}
