import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, RefreshCw, Wallet, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/app/ui-bits";
import { requestWalletDeposit } from "@/lib/wallet";
import { checkWalletSetup } from "@/lib/wallet.functions";
import { RspayDepositForm, RspayDepositRecords } from "@/components/app/RspayDeposits";

type Transaction = {
  id: string;
  user_id: string;
  type: string;
  amount: number;
  balance_after: number;
  reference: string | null;
  note: string | null;
  created_at: string;
};

type Deposit = {
  id: string;
  user_id: string;
  amount: number;
  method: string;
  reference: string | null;
  note: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  review_note: string | null;
  provider?: string;
};

type Profile = { id: string; full_name: string | null; email: string | null };

const METHODS = [
  { value: "bkash", label: "bKash" },
  { value: "nagad", label: "Nagad" },
  { value: "rocket", label: "Rocket" },
  { value: "bank", label: "Bank transfer" },
  { value: "cash", label: "Cash" },
];

function taka(value: number): string {
  return `৳${Number(value ?? 0).toLocaleString("en-BD", { maximumFractionDigits: 2 })}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function typeLabel(type: string): string {
  if (type === "deposit") return "Deposit";
  if (type === "booking_fee") return "SVP booking fee";
  return "Adjustment";
}

export function WalletPanel() {
  const queryClient = useQueryClient();
  const [userId, setUserId] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bkash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [adjustUser, setAdjustUser] = useState("");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustNote, setAdjustNote] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
      if (!data.user) return;
      const roles = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
      const list = (roles.data ?? []).map((row) => row.role);
      setIsStaff(list.includes("admin") || list.includes("staff"));
      setIsAdmin(list.includes("admin"));
    })();
  }, []);

  const balanceQuery = useQuery({
    queryKey: ["wallet-balance", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wallet_my_balance");
      if (error) throw error;
      return Number(data ?? 0);
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const transactionsQuery = useQuery({
    queryKey: ["wallet-transactions", userId, isStaff],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Transaction[]> => {
      const { data, error } = await supabase
        .from("wallet_transactions")
        .select("id, user_id, type, amount, balance_after, reference, note, created_at")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as Transaction[];
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const depositsQuery = useQuery({
    queryKey: ["wallet-deposits", userId, isStaff],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Deposit[]> => {
      const { data, error } = await supabase
        .from("wallet_deposits")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Deposit[];
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const profilesQuery = useQuery({
    queryKey: ["wallet-profiles", userId],
    enabled: isStaff,
    queryFn: async (): Promise<Profile[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as Profile[];
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const accountsQuery = useQuery({
    queryKey: ["wallet-accounts", userId],
    enabled: isStaff,
    queryFn: async (): Promise<{ user_id: string; balance: number }[]> => {
      const { data, error } = await supabase
        .from("wallet_accounts")
        .select("user_id, balance")
        .order("balance", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as { user_id: string; balance: number }[];
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const setupQuery = useQuery({
    queryKey: ["wallet-setup"],
    queryFn: () => checkWalletSetup({ data: {} }),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const balance = balanceQuery.data ?? 0;
  const transactions = useMemo(() => transactionsQuery.data ?? [], [transactionsQuery.data]);
  const deposits = useMemo(() => depositsQuery.data ?? [], [depositsQuery.data]);
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data]);
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const setupIssue = [balanceQuery.error, transactionsQuery.error, depositsQuery.error].some(
    (error) =>
      error instanceof Error &&
      /schema cache|could not find the table|does not exist/i.test(error.message),
  );
  const missingTables = setupQuery.data?.missing ?? [];
  const setupBlocked = missingTables.length > 0 || setupIssue;
  const profileName = useMemo(() => {
    const map = new Map<string, string>();
    for (const profile of profiles) {
      map.set(profile.id, profile.full_name ?? profile.email ?? profile.id);
    }
    return map;
  }, [profiles]);

  const filteredAccounts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return accounts;
    return accounts.filter((entry) =>
      (profileName.get(entry.user_id) ?? entry.user_id).toLowerCase().includes(needle),
    );
  }, [accounts, profileName, search]);

  const pendingDeposits = deposits.filter(
    (entry) => entry.status === "pending" && entry.provider !== "rspay",
  );
  const totalDeposit = transactions
    .filter((entry) => entry.type === "deposit")
    .reduce((sum, entry) => sum + entry.amount, 0);
  const totalFees = transactions
    .filter((entry) => entry.type === "booking_fee")
    .reduce((sum, entry) => sum + Math.abs(entry.amount), 0);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["wallet-balance"] });
    void transactionsQuery.refetch();
    void depositsQuery.refetch();
    if (isStaff) {
      void profilesQuery.refetch();
      void accountsQuery.refetch();
    }
    void setupQuery.refetch();
  };

  const requestDeposit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setMessage({ tone: "error", text: "সঠিক টাকার পরিমাণ লিখুন।" });
      return;
    }
    if (!userId) {
      setMessage({ tone: "error", text: "লগইন সেশন পাওয়া যায়নি — আবার লগইন করুন।" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await requestWalletDeposit({
        amount: value,
        method,
        reference: reference.trim() || null,
        note: note.trim() || null,
      });
      if (!result.ok) {
        setMessage({ tone: "error", text: `ডিপোজিট রিকোয়েস্ট জমা হয়নি: ${result.message}` });
        return;
      }
      setAmount("");
      setReference("");
      setNote("");
      setMessage({
        tone: "ok",
        text: "ডিপোজিট রিকোয়েস্ট জমা হয়েছে — admin approve করলে ব্যালেন্স যোগ হবে।",
      });
      void depositsQuery.refetch();
    } catch (error) {
      setMessage({
        tone: "error",
        text:
          error instanceof Error && error.message
            ? `ডিপোজিট রিকোয়েস্ট জমা হয়নি: ${error.message}`
            : "ডিপোজিট রিকোয়েস্ট জমা করা যায়নি।",
      });
    } finally {
      setBusy(false);
    }
  };

  const reviewDeposit = async (deposit: Deposit, approve: boolean) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("wallet_review_deposit", {
        _deposit_id: deposit.id,
        _approve: approve,
        _note: approve ? "Approved" : "Rejected",
      });
      if (error) throw error;
      const result = data as { ok?: boolean; reason?: string } | null;
      if (result && result.ok === false) {
        setMessage({ tone: "error", text: `ডিপোজিট ${result.reason ?? "review"} হয়নি।` });
      } else {
        setMessage({
          tone: "ok",
          text: approve
            ? "ডিপোজিট approve হয়েছে, ব্যালেন্স যোগ হয়েছে।"
            : "ডিপোজিট reject হয়েছে।",
        });
      }
      refresh();
    } catch {
      setMessage({ tone: "error", text: "ডিপোজিট review করা যায়নি।" });
    } finally {
      setBusy(false);
    }
  };

  const adjustBalance = async () => {
    const value = Number(adjustAmount);
    if (!adjustUser || !Number.isFinite(value) || value === 0) {
      setMessage({
        tone: "error",
        text: "User ও সঠিক amount নির্বাচন করুন (negative হলে কাটা যাবে)।",
      });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("wallet_admin_adjust", {
        _user_id: adjustUser,
        _amount: value,
        _note: adjustNote.trim() || "Admin adjustment",
      });
      if (error) throw error;
      const result = data as { ok?: boolean; reason?: string } | null;
      if (result && result.ok === false) {
        setMessage({ tone: "error", text: `Adjustment হয়নি: ${result.reason ?? "error"}` });
      } else {
        setMessage({ tone: "ok", text: "ব্যালেন্স adjust হয়েছে।" });
        setAdjustAmount("");
        setAdjustNote("");
        refresh();
      }
    } catch {
      setMessage({ tone: "error", text: "ব্যালেন্স adjust করা যায়নি।" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold">ব্যালেন্স ও ডিপোজিট</h1>
          <p className="text-xs text-muted-foreground">
            প্রতি SVP বুকিং ৳100 — ব্যালেন্স থেকে কাটা হবে।
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={busy}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border bg-card p-4">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" /> বর্তমান ব্যালেন্স
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-400">{taka(balance)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">মোট ডিপোজিট</p>
          <p className="mt-1 text-2xl font-bold">{taka(totalDeposit)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">বুকিং ফি (মোট)</p>
          <p className="mt-1 text-2xl font-bold text-amber-400">{taka(totalFees)}</p>
        </div>
        <div className="rounded-2xl border bg-card p-4">
          <p className="text-xs text-muted-foreground">Pending deposit</p>
          <p className="mt-1 text-2xl font-bold text-sky-400">{pendingDeposits.length}</p>
        </div>
      </div>

      {setupBlocked && (
        <p className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950">
          Wallet টেবিল এখনো database-এ তৈরি হয়নি
          {missingTables.length > 0 ? ` (missing: ${missingTables.join(", ")})` : ""} — Supabase
          Dashboard → SQL Editor-এ{" "}
          <code className="font-mono text-[11px]">supabase/manual/apply_wallet_system.sql</code>{" "}
          ফাইলটি Run করুন, তারপর Refresh চাপুন।
        </p>
      )}

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`rounded-lg border p-3 text-sm ${
            message.tone === "error"
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-emerald-300/60 bg-emerald-500/10 text-emerald-300"
          }`}
        >
          {message.text}
        </p>
      )}

      <RspayDepositForm userId={userId} />
      {userId && <RspayDepositRecords userId={userId} />}

      {isAdmin && (
        <section className="card-surface space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold">সব ইউজারের ব্যালেন্স (admin only)</h2>
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="নাম / ইমেইল দিয়ে খুঁজুন"
              className="h-9 w-full sm:w-64"
            />
          </div>
          {filteredAccounts.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
              কোনো wallet account নেই।
            </p>
          ) : (
            <div className="space-y-2">
              {filteredAccounts.map((entry) => (
                <div
                  key={entry.user_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/40 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">
                      {profileName.get(entry.user_id) ?? entry.user_id}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{entry.user_id}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-emerald-400">
                      {taka(entry.balance)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setAdjustUser(entry.user_id);
                        setAdjustAmount("");
                        setAdjustNote("");
                      }}
                    >
                      Adjust
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="card-surface space-y-3 p-4 sm:p-5">
        <h2 className="text-lg font-bold">ম্যানুয়াল ডিপোজিট রিকোয়েস্ট</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="টাকার পরিমাণ *">
            <Input
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
              placeholder="যেমন 500"
            />
          </Field>
          <Field label="মাধ্যম">
            <NativeSelect value={method} onChange={(event) => setMethod(event.target.value)}>
              {METHODS.map((entry) => (
                <option key={entry.value} value={entry.value}>
                  {entry.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Transaction ID / রেফারেন্স">
            <Input
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              placeholder="bKash TrxID / bank ref"
            />
          </Field>
          <Field label="নোট">
            <Input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="ঐচ্ছিক"
            />
          </Field>
        </div>
        <Button
          type="button"
          onClick={() => void requestDeposit()}
          disabled={busy || !userId || setupBlocked}
        >
          {busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
          ডিপোজিট রিকোয়েস্ট পাঠান
        </Button>
      </section>

      {isStaff && (
        <section className="card-surface space-y-3 p-4 sm:p-5">
          <h2 className="text-lg font-bold">Admin: ডিপোজিট approve</h2>
          {pendingDeposits.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
              কোনো pending ডিপোজিট নেই।
            </p>
          ) : (
            <div className="space-y-2">
              {pendingDeposits.map((deposit) => (
                <div
                  key={deposit.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/40 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      {taka(deposit.amount)} · {deposit.method}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {profileName.get(deposit.user_id) ?? deposit.user_id}
                      {deposit.reference ? ` · ${deposit.reference}` : ""}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatDateTime(deposit.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void reviewDeposit(deposit, true)}
                      disabled={busy}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => void reviewDeposit(deposit, false)}
                      disabled={busy}
                    >
                      <X className="mr-1 h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2 border-t pt-3">
            <h3 className="text-sm font-semibold">ম্যানুয়াল ব্যালেন্স অ্যাডজাস্ট</h3>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <NativeSelect
                value={adjustUser}
                onChange={(event) => setAdjustUser(event.target.value)}
              >
                <option value="">Select user</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.full_name ?? profile.email ?? profile.id}
                  </option>
                ))}
              </NativeSelect>
              <Input
                value={adjustAmount}
                onChange={(event) => setAdjustAmount(event.target.value)}
                inputMode="decimal"
                placeholder="+500 / -100"
              />
              <Input
                value={adjustNote}
                onChange={(event) => setAdjustNote(event.target.value)}
                placeholder="Note"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void adjustBalance()}
                disabled={busy}
              >
                Adjust
              </Button>
            </div>
          </div>
        </section>
      )}

      <section className="card-surface space-y-3 p-4 sm:p-5">
        <h2 className="text-lg font-bold">লেনদেন</h2>
        {transactions.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            এখনো কোনো লেনদেন নেই।
          </p>
        ) : (
          <div className="space-y-2">
            {transactions.map((entry) => (
              <div
                key={entry.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/40 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{typeLabel(entry.type)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {isStaff ? `${profileName.get(entry.user_id) ?? entry.user_id} · ` : ""}
                    {entry.reference ? `#${entry.reference}` : formatDateTime(entry.created_at)}
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-sm font-bold ${
                      entry.amount >= 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {entry.amount >= 0 ? "+" : ""}
                    {taka(entry.amount)}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    ব্যালেন্স {taka(entry.balance_after)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card-surface space-y-3 p-4 sm:p-5">
        <h2 className="text-lg font-bold">ডিপোজিট হিস্ট্রি</h2>
        {deposits.length === 0 ? (
          <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            কোনো ডিপোজিট রিকোয়েস্ট নেই।
          </p>
        ) : (
          <div className="space-y-2">
            {deposits.map((deposit) => (
              <div
                key={deposit.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-background/40 p-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {taka(deposit.amount)} · {deposit.method}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {isStaff ? `${profileName.get(deposit.user_id) ?? deposit.user_id} · ` : ""}
                    {formatDateTime(deposit.created_at)}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                    deposit.status === "approved"
                      ? "border-emerald-300/60 bg-emerald-500/15 text-emerald-300"
                      : deposit.status === "rejected"
                        ? "border-rose-300/60 bg-rose-500/15 text-rose-300"
                        : "border-amber-300/60 bg-amber-500/15 text-amber-300"
                  }`}
                >
                  {deposit.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
