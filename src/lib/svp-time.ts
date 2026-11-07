type WallTime = { label: string; period: string };

function wallTime(value: string | null | undefined): WallTime | null {
  const match = value
    ?.trim()
    .match(/^(?:\d{4}-\d{2}-\d{2}[T ])?([01]\d|2[0-3]):([0-5]\d)(?=$|[:.Z+ -])/);
  if (!match) return null;
  const hour = Number(match[1]);
  const period =
    hour < 4
      ? "রাত"
      : hour < 6
        ? "ভোর"
        : hour < 12
          ? "সকাল"
          : hour < 16
            ? "দুপুর"
            : hour < 18
              ? "বিকেল"
              : hour < 20
                ? "সন্ধ্যা"
                : "রাত";
  return { label: `${hour % 12 || 12}:${match[2]} ${hour < 12 ? "AM" : "PM"}`, period };
}

/** Display the supplied test-center wall clock without timezone conversion. */
export function formatSvpTime(value: string | null | undefined): string | null {
  const time = wallTime(value);
  return time ? `${time.label} · ${time.period}` : null;
}

export function formatSvpTimeRange(startAt: string, endAt?: string | null): string {
  const start = wallTime(startAt);
  const end = wallTime(endAt);
  if (!start) return "—";
  if (!end) return `${start.label} · ${start.period}`;
  if (start.period === end.period) return `${start.label} – ${end.label} · ${start.period}`;
  return `${start.label} · ${start.period} – ${end.label} · ${end.period}`;
}

/** Dates without an explicit time stay date-only. */
export function formatSvpDateTime(value: string): string {
  const date = value.slice(0, 10);
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return value;
  const label = parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const time = formatSvpTime(value);
  return `${label}${time ? ` · ${time}` : ""}`;
}
