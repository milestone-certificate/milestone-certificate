import { DateSelect } from "@/components/app/DateSelect";
import { CandidatePhoto } from "@/components/app/CandidatePhoto";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Plus, Search, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader, NativeSelect, ResultBadge, Empty } from "@/components/app/ui-bits";
import { CandidateDialog } from "@/components/app/forms";
import { ResultShareActions } from "@/components/app/ResultListShare";
import {
  candidatesQ,
  examsQ,
  occQ,
  ttcQ,
  lookup,
  bn,
  fmtDate,
  RESULTS,
  RESULT_LABEL,
  todayStr,
  type Exam,
} from "@/lib/data";

export const Route = createFileRoute("/_authenticated/candidates/")({
  head: () => ({
    meta: [
      { title: "পরীক্ষার্থী তালিকা | Milestone Certificate Institute" },
      { name: "description", content: "পরীক্ষার্থী খুঁজুন, ফিল্টার ও যোগ করুন।" },
      { property: "og:title", content: "পরীক্ষার্থী তালিকা | Milestone Certificate Institute" },
      { property: "og:description", content: "পরীক্ষার্থী খুঁজুন, ফিল্টার ও যোগ করুন।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CandidatesPage,
});

function CandidatesPage() {
  const { data: cands = [], isLoading } = useQuery(candidatesQ);
  const { data: exams = [] } = useQuery(examsQ);
  const { data: occ } = useQuery(occQ);
  const { data: ttc } = useQuery(ttcQ);
  const occName = lookup(occ);
  const ttcName = lookup(ttc);
  const [q, setQ] = useState("");
  const [fTtc, setFTtc] = useState("");
  const [fOcc, setFOcc] = useState("");
  const [fDist, setFDist] = useState("");
  const [fResult, setFResult] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDate, setFDate] = useState("");
  const [open, setOpen] = useState(false);

  const byCand = useMemo(() => {
    const m = new Map<string, Exam[]>();
    exams.forEach((e) => m.set(e.candidate_id, [...(m.get(e.candidate_id) ?? []), e]));
    return m;
  }, [exams]);
  const districts = [...new Set(cands.map((c) => c.district).filter(Boolean))] as string[];
  const t = todayStr();

  const list = cands.filter((c) => {
    const s = q.trim().toLowerCase();
    if (
      s &&
      ![c.name, c.passport_no, c.registration_no, c.mobile, occName(c.occupation_id)].some((v) =>
        v?.toLowerCase().includes(s),
      )
    )
      return false;
    if (fTtc && c.ttc_id !== fTtc) return false;
    if (fOcc && c.occupation_id !== fOcc) return false;
    if (fDist && c.district !== fDist) return false;
    const ex = byCand.get(c.id) ?? [];
    if (fResult && !ex.some((e) => e.result === fResult)) return false;
    if (fDate && !ex.some((e) => e.exam_date === fDate)) return false;
    if (fStatus === "upcoming" && !ex.some((e) => e.exam_date >= t && e.result === "PENDING"))
      return false;
    if (fStatus === "waiting" && !ex.some((e) => e.exam_date < t && e.result === "PENDING"))
      return false;
    if (fStatus === "none" && ex.length > 0) return false;
    return true;
  });

  return (
    <div>
      <PageHeader
        title="পরীক্ষার্থী"
        subtitle={`মোট ${bn(cands.length)} জন`}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> নতুন পরীক্ষার্থী
          </Button>
        }
      />

      <div className="card-surface mb-4 space-y-3 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="নাম, পাসপোর্ট, রেজিস্ট্রেশন, মোবাইল বা পেশা দিয়ে খুঁজুন..."
            className="h-11 pl-9"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
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
          <NativeSelect value={fDist} onChange={(e) => setFDist(e.target.value)}>
            <option value="">সব জেলা</option>
            {districts.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </NativeSelect>
          <NativeSelect value={fResult} onChange={(e) => setFResult(e.target.value)}>
            <option value="">সব রেজাল্ট</option>
            {RESULTS.map((r) => (
              <option key={r} value={r}>
                {RESULT_LABEL[r]}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">সব অবস্থা</option>
            <option value="upcoming">আসন্ন পরীক্ষা আছে</option>
            <option value="waiting">রেজাল্টের অপেক্ষায়</option>
            <option value="none">কোনো পরীক্ষা নেই</option>
          </NativeSelect>
          <DateSelect
            autoToday={false}
            value={fDate}
            onChange={(e) => setFDate(e.target.value)}
            title="পরীক্ষার তারিখ"
            className="col-span-2"
          />
        </div>
      </div>

      {isLoading ? (
        <Empty>লোড হচ্ছে...</Empty>
      ) : list.length === 0 ? (
        <Empty>কোনো পরীক্ষার্থী পাওয়া যায়নি</Empty>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((c) => {
            const ex = byCand.get(c.id) ?? [];
            const last = ex[0];
            const next = ex
              .filter((e) => e.exam_date >= t && e.result === "PENDING")
              .sort((a, b) => a.exam_date.localeCompare(b.exam_date))[0];
            return (
              <Link
                key={c.id}
                to="/candidates/$id"
                params={{ id: c.id }}
                className={`card-surface block min-w-0 border-l-4 p-4 transition-all duration-300 hover:-translate-y-0.5 ${ex.some((e) => e.result === "PASS") ? "border-l-emerald-500 shadow-[0_0_14px_-4px_rgb(16_185_129/0.6)] hover:shadow-[0_0_22px_-4px_rgb(16_185_129/0.8)]" : "border-l-amber-400 shadow-[0_0_14px_-4px_rgb(251_191_36/0.55)] hover:shadow-[0_0_22px_-4px_rgb(251_191_36/0.8)]"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <CandidatePhoto path={c.photo_url} name={c.name} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {c.passport_no ?? "—"} · {c.registration_no ?? "—"}
                    </div>
                  </div>
                  {last && <ResultBadge result={last.result} date={last.result_date} />}
                </div>
                <div className="mt-2 flex flex-wrap break-words gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{occName(c.occupation_id)}</span>
                  <span>{ttcName(c.ttc_id)}</span>
                  <span>{c.district}</span>
                  {c.mobile && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {c.mobile}
                    </span>
                  )}
                </div>
                {last && (last.result === "PASS" || last.result === "FAIL") && (
                  <div
                    className="mt-2 flex flex-wrap gap-1.5"
                    onClick={(ev) => ev.preventDefault()}
                  >
                    <ResultShareActions
                      d={{
                        name: c.name,
                        passport: c.passport_no ?? "—",
                        occupation: occName(last.occupation_id ?? c.occupation_id) ?? "—",
                        ttc: ttcName(last.ttc_id ?? c.ttc_id) ?? "—",
                        examAt: fmtDate(last.exam_date),
                        result: last.result,
                        ref: c.registration_no ?? "—",
                      }}
                    />
                  </div>
                )}
                <div className="mt-3 flex justify-between border-t pt-2 text-xs">
                  <span>
                    মোট পরীক্ষা: <b>{bn(ex.length)}</b>
                  </span>
                  {next ? (
                    <span className="font-medium text-primary">
                      পরবর্তী: {fmtDate(next.exam_date)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">আসন্ন নেই</span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <CandidateDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
