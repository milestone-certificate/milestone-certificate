import { useEffect } from "react";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const pad = (n: number) => String(n).padStart(2, "0");
const todayStr = () => {
  const d = new Date(Date.now() + 6 * 3600 * 1000); // Dhaka
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

type Props = {
  value?: string | null;
  onChange?: (e: { target: { value: string } }) => void;
  className?: string;
  autoToday?: boolean;
  [k: string]: unknown;
};

/** Day / Month / Year dropdown date picker. Value is YYYY-MM-DD; defaults to today. */
export function DateSelect({ value, onChange, className = "", autoToday = true, ...rest }: Props) {
  const v = value || "";
  useEffect(() => {
    if (!v && autoToday) onChange?.({ target: { value: todayStr() } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [ty, tm] = todayStr().split("-").map(Number);
  const [yy, mm, dd] = v.split("-").map(Number);
  const year = yy || ty!;
  const month = mm || tm!;
  const day = dd || 0;
  const days = new Date(year, month, 0).getDate();
  const emit = (y: number, m: number, d: number) => {
    if (!d) return onChange?.({ target: { value: "" } });
    const dv = Math.min(d, new Date(y, m, 0).getDate());
    onChange?.({ target: { value: `${y}-${pad(m)}-${pad(dv)}` } });
  };
  const years = Array.from({ length: 8 }, (_, i) => ty! - 4 + i);
  if (!years.includes(year)) years.push(year);
  const sel = "h-9 min-w-0 rounded-md border bg-background px-1.5 text-sm";
  const label = String(rest["aria-label"] ?? rest["title"] ?? "তারিখ");
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1 ${className.replace(/\bw-\S+/g, "")}`}
      role="group"
      aria-label={label}
    >
      <select
        className={sel}
        aria-label={`${label}: দিন`}
        value={day || ""}
        onChange={(e) => emit(year, month, Number(e.target.value))}
      >
        <option value="">দিন</option>
        {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <select
        className={sel}
        aria-label={`${label}: মাস`}
        value={month}
        onChange={(e) => emit(year, Number(e.target.value), day || 1)}
      >
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <select
        className={sel}
        aria-label={`${label}: বছর`}
        value={year}
        onChange={(e) => emit(Number(e.target.value), month, day || 1)}
      >
        {years.sort().map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </span>
  );
}
