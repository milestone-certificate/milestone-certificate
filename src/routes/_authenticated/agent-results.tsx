import { ListLoadStatus } from "@/components/app/ui-bits";
import { DateSelect } from "@/components/app/DateSelect";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { worksQ, fmtDhakaDateTime } from "@/lib/works";
import { bn, occQ, ttcQ, lookup } from "@/lib/data";
import { checkSubmissionSvp } from "@/lib/svp.functions";
import { SvpPill } from "@/components/app/WorkBits";
import { ResultCheckButton } from "@/components/app/ResultCheckButton";
import { ResultShareActions } from "@/components/app/ResultListShare";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/agent-results")({
  head: () => ({
    meta: [
      { title: "রেজাল্ট চেক — এজেন্ট | Milestone Certificate Institute" },
      {
        name: "description",
        content: "তারিখ অনুযায়ী পরীক্ষার্থীদের পাসপোর্টভিত্তিক রেজাল্ট দেখুন ও পুনরায় চেক করুন।",
      },
      { property: "og:title", content: "রেজাল্ট চেক — এজেন্ট | Milestone Certificate Institute" },
      { property: "og:description", content: "তারিখ অনুযায়ী পরীক্ষার্থীদের রেজাল্ট চেক।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgentResults,
});

const dhakaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });

function AgentResults() {
  const qc = useQueryClient();
  const check = useServerFn(checkSubmissionSvp);
  const listQuery = useQuery(worksQ);
  const { data: all = [] } = listQuery;
  const { data: occ } = useQuery(occQ);
  const { data: ttc } = useQuery(ttcQ);
  const occName = lookup(occ),
    ttcName = lookup(ttc);
  const { user } = Route.useRouteContext();
  const [date, setDate] = useState(() => dhakaDay(new Date()));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const s = q.trim().toUpperCase();
  const list = all
    .filter((w) => w.submitted_by === user.id && w.status === "approved" && !!w.exam_at)
    .filter((w) => (date ? dhakaDay(new Date(w.exam_at)) === date : true))
    .filter(
      (w) =>
        !s || w.passport_no.toUpperCase().includes(s) || w.candidate_name.toUpperCase().includes(s),
    )
    .sort((a, b) => a.exam_at.localeCompare(b.exam_at));

  const checkAll = async () => {
    const todo = list.filter((w) => w.svp_result !== "PASS");
    if (!todo.length) return toast.info("চেক করার মতো কেউ নেই");
    setBusy(true);
    let found = 0,
      missing = 0,
      failed = 0;
    for (const w of todo) {
      try {
        const r = await check({ data: { id: w.id } });
        if (r.status === "found") found++;
        else if (r.status === "not_found") missing++;
        else failed++;
      } catch {
        failed++;
      }
    }
    setBusy(false);
    ["works", "exams", "candidates"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    toast.success(
      `রেজাল্ট পাওয়া: ${bn(found)} · এখনো আসেনি: ${bn(missing)}${failed ? ` · ব্যর্থ: ${bn(failed)}` : ""}`,
    );
  };

  if (listQuery.isLoading || listQuery.isLoadingError)
    return <ListLoadStatus query={listQuery} />;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="font-display text-2xl font-bold">রেজাল্ট চেক</h1>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card p-3">
        <DateSelect
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-10 rounded-lg border bg-card px-2 text-sm"
        />
        <Button variant="ghost" size="sm" onClick={() => setDate("")}>
          সব তারিখ
        </Button>
        <input
          className="h-10 min-w-0 flex-1 rounded-lg border bg-card px-3 text-sm"
          placeholder="পাসপোর্ট / নাম"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button size="sm" disabled={busy || !list.length} onClick={checkAll}>
          <RefreshCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
          {busy ? "চেক হচ্ছে..." : `এই তালিকার সবাই চেক (${bn(list.length)})`}
        </Button>
      </div>
      {list.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          এই তারিখে কোনো অনুমোদিত পরীক্ষার্থী নেই।
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left">
              <tr>
                {["পাসপোর্ট", "নাম", "পরীক্ষার তারিখ", "রেজাল্ট", ""].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((w) => (
                <tr key={w.id}>
                  <td className="px-3 py-2 font-medium">{w.passport_no}</td>
                  <td className="px-3 py-2">{w.candidate_name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDhakaDateTime(w.exam_at)}</td>
                  <td className="px-3 py-2">
                    <SvpPill result={w.svp_result} work={w} checking={busy} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <ResultCheckButton w={w} />
                      {(w.svp_result === "PASS" || w.svp_result === "FAIL") && (
                        <ResultShareActions
                          d={{
                            name: w.candidate_name,
                            passport: w.passport_no,
                            occupation: occName(w.occupation_id) ?? "—",
                            ttc: ttcName(w.ttc_id) ?? "—",
                            examAt: fmtDhakaDateTime(w.exam_at),
                            result: w.svp_result,
                            ref: w.ref_code,
                          }}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        রেজাল্ট শুধু অফিসিয়াল SVP সার্ভার থেকে আসে। সেখানে রেজাল্ট না থাকলে আগের রেজাল্ট অপরিবর্তিত
        থাকে।
      </p>
    </div>
  );
}
