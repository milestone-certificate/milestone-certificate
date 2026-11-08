import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/app/ui-bits";
import { rspayDepositsQ, walletPaymentProfilesQ } from "@/lib/data";
import { paymentAmount, paymentStatusLabel, rspayMethods } from "@/lib/rspay";
import { checkRspayDeposit, getRspayAvailability, startRspayDeposit } from "@/lib/rspay.functions";

export function RspayDepositForm({ userId }: { userId: string | null }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof rspayMethods)[number]>("bkash");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const intent = useRef<{ key: string; fingerprint: string } | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const availability = useQuery({
    queryKey: ["rspay-availability", userId],
    enabled: !!userId,
    queryFn: () => getRspayAvailability(),
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("payment");
    if (id && /^[a-f0-9-]{36}$/i.test(id)) setPaymentId(id);
  }, []);
  const start = async () => {
    const value = paymentAmount.safeParse(Number(amount));
    if (!value.success) {
      setMessage("সঠিক টাকার পরিমাণ লিখুন (সর্বোচ্চ ১০ লক্ষ টাকা)।");
      return;
    }
    const fingerprint = `${userId}:${value.data}:${method}`;
    if (intent.current?.fingerprint !== fingerprint)
      intent.current = { key: crypto.randomUUID(), fingerprint };
    setBusy(true);
    setMessage("");
    try {
      const result = await startRspayDeposit({
        data: { requestId: intent.current!.key, amount: value.data, method },
      });
      if (!result.ok) {
        setMessage(result.message);
        if ("id" in result && typeof result.id === "string") setPaymentId(result.id);
        return;
      }
      setPaymentId(result.id);
      if (result.url) window.location.assign(result.url);
      else setMessage("ডিপোজিটের অবস্থা নিচে দেখুন।");
    } catch {
      setMessage("পেমেন্ট শুরু করা যাচ্ছে না। আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {paymentId && userId && (
        <RspayPaymentStatus
          id={paymentId}
          userId={userId}
          onTerminal={() => {
            intent.current = null;
          }}
        />
      )}
      {availability.data?.enabled && (
        <section className="card-surface space-y-3 p-4 sm:p-5">
          <h2 className="text-lg font-bold">অনলাইন ডিপোজিট</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="টাকার পরিমাণ *">
              <Input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="যেমন 500"
                disabled={busy}
              />
            </Field>
            <Field label="মাধ্যম">
              <NativeSelect
                value={method}
                disabled={busy}
                onChange={(e) => setMethod(e.target.value as typeof method)}
              >
                {rspayMethods.map((m) => (
                  <option key={m} value={m}>
                    {m === "bkash" ? "bKash" : m[0].toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {message && (
            <p role="status" className="text-sm text-muted-foreground">
              {message}
            </p>
          )}
          <Button onClick={() => void start()} disabled={busy || !userId}>
            {busy && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />} পেমেন্ট করুন
          </Button>
        </section>
      )}
    </>
  );
}

function RspayPaymentStatus({
  id,
  userId,
  onTerminal,
}: {
  id: string;
  userId: string;
  onTerminal: () => void;
}) {
  const client = useQueryClient();
  const terminalNotified = useRef<string | null>(null);
  const query = useQuery({
    queryKey: ["rspay-payment", userId, id],
    queryFn: () => checkRspayDeposit({ data: { id } }),
    retry: false,
    refetchInterval: (q) =>
      q.state.status === "error" || q.state.data === null
        ? false
        : q.state.data &&
            ["COMPLETED", "FAILED", "LINK_FAILED"].includes(q.state.data.gateway_status ?? "")
          ? false
          : 10_000,
  });
  const status = query.data?.gateway_status;
  useEffect(() => {
    if (
      !status ||
      !["COMPLETED", "FAILED", "LINK_FAILED"].includes(status) ||
      terminalNotified.current === status
    )
      return;
    terminalNotified.current = status;
    for (const key of [
      "wallet-balance",
      "wallet-transactions",
      "wallet-deposits",
      "wallet-accounts",
      "rspay-records",
    ]) {
      void client.invalidateQueries({ queryKey: [key] });
    }
    onTerminal();
  }, [status, client, onTerminal]);
  return (
    <section className="card-surface space-y-2 p-4" aria-live="polite">
      <p className="font-semibold">
        {query.data
          ? paymentStatusLabel(status ?? null)
          : query.isPending
            ? "পেমেন্টের অবস্থা দেখা হচ্ছে…"
            : "পেমেন্টের অবস্থা পাওয়া যাচ্ছে না।"}
      </p>
      {query.data && (
        <p className="break-all text-sm text-muted-foreground">
          ৳{query.data.amount} · {query.data.method} ·{" "}
          {query.data.gateway_transaction_id || query.data.gateway_short_code || id}
        </p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        অবস্থা দেখুন
      </Button>
    </section>
  );
}

/** RLS returns an owner's own records and all records for staff/admin. */
export function RspayDepositRecords({
  userId,
  compact = false,
}: {
  userId: string;
  compact?: boolean;
}) {
  const [page, setPage] = useState(0);
  const query = useQuery(rspayDepositsQ(userId, compact, page));
  const ids = [...new Set((query.data ?? []).map((d) => d.user_id))].sort();
  const profiles = useQuery(walletPaymentProfilesQ(userId, ids));
  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name || p.email || p.id]));
  if (!query.data?.length && page === 0) return null;
  return (
    <section className="card-surface space-y-3 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">অনলাইন ডিপোজিট রেকর্ড</h2>
        {compact && (
          <Link to="/wallet" className="text-sm text-primary">
            সব দেখুন
          </Link>
        )}
      </div>
      {query.data?.map((d) => (
        <div
          key={d.id}
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
        >
          <div className="min-w-0 space-y-1">
            <p className="font-semibold">
              ৳{d.amount.toLocaleString("en-BD")} · {d.method}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              {d.gateway_short_code || d.id}
              {d.gateway_transaction_id ? ` · TrxID: ${d.gateway_transaction_id}` : ""}
            </p>
            <p className="break-all text-xs text-muted-foreground">
              {names.get(d.user_id) || d.user_id}
            </p>
            <p className="text-xs text-muted-foreground">
              {new Date(d.created_at).toLocaleString("en-GB")}
            </p>
          </div>
          <span
            className={`text-xs font-semibold ${d.gateway_status === "COMPLETED" ? "text-emerald-400" : "text-muted-foreground"}`}
          >
            {paymentStatusLabel(d.gateway_status)}
          </span>
        </div>
      ))}
      {!compact && (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || query.isFetching}
            onClick={() => setPage((p) => p - 1)}
          >
            আগের
          </Button>
          <span className="text-xs text-muted-foreground">পৃষ্ঠা {page + 1}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={(query.data?.length ?? 0) < 25 || query.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            পরের
          </Button>
        </div>
      )}
    </section>
  );
}
