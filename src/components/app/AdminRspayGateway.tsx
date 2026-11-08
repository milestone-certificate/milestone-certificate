import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, CreditCard, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { rspayGatewayAuditQ, rspayGatewaySettingsQ } from "@/lib/data";
import { getAdminRspayRuntime, setAdminRspayControl } from "@/lib/rspay.functions";
import {
  rspayMethodNames,
  rspayMethods,
  type RspayControlName,
  type RspayMethod,
} from "@/lib/rspay";

export function AdminRspayGateway({ userId }: { userId: string }) {
  const id = useId();
  const client = useQueryClient();
  const [notice, setNotice] = useState("");
  const settings = useQuery(rspayGatewaySettingsQ(userId));
  const audit = useQuery(rspayGatewayAuditQ(userId));
  const runtime = useQuery({
    queryKey: ["rspay-admin-runtime", userId],
    queryFn: () => getAdminRspayRuntime(),
    retry: false,
    staleTime: 15_000,
  });
  const ready = Boolean(
    runtime.data?.serverEnabled && runtime.data.configured && runtime.data.storageReady,
  );
  const config = settings.data;
  const effectiveOn = ready && config?.enabled && rspayMethods.some((m) => config[m]);
  const save = useMutation({
    mutationFn: (data: { control: RspayControlName; enabled: boolean }) =>
      setAdminRspayControl({ data }),
    onMutate: () => setNotice(""),
    onSuccess: async (result) => {
      setNotice(result.message);
      if (!result.ok) return;
      await Promise.all([
        client.invalidateQueries({ queryKey: ["rspay-admin-settings"] }),
        client.invalidateQueries({ queryKey: ["rspay-admin-audit"] }),
        client.invalidateQueries({ queryKey: ["rspay-availability"] }),
      ]);
    },
    onError: () => setNotice("সেটিংস সংরক্ষণ হয়নি। আবার চেষ্টা করুন।"),
  });
  const refresh = () => {
    void settings.refetch();
    void audit.refetch();
    void runtime.refetch();
  };
  return (
    <section className="card-surface mb-4 space-y-4 p-4 sm:p-5" aria-labelledby={`${id}-title`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <CreditCard className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Payment gateway
            </p>
            <h2 id={`${id}-title`} className="text-lg font-bold">
              RSPay Gateway
            </h2>
          </div>
        </div>
        <span
          className={`rounded-full border px-3 py-1 text-xs font-semibold ${effectiveOn ? "border-primary/30 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
        >
          {effectiveOn ? "চালু" : "বন্ধ"}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/30 p-4">
        <div>
          <label htmlFor={`${id}-gateway`} className="font-semibold">
            Gateway চালু / বন্ধ
          </label>
          <p className="mt-1 text-xs text-muted-foreground">নতুন অনলাইন ডিপোজিট নিয়ন্ত্রণ করুন</p>
        </div>
        <Switch
          id={`${id}-gateway`}
          aria-label="RSPay gateway"
          checked={config?.enabled ?? false}
          disabled={!config || save.isPending || (!ready && !config.enabled)}
          onCheckedChange={(enabled) => save.mutate({ control: "enabled", enabled })}
        />
      </div>
      {settings.isPending || runtime.isPending ? (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          Gateway settings লোড হচ্ছে…
        </p>
      ) : settings.isError || runtime.isError ? (
        <p role="status" className="text-xs text-muted-foreground">
          Gateway settings পাওয়া যাচ্ছে না। Refresh করে চেষ্টা করুন।
        </p>
      ) : !ready ? (
        <p role="status" className="text-xs text-muted-foreground">
          Server-এ gateway activation বন্ধ বা setup অসম্পূর্ণ। Method settings সংরক্ষণ করতে পারবেন।
        </p>
      ) : config?.enabled && !rspayMethods.some((m) => config[m]) ? (
        <p role="status" className="text-xs text-muted-foreground">
          সব payment method বন্ধ আছে। ডিপোজিট চালু করতে অন্তত একটি মাধ্যম চালু করুন।
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {rspayMethods.map((method) => (
          <div key={method} className="flex min-w-0 items-center gap-3 rounded-xl border p-3">
            <img
              src={`/images/payments/${method}.svg`}
              alt=""
              width={36}
              height={36}
              className="size-9 rounded-lg"
            />
            <label htmlFor={`${id}-${method}`} className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{rspayMethodNames[method].brand}</span>
              <span className="block text-xs text-muted-foreground">
                {config?.[method] ? "চালু" : "বন্ধ"}
              </span>
            </label>
            <Switch
              id={`${id}-${method}`}
              aria-label={`${rspayMethodNames[method].brand} payment method`}
              checked={config?.[method] ?? false}
              disabled={!config || save.isPending}
              onCheckedChange={(enabled) => save.mutate({ control: method, enabled })}
            />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />
          বন্ধ করলেও আগের payment-এর status আপডেট হবে
        </p>
        <Button
          variant="ghost"
          size="sm"
          disabled={save.isPending || settings.isFetching || runtime.isFetching}
          onClick={refresh}
        >
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {!!audit.data?.length && (
        <details className="border-t pt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">সাম্প্রতিক পরিবর্তন</summary>
          <div className="mt-2 space-y-2">
            {audit.data.map((row) => (
              <p key={row.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {row.control === "enabled"
                    ? "Gateway"
                    : (rspayMethodNames[row.control as RspayMethod]?.brand ?? row.control)}
                  : {row.old_value ? "চালু" : "বন্ধ"} → {row.new_value ? "চালু" : "বন্ধ"}
                </span>
                <span className="flex items-center gap-1">
                  <Clock3 className="size-3" />
                  {new Date(row.created_at).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })}
                </span>
              </p>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
