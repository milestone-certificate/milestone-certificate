import { useEffect, useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Check,
  ChevronRight,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rspayDepositsQ, walletPaymentProfilesQ } from "@/lib/data";
import {
  paymentAmount,
  paymentStatusLabel,
  rspayMethods,
  rspayMethodNames as METHODS,
  type RspayMethod,
} from "@/lib/rspay";
import { checkRspayDeposit, getRspayAvailability, startRspayDeposit } from "@/lib/rspay.functions";

const QUICK_AMOUNTS = [500, 1000, 2000, 3000, 5000];
const formatAmount = (value: number) => value.toLocaleString("en-BD", { maximumFractionDigits: 2 });

export function RspayDepositForm({ userId }: { userId: string | null }) {
  const formId = useId();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<RspayMethod | null>("bkash");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const intent = useRef<{ key: string; fingerprint: string } | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const availability = useQuery({
    queryKey: ["rspay-availability", userId],
    enabled: !!userId,
    queryFn: () => getRspayAvailability(),
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
  });
  const enabledMethods = availability.data?.methods ?? [];
  useEffect(() => {
    const methods = availability.data?.methods ?? [];
    if (!method || !methods.includes(method)) setMethod(methods[0] ?? null);
  }, [availability.data?.methods, method]);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("payment");
    if (id && /^[a-f0-9-]{36}$/i.test(id)) setPaymentId(id);
  }, []);
  const start = async () => {
    if (
      busy ||
      !userId ||
      !method ||
      availability.data?.enabled !== true ||
      !enabledMethods.includes(method)
    )
      return;
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
  const selected = method ? METHODS[method] : null;
  const parsedAmount = paymentAmount.safeParse(Number(amount));
  if (!userId) return null;
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
      <section aria-labelledby={`${formId}-title`} className="space-y-4">
        <div className="flex items-center gap-3 px-1">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <WalletCards className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 id={`${formId}-title`} className="text-xl font-bold">
              অনলাইন ডিপোজিট
            </h2>
            <p className="text-xs text-muted-foreground">মাধ্যম ও টাকার পরিমাণ বেছে নিন</p>
          </div>
        </div>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <fieldset className="card-surface min-w-0 p-4 sm:p-5" disabled={busy}>
            <legend className="sr-only">পেমেন্ট মাধ্যম</legend>
            <div className="mb-4 flex items-center gap-2.5" aria-hidden="true">
              <span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                1
              </span>
              <h3 className="font-semibold">পেমেন্ট মাধ্যম</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-4">
              {rspayMethods.map((m) => (
                <label key={m} className="relative min-w-0 cursor-pointer">
                  <input
                    className="peer sr-only"
                    type="radio"
                    name={`${formId}-method`}
                    value={m}
                    disabled={!enabledMethods.includes(m)}
                    checked={method === m}
                    onChange={() => {
                      setMethod(m);
                      setMessage("");
                    }}
                  />
                  <span className="relative flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border border-border bg-background/30 px-2 py-4 transition-colors hover:border-primary/50 peer-checked:border-primary peer-checked:bg-primary/8 peer-checked:ring-1 peer-checked:ring-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-primary peer-disabled:cursor-not-allowed peer-disabled:opacity-50 sm:min-h-36">
                    {availability.data && !enabledMethods.includes(m) && (
                      <span className="absolute left-2 top-2 text-[10px] text-muted-foreground">
                        বন্ধ
                      </span>
                    )}
                    {method === m && (
                      <span
                        className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                        aria-hidden="true"
                      >
                        <Check className="size-3.5" strokeWidth={3} />
                      </span>
                    )}
                    <img
                      src={`/images/payments/${m}.svg`}
                      alt=""
                      width={48}
                      height={48}
                      className="size-12 rounded-xl"
                    />
                    <span className="text-sm font-semibold">{METHODS[m].name}</span>
                    <span className="text-[10px] font-semibold tracking-[0.14em] text-muted-foreground">
                      {METHODS[m].brand.toUpperCase()}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="card-surface space-y-4 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor={`${formId}-amount`}
                className="flex items-center gap-2.5 font-semibold"
              >
                <span
                  className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary"
                  aria-hidden="true"
                >
                  2
                </span>
                জমার পরিমাণ
              </label>
              <span className="text-[10px] font-semibold tracking-widest text-muted-foreground">
                BDT
              </span>
            </div>
            <div className="grid grid-cols-5 gap-1.5 sm:gap-2" aria-label="দ্রুত পরিমাণ নির্বাচন">
              {QUICK_AMOUNTS.map((value) => (
                <button
                  type="button"
                  key={value}
                  disabled={busy}
                  aria-pressed={amount !== "" && Number(amount) === value}
                  onClick={() => {
                    setAmount(String(value));
                    setMessage("");
                  }}
                  className={`min-h-11 rounded-xl border px-1 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait sm:text-sm ${amount !== "" && Number(amount) === value ? "border-primary bg-primary/10 text-primary" : "border-border bg-background/20 text-foreground hover:border-primary/50 hover:bg-primary/5"}`}
                >
                  {formatAmount(value)}
                </button>
              ))}
            </div>
            <div className="relative">
              <span
                className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-xl text-muted-foreground"
                aria-hidden="true"
              >
                ৳
              </span>
              <Input
                id={`${formId}-amount`}
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setMessage("");
                }}
                placeholder="অন্য পরিমাণ লিখুন"
                disabled={busy}
                aria-describedby={message ? `${formId}-message` : undefined}
                aria-invalid={Boolean(message) && !parsedAmount.success}
                className="h-14 rounded-xl border-border bg-background/30 pl-10 text-lg font-semibold placeholder:text-sm placeholder:font-normal"
              />
            </div>
            {parsedAmount.success && (
              <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-3 text-sm">
                <span className="text-muted-foreground">ওয়ালেটে জমা হবে</span>
                <strong className="text-lg text-primary">৳{formatAmount(parsedAmount.data)}</strong>
              </div>
            )}
          </div>
          {message && (
            <p
              id={`${formId}-message`}
              role="status"
              className="px-1 text-sm text-muted-foreground"
            >
              {message}
            </p>
          )}
          {!availability.data?.enabled && (
            <p role="status" className="px-1 text-xs text-muted-foreground">
              {availability.isPending
                ? "পেমেন্ট সেবা যাচাই হচ্ছে…"
                : "অনলাইন পেমেন্ট আপাতত বন্ধ আছে।"}
            </p>
          )}
          <Button
            type="submit"
            disabled={busy || availability.data?.enabled !== true || !method}
            className="h-13 w-full rounded-2xl text-sm font-bold shadow-lg shadow-primary/10 sm:text-base"
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <LockKeyhole className="size-4" />
            )}
            {busy
              ? "পেমেন্ট তৈরি হচ্ছে…"
              : selected
                ? `${selected.brand} দিয়ে পেমেন্ট করুন`
                : "পেমেন্ট করুন"}
            {!busy && <ChevronRight className="size-4" />}
          </Button>
          <p className="flex items-center justify-center gap-1.5 px-2 text-center text-[11px] text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
            পেমেন্ট নিশ্চিত হলে ব্যালেন্স যোগ হবে।
          </p>
        </form>
      </section>
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
