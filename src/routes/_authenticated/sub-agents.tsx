import { ListLoadStatus } from "@/components/app/ui-bits";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Check, FileText, UserPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { createSubAgent, setSubAgentActive, reviewSubAgentWork } from "@/lib/accounts.functions";
import { worksQ, myAccountQ, openTicket, fmtDhakaDateTime } from "@/lib/works";
import { occQ, lookup, bn } from "@/lib/data";
import { CandidatePhoto } from "@/components/app/CandidatePhoto";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { UnpaidNotice, useMyUnpaid } from "@/components/app/AgentNotice";

export const Route = createFileRoute("/_authenticated/sub-agents")({
  head: () => ({
    meta: [
      { title: "সাব-এজেন্ট — এজেন্ট | Milestone Certificate Institute" },
      { name: "description", content: "সাব-এজেন্ট আইডি তৈরি ও তাদের জমা দেওয়া কাজ অনুমোদন।" },
      { property: "og:title", content: "সাব-এজেন্ট — এজেন্ট | Milestone Certificate Institute" },
      {
        property: "og:description",
        content: "সাব-এজেন্ট আইডি তৈরি ও তাদের জমা দেওয়া কাজ অনুমোদন।",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubAgents,
});

const subsQ = (me: string) => ({
  queryKey: ["sub-agents", me],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("agent_accounts")
      .select("*")
      .eq("parent_agent_id", me)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
});

function SubAgents() {
  const unpaid = useMyUnpaid();
  const qc = useQueryClient();
  const { data: me } = useQuery(myAccountQ);
  const listQuery = useQuery(worksQ);
  const { data: works = [] } = listQuery;
  const occ = lookup(useQuery(occQ).data);
  const subs = useQuery({ ...subsQ(me?.user_id ?? ""), enabled: !!me?.user_id }).data ?? [];
  const [f, setF] = useState({ name: "", mobile: "", password: "" });
  const [busy, setBusy] = useState(false);

  if (me?.parent_agent_id)
    return (
      <p className="mx-auto max-w-3xl rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
        সাব-এজেন্ট আইডি থেকে আরেকটি সাব-এজেন্ট তৈরি করা যায় না।
      </p>
    );

  const name = (id: string) => subs.find((s) => s.user_id === id)?.full_name ?? "সাব-এজেন্ট";
  const subIds = new Set(subs.map((s) => s.user_id));
  const pending = works.filter((w) => w.status === "pending_agent" && subIds.has(w.submitted_by));
  const subWorks = works.filter((w) => subIds.has(w.submitted_by) && w.status !== "pending_agent");

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (f.name.trim().length < 2) return toast.error("নাম দিন");
    if (!/^01[3-9]\d{8}$/.test(f.mobile)) return toast.error("১১ সংখ্যার সঠিক মোবাইল নম্বর দিন");
    if (f.password.length < 6) return toast.error("পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে");
    setBusy(true);
    const r = await createSubAgent({ data: f }).catch((error) => ({
      ok: false as const,
      message:
        error instanceof Error && error.message ? error.message : "অ্যাকাউন্ট তৈরি করা যায়নি",
    }));
    setBusy(false);
    if (!r.ok) return toast.error(r.message);
    toast.success("সাব-এজেন্ট আইডি তৈরি হয়েছে");
    setF({ name: "", mobile: "", password: "" });
    qc.invalidateQueries({ queryKey: ["sub-agents"] });
  };

  const review = async (id: string, approve: boolean) => {
    const reason = approve ? undefined : (window.prompt("বাতিলের কারণ (ঐচ্ছিক)") ?? undefined);
    const r = await reviewSubAgentWork({ data: { id, approve, reason } }).catch(() => ({
      ok: false,
    }));
    if (!r.ok) return toast.error("পরিবর্তন করা যায়নি");
    toast.success(approve ? "অনুমোদিত — অ্যাডমিনের কাছে পাঠানো হয়েছে" : "বাতিল করা হয়েছে");
    qc.invalidateQueries({ queryKey: ["works"] });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="font-display text-2xl font-bold">সাব-এজেন্ট</h1>
      {unpaid && <UnpaidNotice />}

      <section className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="font-semibold">অনুমোদনের অপেক্ষায় ({bn(pending.length)})</h2>
        {listQuery.isLoading || listQuery.isLoadingError ? (
          <ListLoadStatus query={listQuery} />
        ) : pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">কোনো অপেক্ষমান কাজ নেই।</p>
        ) : (
          <ul className="space-y-3">
            {pending.map((w) => (
              <li key={w.id} className="rounded-xl border p-3">
                <div className="flex items-center gap-3 font-semibold">
                  <CandidatePhoto
                    path={w.candidate_photo_path}
                    name={w.candidate_name}
                    size={44}
                    deferUntilVisible
                  />
                  <span>{w.candidate_name}</span>
                  <span className="text-sm font-normal text-muted-foreground">#{w.ref_code}</span>
                </div>
                <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
                  <span>সাব-এজেন্ট: {name(w.submitted_by)}</span>
                  <span>পাসপোর্ট: {w.passport_no}</span>
                  <span>মোবাইল: {w.mobile}</span>
                  <span>পেশা: {w.occupation_id ? occ(w.occupation_id) : "—"}</span>
                  <span>পরীক্ষা: {fmtDhakaDateTime(w.exam_at)}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => review(w.id, true)}>
                    <Check className="mr-1 h-4 w-4" /> অনুমোদন
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => review(w.id, false)}>
                    <X className="mr-1 h-4 w-4" /> বাতিল
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => openTicket(w.ticket_path)}>
                    <FileText className="mr-1 h-4 w-4" /> Ticket
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form onSubmit={create} className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold">
          <UserPlus className="h-5 w-5 text-primary" /> নতুন সাব-এজেন্ট আইডি
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>নাম</Label>
            <Input
              value={f.name}
              maxLength={100}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </div>
          <div>
            <Label>মোবাইল নম্বর</Label>
            <Input
              inputMode="numeric"
              placeholder="01XXXXXXXXX"
              value={f.mobile}
              onChange={(e) =>
                setF({ ...f, mobile: e.target.value.replace(/\D/g, "").slice(0, 11) })
              }
            />
          </div>
          <div>
            <Label>পাসওয়ার্ড</Label>
            <Input
              value={f.password}
              maxLength={72}
              onChange={(e) => setF({ ...f, password: e.target.value })}
            />
          </div>
        </div>
        <Button type="submit" disabled={busy}>
          {busy ? "তৈরি হচ্ছে..." : "আইডি তৈরি করুন"}
        </Button>
      </form>

      <section className="rounded-2xl border bg-card shadow-sm">
        <h2 className="border-b p-4 font-semibold">আমার সাব-এজেন্ট ({bn(subs.length)})</h2>
        {subs.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">এখনো কোনো সাব-এজেন্ট নেই।</p>
        ) : (
          <ul className="divide-y">
            {subs.map((s) => (
              <li key={s.user_id} className="flex flex-wrap items-center justify-between gap-2 p-4">
                <div>
                  <div className="font-medium">{s.full_name}</div>
                  <div className="text-sm text-muted-foreground">
                    {s.mobile} · মোট কাজ{" "}
                    {bn(works.filter((w) => w.submitted_by === s.user_id).length)} ·{" "}
                    <span className={s.active ? "text-primary" : "text-destructive"}>
                      {s.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    const r = await setSubAgentActive({
                      data: { id: s.user_id, active: !s.active },
                    }).catch(() => ({ ok: false }));
                    if (r.ok) void qc.invalidateQueries({ queryKey: ["sub-agents"] });
                    else toast.error("পরিবর্তন করা যায়নি");
                  }}
                >
                  {s.active ? "Inactive করুন" : "Active করুন"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {subWorks.length > 0 && (
        <section className="rounded-2xl border bg-card p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">সাব-এজেন্টদের অন্যান্য কাজ ({bn(subWorks.length)})</h2>
          <ul className="divide-y text-sm">
            {subWorks.map((w) => (
              <li key={w.id} className="flex justify-between gap-2 py-2">
                <span>
                  {w.candidate_name} · {name(w.submitted_by)}
                </span>
                <span className="text-muted-foreground">
                  {w.status === "approved"
                    ? `অনুমোদিত · ${w.svp_result}`
                    : w.status === "rejected"
                      ? "বাতিল"
                      : "অ্যাডমিনের অপেক্ষায়"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
