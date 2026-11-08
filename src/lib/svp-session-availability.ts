import type { SvpExamSession } from "@/lib/svp-api.shared";
import { parseSessions } from "@/lib/takamol-availability.ui";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RecordValue) : {};
}

function text(value: unknown): string | null {
  return (typeof value === "string" || typeof value === "number") && String(value).trim()
    ? String(value).trim()
    : null;
}

function time(value: unknown): string | null {
  const match = text(value)?.match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?\s*(AM|PM)?$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  } else if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}:00`;
}

export function svpSessionNeedsDetails(session: SvpExamSession): boolean {
  return (
    !session.centerName ||
    !/[T ]\d{2}:\d{2}/.test(session.startAt) ||
    session.availableSeats === null
  );
}

/**
 * SVP re-encrypts date-only ids on every request. Resolved gateway rows have
 * their own valid SVP token: keep each token and its details together instead
 * of attaching metadata to an unrelated native row by position.
 */
export function resolveSvpSessionAvailability(
  sessions: SvpExamSession[],
  payload: unknown,
  request: { categoryId: number; city: string; examDate: string },
): SvpExamSession[] {
  if (sessions.length === 0) return sessions;
  const resolved: SvpExamSession[] = [];
  const rows = parseSessions(payload);
  const identity = (row: RecordValue) =>
    text(row["encrypted_session_id"]) ?? text(row["exam_session_id"]) ?? text(row["id"]);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const id = identity(row);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  for (const row of rows) {
    if (row["resolved"] === false) continue;
    const id = identity(row);
    const date = text(row["exam_date"]);
    const city = text(row["center_city"]) ?? text(row["site_city"]) ?? text(row["city"]);
    const category = text(record(row["category"])["id"]);
    const center = record(row["test_center"]);
    const centerName = text(row["center_name"]) ?? text(center["name"]);
    const startTime = time(row["exam_time"]);
    const rawSeats = row["available_seats"];
    const seats =
      rawSeats === null || rawSeats === undefined || rawSeats === "" ? null : Number(rawSeats);
    if (
      !id ||
      counts.get(id) !== 1 ||
      date !== request.examDate ||
      (city && city.toLowerCase() !== request.city.trim().toLowerCase()) ||
      (category && category !== String(request.categoryId)) ||
      !centerName ||
      !startTime ||
      seats === null ||
      !Number.isInteger(seats) ||
      seats < 0
    )
      continue;
    resolved.push({
      id,
      startAt: `${date} ${startTime}`,
      endAt: null,
      duration: 0,
      availableSeats: seats,
      city: city ?? request.city,
      centerName,
      // Targeted centers are not prometric sites; keep the targeted booking path.
      siteId: null,
    });
  }
  const opaqueOnly = sessions.every(
    (session) =>
      !session.centerName &&
      !/[T ]\d{2}:\d{2}/.test(session.startAt) &&
      session.startAt.slice(0, 10) === request.examDate,
  );
  // These are independent live reads: seat changes (and SVP's day-token
  // grouping) can change the count between them. The gateway returns its own
  // complete day catalogue with bookable tokens, not metadata to zip onto the
  // native list. Validate every gateway row instead of requiring equal counts.
  // A genuinely partial/unresolved catalogue still falls back to native ids.
  if (opaqueOnly && resolved.length > 0 && resolved.length === rows.length) return resolved;
  return sessions.map((session) => {
    const detail = resolved.find((entry) => String(entry.id) === String(session.id));
    if (!detail || !svpSessionNeedsDetails(session)) return session;
    return {
      ...session,
      centerName: session.centerName ?? detail.centerName,
      startAt: /[T ]\d{2}:\d{2}/.test(session.startAt) ? session.startAt : detail.startAt,
      availableSeats: session.availableSeats ?? detail.availableSeats,
    };
  });
}
