import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ListLoadStatus, PageHeader, NativeSelect, ResultBadge, Empty } from "@/components/app/ui-bits";
import { ExamDialog, ResultDialog } from "@/components/app/forms";
import { ResultShareActions } from "@/components/app/ResultListShare";
import {
  candidatesQ,
  examsQ,
  occQ,
  ttcQ,
  lookup,
  bn,
  fmtDate,
  fmtTime,
  todayStr,
  addDays,
  dayLabel,
  RESULTS,
  RESULT_LABEL,
  type Exam,
} from "@/lib/data";

export const Route = createFileRoute("/_authenticated/exams")({
  head: () => ({
    meta: [
      { title: "পরীক্ষার তালিকা | Milestone Certificate Institute" },
      { name: "description", content: "আজ, আগামীকাল ও আসন্ন পরীক্ষা।" },
      { property: "og:title", content: "পরীক্ষার তালিকা | Milestone Certificate Institute" },
      { property: "og:description", content: "আজ, আগামীকাল ও আসন্ন পরীক্ষা।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExamsPage,
});

const TABS = {
  today: "আজ",
  tomorrow: "আগামীকাল",
  week: "আগামী ৭ দিন",
  upcoming: "সব আসন্ন",
  waiting: "রেজাল্ট অপেক্ষমান",
  all: "সব পরীক্ষা",
} as const;
type Tab = keyof typeof TABS;

function ExamsPage() {
  const listQuery = useQuery(examsQ);
  const { data: exams = [] } = listQuery;
  const { data: cands = [] } = useQuery(candidatesQ);
  const { data: occ } = useQuery(occQ);
  const { data: ttc } = useQuery(ttcQ);
  const occName = lookup(occ);
  const ttcName = lookup(ttc);
  const candMap = useMemo(() => new Map(cands.map((c) => [c.id, c])), [cands]);
  const [tab, setTab] = useState<Tab>("today");
  const [fTtc, setFTtc] = useState("");
  const [fOcc, setFOcc] = useState("");
  const [fRes, setFRes] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [resExam, setResExam] = useState<Exam | null>(null);

  const t = todayStr();
  const tm = addDays(t, 1);
  const tabFilter: Record<Tab, (e: Exam) => boolean> = {
    today: (e) => e.exam_date === t,
    tomorrow: (e) => e.exam_date === tm,
    week: (e) => e.exam_date >= t && e.exam_date <= addDays(t, 7),
    upcoming: (e) => e.exam_date >= t && e.result === "PENDING",
    waiting: (e) => e.exam_date < t && e.result === "PENDING",
    all: () => true,
  };
  const counts = Object.fromEntries(
    (Object.keys(TABS) as Tab[]).map((k) => [k, exams.filter(tabFilter[k]).length]),
  );
  const asc = tab !== "all" && tab !== "waiting";
  const list = exams
    .filter(tabFilter[tab])
    .filter(
      (e) =>
        (!fTtc || e.ttc_id === fTtc) &&
        (!fOcc || e.occupation_id === fOcc) &&
        (!fRes || e.result === fRes),
    )
    .filter((e) => {
      const c = candMap.get(e.candidate_id);
      const s = q.toLowerCase();
      return (
        !s ||
        [c?.name, c?.passport_no, c?.registration_no, c?.mobile, occName(e.occupation_id)].some(
          (v) => v?.toLowerCase().includes(s),
        )
      );
    })
    .sort(
      (a, b) =>
        (asc ? 1 : -1) *
        (a.exam_date + (a.exam_time ?? "")).localeCompare(b.exam_date + (b.exam_time ?? "")),
    );

  if (listQuery.isLoading || listQuery.isLoadingError)
    return <ListLoadStatus query={listQuery} />;

  return (
    <div>
      <PageHeader
        title="পরীক্ষা"
        subtitle={`মোট ${bn(exams.length)}টি পরীক্ষা`}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> নতুন পরীক্ষা
          </Button>
        }
      />
      <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
        {(Object.keys(TABS) as Tab[]).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={tab === k ? "default" : "outline"}
            onClick={() => setTab(k)}
            className="shrink-0"
          >
            {TABS[k]}{" "}
            <span className="ml-1 rounded-full bg-background/30 px-1.5 text-xs">
              {bn(counts[k])}
            </span>
          </Button>
        ))}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="নাম/পাসপোর্ট/মোবাইল/পেশা..."
          className="col-span-2 md:col-span-1"
        />
        <NativeSelect value={fTtc} onChange={(e) => setFTtc(e.target.value)}>
          <option value="">সব টিটিসি</option>
          {ttc?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={fOcc} onChange={(e) => setFOcc(e.target.value)}>
          <option value="">সব পেশা</option>
          {occ?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect value={fRes} onChange={(e) => setFRes(e.target.value)}>
          <option value="">সব অবস্থা</option>
          {RESULTS.map((r) => (
            <option key={r} value={r}>
              {RESULT_LABEL[r]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="card-surface overflow-hidden">
        {list.length === 0 ? (
          <Empty>এই তালিকায় কোনো পরীক্ষা নেই</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-3">পরীক্ষার্থী</th>
                  <th className="p-3">পেশা</th>
                  <th className="p-3">টিটিসি</th>
                  <th className="p-3">তারিখ</th>
                  <th className="p-3">সময়</th>
                  <th className="p-3">অবস্থা</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((e) => {
                  const dl = dayLabel(e.exam_date);
                  return (
                    <tr key={e.id} className="hover:bg-muted/50">
                      <td className="p-3 font-medium">
                        <Link
                          to="/candidates/$id"
                          params={{ id: e.candidate_id }}
                          className="hover:text-primary"
                        >
                          {candMap.get(e.candidate_id)?.name}
                        </Link>
                      </td>
                      <td className="p-3">{occName(e.occupation_id)}</td>
                      <td className="p-3">{ttcName(e.ttc_id)}</td>
                      <td className="whitespace-nowrap p-3">
                        {dl && e.result === "PENDING" ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-danger">
                            <span className="pulse-dot h-2 w-2 rounded-full bg-danger" />
                            {dl}
                          </span>
                        ) : (
                          fmtDate(e.exam_date)
                        )}
                      </td>
                      <td className="whitespace-nowrap p-3">{fmtTime(e.exam_time)}</td>
                      <td className="p-3">
                        <ResultBadge result={e.result} date={e.result_date} />
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => setResExam(e)}>
                            রেজাল্ট
                          </Button>
                          {(e.result === "PASS" || e.result === "FAIL") && (
                            <ResultShareActions
                              d={{
                                name: candMap.get(e.candidate_id)?.name ?? "—",
                                passport: candMap.get(e.candidate_id)?.passport_no ?? "—",
                                occupation: occName(e.occupation_id) ?? "—",
                                ttc: ttcName(e.ttc_id) ?? "—",
                                examAt: fmtDate(e.exam_date),
                                result: e.result,
                                ref: "—",
                              }}
                            />
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {open && <ExamDialog open={open} onOpenChange={setOpen} />}
      <ResultDialog open={!!resExam} onOpenChange={(o) => !o && setResExam(null)} exam={resExam} />
    </div>
  );
}
