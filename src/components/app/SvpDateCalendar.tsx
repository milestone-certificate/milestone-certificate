import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SvpDateOption = { date: string; seats?: number | null };

type Props = {
  options: SvpDateOption[];
  value: string;
  loading?: boolean;
  disabled?: boolean;
  onSelect: (date: string) => void;
  month?: string;
  monthOptions?: Array<{ value: string; label: string }>;
  onMonthChange?: (month: string) => void;
};

function formatDate(date: string) {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Click-to-open exam date calendar. Dates SVP reports as available are highlighted;
 * choosing one closes the panel, and clicking the field opens it again.
 */
export function SvpDateCalendar({
  options,
  value,
  loading,
  disabled,
  onSelect,
  month,
  monthOptions,
  onMonthChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  const months = useMemo(() => {
    const groups = new Map<string, SvpDateOption[]>();
    for (const option of options) {
      const key = option.date.slice(0, 7);
      const list = groups.get(key) ?? [];
      list.push(option);
      groups.set(key, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [options]);

  const monthLabel = (key: string) => {
    const parsed = new Date(`${key}-01T12:00:00`);
    return Number.isNaN(parsed.getTime())
      ? key
      : parsed.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  };

  return (
    <div className="relative space-y-1" ref={boxRef}>
      <span className="text-sm font-medium">Exam date *</span>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Exam date"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-card px-3 text-sm disabled:opacity-60"
      >
        <span className="flex items-center gap-2 truncate">
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
          {value ? (
            formatDate(value)
          ) : (
            <span className="text-muted-foreground">
              {loading ? "Loading available dates…" : "Select an available date"}
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 opacity-60 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Available exam dates"
          className="absolute z-30 mt-1 w-full space-y-3 rounded-xl border bg-popover p-3 shadow-lg"
        >
          {onMonthChange && monthOptions && (
            <select
              aria-label="Month to check"
              value={month}
              onChange={(event) => onMonthChange(event.target.value)}
              disabled={loading}
              className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
            >
              {monthOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
          {options.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {loading ? "Loading available dates…" : "No dates with free seats for this city."}
            </p>
          ) : (
            months.map(([key, list]) => (
              <div key={key} className="space-y-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {monthLabel(key)}
                </p>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                  {list.map((option) => {
                    const active = option.date === value;
                    return (
                      <button
                        key={option.date}
                        type="button"
                        disabled={loading || disabled}
                        onClick={() => {
                          onSelect(option.date);
                          setOpen(false);
                        }}
                        className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-success/40 bg-success-soft text-success hover:border-success"
                        }`}
                      >
                        <span className="flex items-center justify-center gap-1">
                          {active && <Check className="h-3 w-3" />}
                          {formatDate(option.date)}
                        </span>
                        {option.seats !== null && option.seats !== undefined && (
                          <span className="mt-0.5 block text-[10px] font-normal opacity-80">
                            {option.seats} seat{option.seats === 1 ? "" : "s"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
          <div className="flex items-center justify-between gap-2 border-t pt-2">
            <p className="text-[11px] text-muted-foreground">
              Green dates have seats available on SVP.
            </p>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
