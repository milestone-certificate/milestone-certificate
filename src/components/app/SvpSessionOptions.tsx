import { CheckCircle2 } from "lucide-react";
import { formatSvpTimeRange } from "@/lib/svp-time";

export type SvpSessionOption = {
  key: string;
  startAt: string;
  endAt?: string | null;
  center: string | null;
  city: string | null;
  seats: number | null;
  selected: boolean;
  onSelect: () => void;
};

export function SvpSessionOptions({
  views,
  disabled = false,
}: {
  views: SvpSessionOption[];
  disabled?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-2 sm:grid-cols-2" role="group" aria-label="Test centers">
      {views.map((view) => {
        const time = formatSvpTimeRange(view.startAt, view.endAt);
        return (
          <button
            key={view.key}
            type="button"
            aria-pressed={view.selected}
            disabled={disabled || view.seats === 0}
            onClick={view.onSelect}
            className={`min-w-0 rounded-xl border p-3 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              view.selected ? "border-primary bg-primary-soft" : "bg-card hover:border-primary/50"
            }`}
          >
            <span className="flex items-start justify-between gap-2">
              <span className="min-w-0 whitespace-normal font-semibold [overflow-wrap:anywhere]">
                {view.center || "—"}
              </span>
              {view.selected && (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              )}
            </span>
            {view.city && (
              <span className="mt-1 block whitespace-normal text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {view.city}
              </span>
            )}
            <span className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <span>
                <span className="block text-xs text-muted-foreground">Time</span>
                <span className="block font-medium">{time}</span>
              </span>
              <span>
                <span className="block text-xs text-muted-foreground">Seats</span>
                <span className="block font-medium">{view.seats ?? "—"}</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
