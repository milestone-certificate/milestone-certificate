import { worksQ, openTicket, STATUS_LABEL } from "@/lib/works";
import { CandidatePhoto } from "@/components/app/CandidatePhoto";
import { AgentPhoto } from "@/components/app/AgentPhoto";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CalendarPlus, ClipboardCheck, Pencil, Trash2, User } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageHeader, ResultBadge, Empty, ListLoadStatus } from "@/components/app/ui-bits";
import { CandidateDialog, ExamDialog, ResultDialog } from "@/components/app/forms";
import {
  candidatesQ,
  examsQ,
  occQ,
  ttcQ,
  resultsQ,
  lookup,
  bn,
  fmtDate,
  fmtTime,
  todayStr,
  dayLabel,
  RESULT_LABEL,
  useRefreshAll,
  type Exam,
} from "@/lib/data";

export const Route = createFileRoute("/_authenticated/candidates/$id")({
  head: () => ({
    meta: [
      { title: "পরীক্ষার্থীর প্রোফাইল | Milestone Certificate Institute" },
      { name: "description", content: "পরীক্ষার্থীর সম্পূর্ণ ইতিহাস।" },
      { property: "og:title", content: "পরীক্ষার্থীর প্রোফাইল | Milestone Certificate Institute" },
      { property: "og:description", content: "পরীক্ষার্থীর সম্পূর্ণ ইতিহাস।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Profile,
});

function Profile() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const refresh = useRefreshAll();
  const listQuery = useQuery(candidatesQ);
  const { data: cands } = listQuery;
  const { data: allExams = [] } = useQuery(examsQ);
  const { data: allResults = [] } = useQuery(resultsQ);
  const { data: occ } = useQuery(occQ);
  const { data: ttc } = useQuery(ttcQ);
  const { data: works = [] } = useQuery(worksQ);
  const { data: agents = [] } = useQuery({
    queryKey: ["agent-accounts"],
    queryFn: async () =>
      (await supabase.from("agent_accounts").select("user_id, full_name, agent_code")).data ?? [],
  });
  const occName = lookup(occ);
  const ttcName = lookup(ttc);
  const [edit, setEdit] = useState(false);
  const [examOpen, setExamOpen] = useState(false);
  const [editExam, setEditExam] = useState<Exam | null>(null);
  const [resExam, setResExam] = useState<Exam | null>(null);
  const [del, setDel] = useState(false);

  const c = cands?.find((x) => x.id === id);
  if (listQuery.isLoading || listQuery.isLoadingError)
    return <ListLoadStatus query={listQuery} />;
  if (!c)
    return (
      <Empty>
        পরীক্ষার্থী পাওয়া যায়নি।{" "}
        <Link to="/candidates" className="text-primary">
          তালিকায় ফিরুন
        </Link>
      </Empty>
    );

  const t = todayStr();
  const exams = allExams.filter((e) => e.candidate_id === id);
  const results = allResults.filter((r) => r.candidate_id === id);
  const upcoming = exams
    .filter((e) => e.exam_date >= t && e.result === "PENDING")
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date));
  const past = exams.filter((e) => e.exam_date < t || e.result !== "PENDING");
  const count = (r: string) => exams.filter((e) => e.result === r).length;

  const remove = async () => {
    const { error } = await supabase.from("candidates").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("মুছে ফেলা হয়েছে");
    refresh();
    navigate({ to: "/candidates" });
  };

  const work = works
    .filter((w) => w.candidate_id === id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const agent = work ? agents.find((a) => a.user_id === work.submitted_by) : undefined;
  const next = upcoming[0] ?? exams[0];
  const info: [string, string][] = (
    [
      ["পাসপোর্ট", c.passport_no ?? "—"],
      ["মোবাইল", c.mobile ?? "—"],
      ["বিকল্প মোবাইল", c.secondary_mobile ?? ""],
      ["পেশা", occName(c.occupation_id)],
      ["টিটিসি", ttcName(c.ttc_id)],
      ["পরীক্ষা", next ? `${fmtDate(next.exam_date)} · ${fmtTime(next.exam_time)}` : ""],
      ["রেজাল্ট", next?.result ?? ""],
      ["উপস্থিতি", STATUS_LABEL[c.arrival_status] ?? c.arrival_status],
      ["শিক্ষা", work?.education ?? ""],
      ["অভিজ্ঞতা", work?.experience ?? ""],
      [
        "এজেন্ট",
        agent ? `${agent.full_name}${agent.agent_code ? ` (${agent.agent_code})` : ""}` : "",
      ],
      ["রেফারেন্স", work?.ref_code ?? ""],
    ] as [string, string][]
  ).filter(([, v]) => (v && v !== "—") || false);

  return (
    <div>
      <Link
        to="/candidates"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> পরীক্ষার্থী তালিকা
      </Link>
      <PageHeader
        title={c.name}
        subtitle={c.needs_follow_up ? "⚠ ফলো-আপ প্রয়োজন" : undefined}
        actions={
          <>
            <Button onClick={() => setExamOpen(true)}>
              <CalendarPlus className="h-4 w-4" /> নতুন পরীক্ষা
            </Button>
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil className="h-4 w-4" /> সম্পাদনা
            </Button>
            <Button variant="outline" onClick={() => setDel(true)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card-surface p-4">
          <h3 className="mb-3 text-base font-semibold">ব্যক্তিগত তথ্য</h3>
          <div className="mb-3 flex justify-center">
            <CandidatePhoto path={c.photo_url} name={c.name} size={112} />
          </div>
          <dl className="space-y-1.5 text-sm">
            {info.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
          {work && (
            <div className="mt-3">
              <AgentPhoto id={work.submitted_by} name={agent?.full_name} />
            </div>
          )}
          {c.skill_details && (
            <p className="mt-3 rounded-lg bg-muted p-2 text-sm">
              <b>দক্ষতা:</b> {c.skill_details}
            </p>
          )}
          {work?.ticket_path && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3 w-full"
              onClick={() => openTicket(work.ticket_path)}
            >
              তাকামুল টিকিট দেখুন
            </Button>
          )}
          {c.notes && <p className="mt-3 rounded-lg bg-muted p-2 text-sm">{c.notes}</p>}
        </div>

        <div className="space-y-4 lg:col-span-2">
          {upcoming.length > 0 && (
            <div className="card-surface border-primary/40 p-4">
              <h3 className="mb-2 text-base font-semibold">আসন্ন পরীক্ষা</h3>
              {upcoming.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center justify-between rounded-lg bg-primary-soft px-3 py-2 text-sm"
                >
                  <span>
                    {dayLabel(e.exam_date) ?? fmtDate(e.exam_date)} · {fmtTime(e.exam_time)} ·{" "}
                    {ttcName(e.ttc_id)}
                  </span>
                  <span className="text-primary">{occName(e.occupation_id)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="card-surface p-4">
            <h3 className="mb-3 text-base font-semibold">পরীক্ষার ইতিহাস</h3>
            {exams.length === 0 ? (
              <Empty>এখনো কোনো পরীক্ষা নেই</Empty>
            ) : (
              <ol className="relative space-y-3 border-l-2 border-border pl-5">
                {exams.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-card bg-primary" />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-semibold">
                          {fmtDate(e.exam_date)}{" "}
                          <span className="text-xs font-normal text-muted-foreground">
                            {fmtTime(e.exam_time)}
                          </span>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {occName(e.occupation_id)} · {ttcName(e.ttc_id)} · {e.exam_type}
                          {e.score != null && ` · স্কোর ${bn(e.score)}`}
                        </div>
                        {e.remarks && (
                          <div className="text-xs text-muted-foreground">{e.remarks}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <ResultBadge result={e.result} date={e.result_date} />
                        <Button size="sm" variant="ghost" onClick={() => setResExam(e)}>
                          রেজাল্ট
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditExam(e)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="card-surface p-4">
            <h3 className="mb-3 text-base font-semibold">রেজাল্টের ইতিহাস</h3>
            {results.length === 0 ? (
              <Empty>কোনো রেজাল্ট রেকর্ড নেই</Empty>
            ) : (
              <ul className="divide-y text-sm">
                {results.map((r) => (
                  <li key={r.id} className="flex justify-between py-2">
                    <span>
                      {fmtDate(r.result_date)} — পরীক্ষা{" "}
                      {fmtDate(allExams.find((e) => e.id === r.exam_id)?.exam_date)}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {r.source === "manual" ? "ম্যানুয়াল" : "অটো"}
                      </span>
                      <ResultBadge result={r.result} date={r.result_date} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <CandidateDialog open={edit} onOpenChange={setEdit} candidate={c} />
      <ExamDialog open={examOpen} onOpenChange={setExamOpen} candidateId={id} />
      <ExamDialog open={!!editExam} onOpenChange={(o) => !o && setEditExam(null)} exam={editExam} />
      <ResultDialog open={!!resExam} onOpenChange={(o) => !o && setResExam(null)} exam={resExam} />
      <AlertDialog open={del} onOpenChange={setDel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>পরীক্ষার্থী মুছে ফেলবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              এই পরীক্ষার্থীর সব পরীক্ষা ({bn(exams.length)}টি) ও রেজাল্টের ইতিহাসও মুছে যাবে।{" "}
              {RESULT_LABEL.CANCELLED} করা ভালো হতে পারে।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>না</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>হ্যাঁ, মুছুন</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
