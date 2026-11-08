import { CandidatePhoto } from "@/components/app/CandidatePhoto";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { homeForRoles } from "@/lib/roles";
import { PortalAssistant } from "@/components/app/PortalAssistant";
import { RESULT_LABEL, bn, fmtDate, portalQ, type PortalData, type Exam } from "@/lib/data";

export const Route = createFileRoute("/portal")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "আমার ফলাফল ও সার্টিফিকেট | Milestone Certificate Institute" },
      { name: "description", content: "আপনার পরীক্ষার ফলাফল দেখুন এবং সার্টিফিকেট প্রিন্ট করুন।" },
      {
        property: "og:title",
        content: "আমার ফলাফল ও সার্টিফিকেট | Milestone Certificate Institute",
      },
      {
        property: "og:description",
        content: "পরীক্ষার্থীদের ব্যক্তিগত ফলাফল ও সার্টিফিকেট পোর্টাল।",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    const roles = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
    if (roles.error) throw new Error("অ্যাক্সেস যাচাই করা যায়নি। আবার চেষ্টা করুন।");
    if (roles.data?.length) throw redirect({ to: homeForRoles(roles.data.map((row) => row.role)) });
    const { checkDeviceSession, forceSignOut } = await import("@/lib/device-session");
    const reason = await checkDeviceSession();
    if (reason) {
      await forceSignOut(reason);
      throw redirect({ to: "/auth" });
    }
    return { userId: data.user.id };
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(portalQ(context.userId)),
  component: PortalRoute,
});

const badge: Record<string, string> = {
  PASS: "bg-primary/15 text-primary",
  FAIL: "bg-destructive/15 text-destructive",
  PENDING: "bg-muted text-muted-foreground",
  ABSENT: "bg-secondary text-secondary-foreground",
  CANCELLED: "bg-secondary text-secondary-foreground",
};

function PortalRoute() {
  const { userId } = Route.useRouteContext();
  return <PortalPage key={userId} userId={userId} />;
}
function PortalPage({ userId }: { userId: string }) {
  const { data } = useSuspenseQuery(portalQ(userId));
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [cert, setCert] = useState<Exam | null>(null);
  const c = data.candidate;
  const fee = Number(c?.fee_amount ?? 0);
  const paid = data.payments
    .filter((x) => x.status === "approved")
    .reduce((t, x) => t + Number(x.amount), 0);
  const due = Math.max(0, fee - paid);
  const locked = fee > 0 && due > 0;

  const logout = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut({ scope: "local" });
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/90 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold text-primary">আমার পোর্টাল</h1>
          <button onClick={logout} className="rounded-lg border px-3 py-1.5 text-sm hover:bg-muted">
            লগআউট
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-6 print:hidden">
        {!c ? (
          <div className="rounded-2xl border bg-card p-8 text-center">
            <p className="font-semibold">
              আপনার মোবাইল নম্বরের সাথে কোনো পরীক্ষার্থীর তথ্য পাওয়া যায়নি।
            </p>
            <p className="mt-2 text-sm text-muted-foreground">অনুগ্রহ করে অফিসে যোগাযোগ করুন।</p>
          </div>
        ) : (
          <>
            <section className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <CandidatePhoto path={c.photo_url} name={c.name} size={80} />
                <p className="min-w-0 break-words text-xl font-bold uppercase">{c.name}</p>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <Info k="পাসপোর্ট নং" v={c.passport_no} />
                <Info k="ট্রেড" v={c.occupation_id ? data.occ[c.occupation_id] : null} />
                <Info k="টিটিসি" v={c.ttc_id ? data.ttc[c.ttc_id] : null} />
              </dl>
            </section>

            {fee > 0 && (
              <PaymentBox
                candidateId={c.id}
                fee={fee}
                paid={paid}
                due={due}
                instructions={data.instructions}
                payments={data.payments}
              />
            )}

            {data.agent && (
              <section className="rounded-2xl border bg-card p-4 text-sm">
                <p className="font-semibold">আপনার এজেন্ট</p>
                <p className="mt-1">
                  {data.agent.name}
                  {data.agent.code ? ` (${data.agent.code})` : ""} ·{" "}
                  <a className="text-primary" href={`tel:${data.agent.mobile}`}>
                    {data.agent.mobile}
                  </a>
                </p>
              </section>
            )}

            <section className="space-y-3">
              <h2 className="font-semibold">পরীক্ষার ফলাফল</h2>
              {locked ? (
                <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
                  বকেয়া পেমেন্ট পরিশোধ ও অনুমোদনের পর ফলাফল দেখা যাবে।
                </p>
              ) : !(c.result_check_at && new Date(c.result_check_at) <= new Date()) ? (
                <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
                  আপনার রেজাল্ট এখনো প্রকাশ হয়নি। নির্ধারিত সময়ে পুনরায় চেক করুন।
                </p>
              ) : (
                data.exams.length === 0 && (
                  <p className="rounded-2xl border bg-card p-5 text-sm text-muted-foreground">
                    এখনো কোনো পরীক্ষা নেই।
                  </p>
                )
              )}
              {!locked &&
                c.result_check_at &&
                new Date(c.result_check_at) <= new Date() &&
                data.exams.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border bg-card p-4"
                  >
                    <div>
                      <p className="font-medium">
                        {e.occupation_id ? data.occ[e.occupation_id] : e.exam_type}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {fmtDate(e.exam_date)}
                        {e.score != null && ` · নম্বর ${bn(e.score)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${badge[e.result]}`}
                      >
                        {RESULT_LABEL[e.result]}
                      </span>
                      {e.result === "PASS" && (
                        <button
                          onClick={() => setCert(e)}
                          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                        >
                          সার্টিফিকেট
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </section>

            <a
              href="https://svp-international.pacc.sa/applicant-result"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-2xl border bg-card p-4 text-center font-semibold text-primary hover:bg-muted"
            >
              অফিসিয়াল SVP রেজাল্ট যাচাই করুন ↗
            </a>

            <PortalAssistant />
          </>
        )}
      </main>

      {cert && c && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-foreground/50 p-4 print:static print:bg-transparent print:p-0">
          <div className="w-full max-w-2xl">
            <div className="rounded-2xl border-8 border-double border-primary bg-card p-8 text-center sm:p-12 print:rounded-none">
              <p className="text-sm tracking-widest text-muted-foreground">সার্টিফিকেট</p>
              <h2 className="mt-2 text-2xl font-bold text-primary sm:text-3xl">দক্ষতা সনদপত্র</h2>
              <p className="mt-6 text-sm text-muted-foreground">এই মর্মে প্রত্যয়ন করা যাচ্ছে যে</p>
              <p className="mt-2 text-2xl font-bold uppercase">{c.name}</p>
              <p className="mt-4 text-sm leading-relaxed">
                {cert.occupation_id ? data.occ[cert.occupation_id] : cert.exam_type} ট্রেডে{" "}
                {fmtDate(cert.exam_date)} তারিখে অনুষ্ঠিত পরীক্ষায় সফলভাবে উত্তীর্ণ হয়েছেন।
              </p>
              <div className="mt-8 grid grid-cols-2 gap-4 text-xs text-muted-foreground">
                <p>রেজিস্ট্রেশন: {c.registration_no ?? "—"}</p>
                <p>ফল প্রকাশ: {fmtDate(cert.result_date ?? cert.exam_date)}</p>
              </div>
            </div>
            <div className="mt-4 flex justify-center gap-3 print:hidden">
              <button
                onClick={() => window.print()}
                className="rounded-lg bg-primary px-5 py-2 font-semibold text-primary-foreground"
              >
                প্রিন্ট / ডাউনলোড
              </button>
              <button onClick={() => setCert(null)} className="rounded-lg border bg-card px-5 py-2">
                বন্ধ করুন
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Info({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium">{v || "—"}</dd>
    </div>
  );
}

const METHODS: [string, string][] = [
  ["bkash", "বিকাশ"],
  ["nagad", "নগদ"],
  ["rocket", "রকেট"],
  ["bank", "ব্যাংক"],
];
const PAY_STATUS: Record<string, string> = {
  pending: "যাচাই চলছে",
  approved: "অনুমোদিত",
  rejected: "বাতিল",
};

function PaymentBox({
  candidateId,
  fee,
  paid,
  due,
  instructions,
  payments,
}: {
  candidateId: string;
  fee: number;
  paid: number;
  due: number;
  instructions: string;
  payments: PortalData["payments"];
}) {
  const qc = useQueryClient();
  const [method, setMethod] = useState("bkash");
  const [amount, setAmount] = useState(String(due || ""));
  const [sender, setSender] = useState("");
  const [trx, setTrx] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = payments.some((x) => x.status === "pending");
  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const amt = Number(amount);
    if (
      !Number.isFinite(amt) ||
      amt <= 0 ||
      amt > due ||
      Math.abs(Math.round(amt * 100) - amt * 100) > 0.000001
    )
      return alert("সঠিক টাকার পরিমাণ দিন");
    if (sender.trim().length < 3 || trx.trim().length < 4)
      return alert("প্রেরকের নম্বর/হিসাব ও TrxID দিন");
    setBusy(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      setBusy(false);
      return alert("আবার লগইন করুন");
    }
    const { error } = await supabase.from("payments").insert({
      candidate_id: candidateId,
      amount: amt,
      method,
      sender: sender.trim().slice(0, 60),
      trx_id: trx.trim().slice(0, 60),
      created_by: u.user.id,
      status: "pending",
    });
    setBusy(false);
    if (error) return alert("পেমেন্ট জমা দেওয়া যায়নি");
    setTrx("");
    setSender("");
    qc.invalidateQueries({ queryKey: ["portal"] });
  };
  return (
    <section className="space-y-3 rounded-2xl border bg-card p-5">
      <h2 className="font-semibold">পেমেন্ট</h2>
      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded-xl bg-muted p-2">
          মোট ফি
          <br />
          <b>৳{bn(fee)}</b>
        </div>
        <div className="rounded-xl bg-muted p-2">
          পরিশোধিত
          <br />
          <b>৳{bn(paid)}</b>
        </div>
        <div className="rounded-xl bg-muted p-2">
          বকেয়া
          <br />
          <b>৳{bn(due)}</b>
        </div>
      </div>
      {due > 0 && (
        <>
          {instructions && (
            <p className="whitespace-pre-line rounded-xl border p-3 text-sm">{instructions}</p>
          )}
          {pending ? (
            <p className="text-sm text-muted-foreground">আপনার পেমেন্ট যাচাই চলছে।</p>
          ) : (
            <form onSubmit={submit} className="space-y-2">
              <div className="grid grid-cols-4 gap-2">
                {METHODS.map(([k, l]) => (
                  <button
                    type="button"
                    key={k}
                    onClick={() => setMethod(k)}
                    className={`rounded-lg border px-2 py-2 text-sm ${method === k ? "border-primary bg-primary/15 font-semibold" : ""}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <input
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                inputMode="numeric"
                placeholder="টাকার পরিমাণ"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              />
              <input
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                placeholder={
                  method === "bank" ? "প্রেরকের হিসাবের নাম/নম্বর" : "যে নম্বর থেকে পাঠিয়েছেন"
                }
                value={sender}
                onChange={(e) => setSender(e.target.value)}
              />
              <input
                className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
                placeholder="Transaction ID / রেফারেন্স"
                value={trx}
                onChange={(e) => setTrx(e.target.value)}
              />
              <button
                disabled={busy}
                className="w-full rounded-lg bg-primary py-2 font-semibold text-primary-foreground"
              >
                {busy ? "জমা হচ্ছে..." : "পেমেন্ট জমা দিন"}
              </button>
            </form>
          )}
        </>
      )}
      {payments.length > 0 && (
        <ul className="space-y-1 text-sm">
          {payments.map((x) => (
            <li key={x.id} className="flex justify-between border-t pt-1">
              <span>
                ৳{bn(Number(x.amount))} · {x.trx_id}
              </span>
              <span>{PAY_STATUS[x.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
