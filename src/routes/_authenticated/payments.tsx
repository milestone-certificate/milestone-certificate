import { ListLoadStatus } from "@/components/app/ui-bits";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { candidatesQ, occQ, lookup, bn, fmtDate } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/_authenticated/payments")({
  head: () => ({
    meta: [
      { title: "পেমেন্ট ব্যবস্থাপনা — অ্যাডমিন | Milestone Certificate Institute" },
      {
        name: "description",
        content: "পরীক্ষার্থীর ফি নির্ধারণ ও বিকাশ, নগদ, রকেট, ব্যাংক পেমেন্ট যাচাই।",
      },
      {
        property: "og:title",
        content: "পেমেন্ট ব্যবস্থাপনা — অ্যাডমিন | Milestone Certificate Institute",
      },
      { property: "og:description", content: "পরীক্ষার্থীর ফি নির্ধারণ ও পেমেন্ট যাচাই।" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaymentsPage,
});

export const METHOD_LABEL: Record<string, string> = {
  bkash: "বিকাশ",
  nagad: "নগদ",
  rocket: "রকেট",
  bank: "ব্যাংক",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "যাচাই বাকি",
  approved: "অনুমোদিত",
  rejected: "বাতিল",
};

const paymentsQ = {
  queryKey: ["payments"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("payments")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },
};

function PaymentsPage() {
  const qc = useQueryClient();
  const listQuery = useQuery(paymentsQ);
  const { data: pays = [] } = listQuery;
  const { data: cands = [] } = useQuery(candidatesQ);
  const occ = lookup(useQuery(occQ).data);
  const cMap = new Map(cands.map((c) => [c.id, c]));
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"pending" | "all" | "fees">("pending");
  const [instr, setInstr] = useState("");
  const [fees, setFees] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase
      .from("settings")
      .select("value")
      .eq("key", "payment_instructions")
      .maybeSingle()
      .then(({ data }) => setInstr(data?.value ?? ""));
  }, []);

  const s = q.trim().toLowerCase();
  const match = (c?: (typeof cands)[number]) =>
    !s ||
    [c?.name, c?.passport_no, c?.mobile, occ(c?.occupation_id ?? null)].some((v) =>
      v?.toLowerCase().includes(s),
    );
  const paidFor = (id: string) =>
    pays
      .filter((p) => p.candidate_id === id && p.status === "approved")
      .reduce((a, p) => a + Number(p.amount), 0);

  const review = async (id: string, status: "approved" | "rejected") => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("payments")
      .update({ status, reviewed_by: u.user?.id ?? null, reviewed_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error("আপডেট করা যায়নি");
    toast.success(status === "approved" ? "পেমেন্ট অনুমোদিত" : "পেমেন্ট বাতিল");
    qc.invalidateQueries({ queryKey: ["payments"] });
  };
  const saveFee = async (id: string) => {
    const v = Number(fees[id]);
    if (!(v >= 0)) return toast.error("সঠিক টাকার পরিমাণ দিন");
    const { error } = await supabase.from("candidates").update({ fee_amount: v }).eq("id", id);
    if (error) return toast.error("সংরক্ষণ করা যায়নি");
    toast.success("ফি সংরক্ষণ হয়েছে");
    qc.invalidateQueries({ queryKey: ["candidates"] });
  };
  const saveInstr = async () => {
    const { error } = await supabase
      .from("settings")
      .upsert({ key: "payment_instructions", value: instr.slice(0, 2000) });
    if (error) toast.error("সংরক্ষণ করা যায়নি");
    else toast.success("পেমেন্ট নির্দেশনা সংরক্ষণ হয়েছে");
  };

  const list = pays.filter(
    (p) =>
      (tab === "all" || p.status === "pending") &&
      (match(cMap.get(p.candidate_id)) || p.trx_id.toLowerCase().includes(s)),
  );

  if (listQuery.isLoading || listQuery.isLoadingError)
    return <ListLoadStatus query={listQuery} />;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="font-display text-2xl font-bold">পেমেন্ট ব্যবস্থাপনা</h1>

      <section className="space-y-2 rounded-2xl border bg-card p-4">
        <p className="font-semibold">কাস্টমারের জন্য পেমেন্ট নির্দেশনা</p>
        <Textarea
          rows={4}
          value={instr}
          onChange={(e) => setInstr(e.target.value)}
          placeholder={
            "বিকাশ: 01XXXXXXXXX (পার্সোনাল)\nনগদ: 01XXXXXXXXX\nরকেট: 01XXXXXXXXX\nব্যাংক: হিসাবের নাম, নম্বর, শাখা"
          }
        />
        <Button size="sm" onClick={saveInstr}>
          নির্দেশনা সংরক্ষণ
        </Button>
      </section>

      <input
        className="h-10 w-full rounded-lg border bg-card px-3 text-sm"
        placeholder="নাম / পাসপোর্ট / মোবাইল / পেশা / TrxID দিয়ে খুঁজুন"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="flex gap-2">
        {(
          [
            ["pending", "যাচাই বাকি"],
            ["all", "সব পেমেন্ট"],
            ["fees", "ফি নির্ধারণ"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-lg border px-3 py-1.5 text-sm ${tab === k ? "border-primary bg-primary/15 font-semibold" : "bg-card"}`}
          >
            {l}
          </button>
        ))}
      </div>

      {tab === "fees" ? (
        <ul className="divide-y rounded-2xl border bg-card">
          {cands
            .filter((c) => match(c))
            .slice(0, 200)
            .map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-muted-foreground">
                    {c.passport_no ?? "—"} · {c.mobile ?? "—"} · পরিশোধিত ৳{bn(paidFor(c.id))} / ৳
                    {bn(Number(c.fee_amount))}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Input
                    className="h-9 w-28"
                    inputMode="numeric"
                    value={fees[c.id] ?? String(c.fee_amount)}
                    onChange={(e) =>
                      setFees({ ...fees, [c.id]: e.target.value.replace(/[^\d.]/g, "") })
                    }
                  />
                  <Button size="sm" variant="outline" onClick={() => saveFee(c.id)}>
                    সংরক্ষণ
                  </Button>
                </div>
              </li>
            ))}
        </ul>
      ) : list.length === 0 ? (
        <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
          কোনো পেমেন্ট নেই।
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {list.map((p) => {
            const c = cMap.get(p.candidate_id);
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {c?.name ?? "—"} · ৳{bn(Number(p.amount))} · {METHOD_LABEL[p.method]}
                  </p>
                  <p className="text-muted-foreground">
                    TrxID: {p.trx_id} · প্রেরক: {p.sender} · {fmtDate(p.created_at.slice(0, 10))} ·{" "}
                    {STATUS_LABEL[p.status]}
                  </p>
                </div>
                {p.status === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => review(p.id, "approved")}>
                      অনুমোদন
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => review(p.id, "rejected")}
                    >
                      বাতিল
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
