import { Button } from "@/components/ui/button";
import type { ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { RESULT_LABEL, fmtDate, type ExamResult } from "@/lib/data";

const resultStyle: Record<ExamResult, string> = {
  PENDING: "bg-warning-soft text-warning",
  PASS: "bg-success-soft text-success",
  FAIL: "bg-danger-soft text-danger",
  ABSENT: "bg-muted text-muted-foreground",
  CANCELLED: "bg-info-soft text-info",
};

export function ResultBadge({ result, date }: { result: ExamResult; date?: string | null }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        resultStyle[result],
      )}
    >
      {RESULT_LABEL[result]}
      {date && <span className="font-normal opacity-80">· {fmtDate(date)}</span>}
    </span>
  );
}

export function StatCard({
  label,
  value,
  icon,
  tone = "primary",
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  tone?: "primary" | "success" | "danger" | "warning" | "info" | "muted";
}) {
  const tones = {
    primary: "bg-primary-soft text-primary",
    success: "bg-success-soft text-success",
    danger: "bg-danger-soft text-danger",
    warning: "bg-warning-soft text-warning",
    info: "bg-info-soft text-info",
    muted: "bg-muted text-muted-foreground",
  };
  return (
    <div className="card-surface flex items-center gap-3 p-4">
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          tones[tone],
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="font-display text-2xl font-bold leading-tight">{value}</div>
      </div>
    </div>
  );
}

export function NativeSelect({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-md border border-input bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export function ListLoadStatus({
  query,
}: {
  query: {
    isLoading: boolean;
    isLoadingError: boolean;
    isFetching: boolean;
    refetch: () => Promise<unknown>;
  };
}) {
  if (query.isLoading) return <Empty>লোড হচ্ছে...</Empty>;
  return (
    <Empty>
      <p role="alert">তালিকা লোড করা যায়নি।</p>
      <Button
        className="mt-3"
        variant="outline"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        আবার চেষ্টা করুন
      </Button>
    </Empty>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
