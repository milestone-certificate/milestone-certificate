import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, ResultBadge, Empty, Field } from "@/components/app/ui-bits";
import { ResultDialog } from "@/components/app/forms";
import {
  candidatesQ,
  examsQ,
  occQ,
  ttcQ,
  lookup,
  fmtDate,
  todayStr,
  RESULT_LABEL,
  useRefreshAll,
  type Exam,
} from "@/lib/data";
import { useServerFn } from "@tanstack/react-start";
import {
  getSvpResultAutomationStatus,
  checkSvpResult,
  checkSvpExamResult,
  listSvpOccupations,
} from "@/lib/svp.functions";
import { matchingPendingSvpExams } from "@/lib/svp-result.shared";
import type { SvpCheck } from "@/lib/svp.functions";
import { ResultShareActions } from "@/components/app/ResultListShare";

export const Route = createFileRoute("/_authenticated/results")({
  head: () => ({
    meta: [
      { title: "রেজাল্ট ব্যবস্থাপনা | Milestone Certificate Institute" },
      { name: "description", content: "রেজাল্ট চেক ও আপডেট করুন।" },
      { property: "og:title", content: "রেজাল্ট ব্যবস্থাপনা | Milestone Certificate Institute" },
      { property: "og:description", content: "রেজাল্ট চেক ও আপডেট করুন।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResultsPage,
});

function ResultsPage() {
  const { data: cands = [] } = useQuery(candidatesQ);
  const { data: exams = [] } = useQuery(examsQ);
  const { data: occ } = useQuery(occQ);
  const { data: ttc } = useQuery(ttcQ);
  const refresh = useRefreshAll();
  const { data: automation } = useQuery({
    queryKey: ["svp-result-automation"],
    queryFn: () => getSvpResultAutomationStatus(),
    refetchInterval: 60000,
  });
  const occName = lookup(occ);
  const ttcName = lookup(ttc);
  const candMap = useMemo(() => new Map(cands.map((c) => [c.id, c])), [cands]);
  const listOcc = useServerFn(listSvpOccupations);
  const checkFn = useServerFn(checkSvpResult);
  const checkExamFn = useServerFn(checkSvpExamResult);
  const { data: svpOcc = [] } = useQuery({
    queryKey: ["svp-occupations"],
    queryFn: () => listOcc(),
    staleTime: 86400000,
  });
  const [pp, setPp] = useState("");
  const [occKey, setOccKey] = useState("");
  const [occFilter, setOccFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [found, setFound] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resExam, setResExam] = useState<Exam | null>(null);

  const t = todayStr();
  const pending = exams
    .filter((e) => e.result === "PENDING" && e.exam_date <= t)
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date));
  const match = cands.find((c) => pp && c.passport_no?.toUpperCase() === pp.trim().toUpperCase());
  const matchingPending = match ? matchingPendingSvpExams(exams, match, occ ?? [], occKey) : [];
  const matchExam = [...matchingPending].sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0];
  const autoKey = (occId: string | null | undefined) =>
    occ?.find((o) => o.id === occId)?.svp_key ?? "";
  const filteredOcc = occFilter
    ? svpOcc.filter((o) =>
        (o.name + o.key + o.arabic).toLowerCase().includes(occFilter.toLowerCase()),
      )
    : svpOcc;

  const runCheck = async (passport: string, key: string, exam?: Exam) => {
    if (!passport.trim()) return toast.error("পাসপোর্ট নম্বর দিন");
    if (!key) return toast.error("পেশা (Occupation) নির্বাচন করুন");
    setBusy(true);
    setMsg(null);
    setFound(null);
    const show = (res: SvpCheck) => {
      if (res.status !== "found") {
        setMsg(res.message);
        return;
      }
      setFound(
        `SVP রেজাল্ট: ${RESULT_LABEL[res.result]}${res.applicantName ? ` · ${res.applicantName}` : ""}${res.examDate ? ` · ${fmtDate(res.examDate)}` : ""}`,
      );
    };
    try {
      if (exam) {
        const checked = await checkExamFn({ data: { examId: exam.id } });
        show(checked.result);
        if (checked.saved) {
          toast.success(checked.message);
          refresh();
        } else if (checked.result.status === "found") toast.info(checked.message);
        return;
      }
      const res = await checkFn({ data: { passport: passport.trim(), occupationKey: key } });
      show(res);
      if (res.status !== "found") return;
      if (res.result === "PENDING") return toast.info("SVP-তে রেজাল্ট এখনো অপেক্ষমান");
      if (!res.examDate) return toast.info("SVP পরীক্ষার তারিখ দেয়নি। সেভ করার আগে যাচাই করুন।");
      const candidate = cands.find(
        (c) => c.passport_no?.toUpperCase() === passport.trim().toUpperCase(),
      );
      const targets = candidate
        ? matchingPendingSvpExams(exams, candidate, occ ?? [], key, res.examDate)
        : [];
      if (targets.length !== 1)
        return toast.info(
          targets.length > 1
            ? "একই তারিখে একাধিক পরীক্ষা আছে। তালিকা থেকে নির্দিষ্ট পরীক্ষাটি চেক করুন।"
            : "এই পেশা ও তারিখের অপেক্ষমান পরীক্ষা নেই। রেজাল্ট সেভ করা হয়নি।",
        );
      const checked = await checkExamFn({ data: { examId: targets[0].id } });
      show(checked.result);
      if (checked.saved) {
        toast.success(checked.message);
        refresh();
      } else toast.info(checked.message);
    } catch {
      setMsg("SVP রেজাল্ট চেক করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  };

  const quickSet = async (e: Exam, result: "PASS" | "FAIL" | "ABSENT") => {
    setBusy(true);
    const { error } = await supabase
      .from("exams")
      .update({ result, result_date: todayStr(), remarks: "অ্যাডমিন ভেরিফাইড" })
      .eq("id", e.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(`${candMap.get(e.candidate_id)?.name ?? ""}: ${RESULT_LABEL[result]}`);
    refresh();
  };

  const quickCheck = (e: Exam) => {
    const c = candMap.get(e.candidate_id);
    const key = autoKey(e.occupation_id ?? c?.occupation_id);
    setPp(c?.passport_no ?? "");
    setOccKey(key);
    if (c?.passport_no && key) runCheck(c.passport_no, key, e);
    else toast.info("পাসপোর্ট/পেশা মেলেনি — বাম পাশ থেকে পেশা নির্বাচন করে চেক করুন");
  };

  return (
    <div>
      <PageHeader title="রেজাল্ট" subtitle="অটোমেটিক রেজাল্ট চেক ও ম্যানুয়াল এন্ট্রি" />
      <div className="rounded-xl border bg-card p-3 text-sm" role="status">
        <span className="font-semibold">
          অটো চেক {automation ? (automation.enabled ? "চালু" : "বন্ধ") : "·"}
        </span>
        <span className="text-muted-foreground"> · পরীক্ষা শুরুর ২ ঘণ্টা পর, প্রতি ৫ মিনিটে</span>
        {automation?.lastRunAt && (
          <p className="mt-1 text-xs text-muted-foreground">
            সর্বশেষ চালু:{" "}
            {new Date(automation.lastRunAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}
            {automation.missingInfo > 0
              ? ` · ${automation.missingInfo}টি পরীক্ষার সময় বা পরিচয় অসম্পূর্ণ`
              : ""}
          </p>
        )}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="card-surface space-y-3 p-4 lg:col-span-2">
          <h3 className="text-base font-semibold">SVP অটোমেটিক রেজাল্ট চেক</h3>
          <Field label="জাতীয়তা">
            <Input value="Bangladesh" disabled />
          </Field>
          <Field label="পাসপোর্ট নম্বর *">
            <Input
              aria-label="SVP পাসপোর্ট নম্বর"
              value={pp}
              onChange={(e) => {
                setPp(e.target.value);
                const c = cands.find(
                  (x) => x.passport_no?.toUpperCase() === e.target.value.trim().toUpperCase(),
                );
                if (c) {
                  const k = autoKey(c.occupation_id);
                  if (k) setOccKey(k);
                }
              }}
            />
          </Field>
          <Field label="পেশা (Occupation) *">
            <Input
              aria-label="SVP পেশা খুঁজুন"
              value={occFilter}
              onChange={(e) => setOccFilter(e.target.value)}
              placeholder="পেশা খুঁজুন..."
              className="mb-2"
            />
            <select
              aria-label="SVP পেশা"
              value={occKey}
              onChange={(e) => setOccKey(e.target.value)}
              className="h-10 w-full rounded-md border bg-background px-2 text-sm"
            >
              <option value="">— নির্বাচন করুন ({svpOcc.length}) —</option>
              {filteredOcc.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.name} ({o.key})
                </option>
              ))}
            </select>
          </Field>
          <Button className="w-full" onClick={() => runCheck(pp, occKey)} disabled={busy}>
            <Search className="h-4 w-4" /> {busy ? "চেক হচ্ছে..." : "SVP থেকে রেজাল্ট চেক করুন"}
          </Button>
          {found && (
            <div className="rounded-lg bg-primary/10 p-3 text-sm font-semibold text-primary">
              {found}
            </div>
          )}
          {msg && (
            <div className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="h-4 w-4" />
                {msg}
              </div>
              <p className="mt-1 text-foreground/80">নিচে থেকে ম্যানুয়ালি রেজাল্ট দিন।</p>
            </div>
          )}
          {match &&
            (() => {
              const declared = exams
                .filter(
                  (e) =>
                    e.candidate_id === match.id && (e.result === "PASS" || e.result === "FAIL"),
                )
                .sort((a, b) => b.exam_date.localeCompare(a.exam_date))[0];
              return (
                <div className="rounded-lg border p-3 text-sm">
                  <div className="font-semibold">{match.name}</div>
                  <div className="text-muted-foreground">
                    {match.passport_no} · {occName(match.occupation_id)}
                  </div>
                  {matchExam ? (
                    <div className="mt-2 flex items-center justify-between">
                      <span>পরীক্ষা: {fmtDate(matchExam.exam_date)}</span>
                      <Button size="sm" onClick={() => setResExam(matchExam)}>
                        ম্যানুয়াল রেজাল্ট দিন
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 text-muted-foreground">কোনো অপেক্ষমান পরীক্ষা নেই</div>
                  )}
                  {declared && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
                      <ResultBadge result={declared.result} date={declared.result_date} />
                      <ResultShareActions
                        d={{
                          name: match.name,
                          passport: match.passport_no ?? "—",
                          occupation: occName(declared.occupation_id ?? match.occupation_id) ?? "—",
                          ttc: ttcName(declared.ttc_id ?? match.ttc_id) ?? "—",
                          examAt: fmtDate(declared.exam_date),
                          result: declared.result,
                          ref: "—",
                        }}
                      />
                    </div>
                  )}
                </div>
              );
            })()}
        </div>

        <div className="card-surface p-4 lg:col-span-3">
          <h3 className="mb-3 text-base font-semibold">রেজাল্টের অপেক্ষায় ({pending.length})</h3>
          {pending.length === 0 ? (
            <Empty>সব রেজাল্ট আপডেট করা আছে</Empty>
          ) : (
            <ul className="divide-y">
              {pending.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <Link
                      to="/candidates/$id"
                      params={{ id: e.candidate_id }}
                      className="font-medium hover:text-primary"
                    >
                      {candMap.get(e.candidate_id)?.name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {fmtDate(e.exam_date)} · {occName(e.occupation_id)} · {ttcName(e.ttc_id)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ResultBadge result={e.result} date={e.result_date} />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => quickCheck(e)}
                    >
                      SVP চেক
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      className="bg-success text-primary-foreground hover:bg-success/90"
                      onClick={() => quickSet(e, "PASS")}
                    >
                      PASS
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => quickSet(e, "FAIL")}
                    >
                      FAIL
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => quickSet(e, "ABSENT")}
                    >
                      ABSENT
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setResExam(e)}>
                      বিস্তারিত
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <ResultDialog open={!!resExam} onOpenChange={(o) => !o && setResExam(null)} exam={resExam} />
    </div>
  );
}
