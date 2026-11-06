import { z } from "zod";
import { svpErrorMessage } from "@/lib/svp-session.shared";

export type SvpLanguage = {
  code: string;
  label: string;
  questionCount: number | null;
  /** Prometric codes are either targeted (false) or site-based (true). */
  nonTargeted: boolean;
};

export type SvpOccupation = {
  id: number;
  name: string;
  arabicName: string | null;
  occupationKey: string | null;
  categoryId: number | null;
  categoryName: string | null;
  languages: SvpLanguage[];
  driverLicenseRequired: boolean;
};

export type SvpCity = { city: string; countryId: number | null };

export type SvpBookingPermissions = {
  freeReservations: boolean;
  targeted: boolean;
  loadBalancer: boolean;
  testPrice: number | null;
  countryId: number | null;
  countryName: string | null;
};

export type SvpAvailableDate = {
  startAt: string;
  city: string | null;
  centerName: string | null;
  /** Free seats reported by SVP for this date, when supplied. */
  seats: number | null;
};

export type SvpExamSession = {
  id: string | number;
  startAt: string;
  endAt: string | null;
  duration: number;
  availableSeats: number | null;
  city: string | null;
  centerName: string | null;
  siteId: number | null;
};

export type SvpPrometricSite = {
  siteId: number;
  name: string | null;
  city: string | null;
  address: string | null;
  dates: string[];
};

export type SvpPrometricSiteList = { examId: string | null; sites: SvpPrometricSite[] };

export type SvpPrometricSlot = {
  id: string;
  siteId: number | null;
  startAt: string;
  duration: number;
  availableSeats?: number | null;
};

export type SvpEligibilityKey =
  "passport_expiration_condition" | "booking_availability_condition" | "already_existing_booking";

export type SvpEligibility = {
  key: SvpEligibilityKey;
  label: string;
  passed: boolean;
  message: string;
};

export type SvpCertificate = {
  id: string;
  certificateNumber: string | null;
  status: string | null;
  validUntil: string | null;
  createdAt: string | null;
};

export type SvpReservation = {
  id: string;
  status: string | null;
  laborName: string | null;
  occupationName: string | null;
  occupationEnglishName: string | null;
  city: string | null;
  centerName: string | null;
  startAt: string | null;
  methodology: string | null;
  canBeRescheduled: boolean;
  categoryId: number | null;
  examSessionId: string | number | null;
  duration: number | null;
  languageCode: string | null;
  /** `passed` / `failed` / null while pending. */
  examResult: string | null;
  finalResult: string | null;
  totalScore: number | null;
  cbtScore: number | null;
  practicalScore: number | null;
  certificate: SvpCertificate | null;
};

export type SvpReservationDetail = SvpReservation & {
  occupationId: number | null;
  categoryName: string | null;
  languages: SvpLanguage[];
  countryId: number | null;
};

export type SvpConstraints = {
  /** null when SVP did not answer `/exam_constraints`: unknown, which is not the same as 0. */
  rescheduleTimes: number | null;
  bookingHoldSeconds: number | null;
  cancellationLimitHours: number | null;
};

export type SvpFeatureFlags = {
  rescheduleEnabled: boolean;
  creditsEnabled: boolean;
};

export type SvpPaymentRow = {
  id: string;
  amount: number | null;
  status: string | null;
  transactionStatus: string | null;
  reservationId: string | null;
  invoiceId: string | null;
  createdAt: string | null;
};

export type SvpNotification = {
  id: string;
  title: string | null;
  message: string | null;
  createdAt: string | null;
  read: boolean;
};

export type SvpCertificatePrice = {
  amount: number | null;
  currency: string | null;
};

export type SvpAccountPermissions = SvpBookingPermissions & {
  permissionKeys: string[];
};

export type SvpCategoryOption = {
  id: number;
  name: string;
  arabicName: string | null;
  languages: SvpLanguage[];
};

/** Provider-issued load-balancer IDs and language codes are opaque and may exceed short-code limits. */
export const svpExamSessionIdSchema = z.union([
  z.number().int().positive(),
  z.string().trim().min(1).max(200),
]);
export const svpExamSessionIdListSchema = z.array(svpExamSessionIdSchema).min(1).max(50);
export const svpExamSessionIdStringSchema = z.string().trim().min(1).max(200);
export const svpLanguageCodeSchema = z.string().trim().min(1).max(120);

export type SvpCreateReservationInput = {
  examSessionId: number | string;
  occupationId: number;
  languageCode: string;
  methodology?: string | null;
  duration?: number | null;
  startAt?: string | null;
  siteId: number | null;
  siteCity: string | null;
  holdId: string | null;
  countryId: number | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * SVP serialises booleans as `true`, `1`, `"1"` or occasionally `"0"`/`"false"`.
 * `Boolean("0")` is true, which flips flags such as `can_be_rescheduled` and
 * `load_balancer`, so every flag goes through this parser instead.
 */
export function parseSvpFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on";
}

/**
 * Session token SVP assigns on `POST /temporary_seats`. The reservation (or
 * reschedule) must use this id because it can differ from the requested one in
 * load-balancer mode. `0`/`"0"` is SVP's broken-hold marker and maps to null.
 */
export function parseSvpHoldSessionId(payload: unknown): string | number | null {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]) ?? root;
  const raw = data?.["exam_session_id"] ?? root?.["exam_session_id"];
  if (raw === 0 || raw === "0" || raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") return raw.trim() ? raw.trim() : null;
  return null;
}

/**
 * SVP mixes date formats across endpoints: most are ISO (2026-12-01…), but some
 * prometric payloads use dd/mm/yyyy, exactly like the temporary-seat `expired_at`
 * documented as `dd/mm/yyyy HH:MM`. Normalize both to ISO so month filters, slot
 * matching, and displays never silently break on the slash format.
 */
export function normalizeSvpDate(value: string): string {
  const trimmed = value.trim();
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(.*)$/.exec(trimmed);
  if (slash) {
    const day = (slash[1] ?? "").padStart(2, "0");
    const month = (slash[2] ?? "").padStart(2, "0");
    return `${slash[3]}-${month}-${day}${slash[4] ?? ""}`;
  }
  return trimmed;
}

/** Find a list under the root or a `data` envelope. */
function pickList(payload: unknown, keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = asRecord(payload);
  if (!root) return [];
  const data = asRecord(root["data"]);
  if (Array.isArray(root["data"])) return root["data"];
  for (const source of [root, data]) {
    if (!source) continue;
    for (const key of keys) {
      const candidate = asArray(source[key]);
      if (candidate.length > 0) return candidate;
    }
  }
  for (const key of keys) {
    const candidate = asArray(root[key]);
    if (candidate.length > 0) return candidate;
  }
  return [];
}

function pickRecord(payload: unknown, key: string): Record<string, unknown> | null {
  const root = asRecord(payload);
  if (!root) return null;
  return asRecord(root[key]) ?? asRecord(asRecord(root["data"])?.[key]);
}

const LANGUAGE_CODE_BY_NAME: Record<string, string> = {
  arabic: "ar",
  bangla: "bn",
  bengali: "bn",
  english: "en",
  hindi: "hi",
  nepali: "ne",
  urdu: "ur",
};

/** Accept `{code,name}` prometric entries as well as plain names/codes from other payloads. */
function toSvpLanguage(value: unknown): SvpLanguage | null {
  if (typeof value === "string") {
    const label = value.trim();
    if (!label) return null;
    const code = /^[A-Za-z]{2,3}$/.test(label)
      ? label.toLowerCase()
      : (LANGUAGE_CODE_BY_NAME[label.toLowerCase()] ?? null);
    if (!code) return null;
    return {
      code,
      label: /^[A-Za-z]{2,3}$/.test(label) ? label.toUpperCase() : label,
      questionCount: null,
      nonTargeted: false,
    };
  }
  const item = asRecord(value);
  if (!item) return null;
  const name = text(item["name"]) ?? text(item["english_name"]) ?? text(item["label"]);
  const code =
    text(item["code"]) ??
    text(item["language_code"]) ??
    text(item["prometric_code"]) ??
    (name ? LANGUAGE_CODE_BY_NAME[name.toLowerCase()] : null);
  if (!code) return null;
  return {
    code,
    label: name ?? code.toUpperCase(),
    questionCount: number(item["question_count"]),
    nonTargeted: parseSvpFlag(item["non_targeted"] ?? item["nonTargeted"]),
  };
}

/**
 * Prometric language codes can sit on the occupation, its category, or a `languages` list,
 * depending on the SVP endpoint. Parse all of them so the language dropdown is never empty
 * when the API did return supported languages.
 */
function parseLanguages(...sources: Array<Record<string, unknown> | null>): SvpLanguage[] {
  const languages: SvpLanguage[] = [];
  for (const source of sources) {
    if (!source) continue;
    for (const key of [
      "prometric_codes",
      "languages",
      "language_codes",
      "exam_languages",
      "language",
      "language_name",
    ]) {
      const raw = source[key];
      const entries = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
      for (const value of entries) {
        const language = toSvpLanguage(value);
        if (!language || languages.some((entry) => entry.code === language.code)) continue;
        languages.push(language);
      }
    }
  }
  return languages;
}

export function parseSvpOccupations(payload: unknown): SvpOccupation[] {
  return pickList(payload, ["occupations", "categories"])
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const id = number(record["id"]);
      const category = asRecord(record["category"]);
      if (id === null) return null;
      const categoryId = number(record["category_id"]) ?? number(category?.["id"]);
      const languages = parseLanguages(record, category);
      return {
        id,
        name: text(record["name"]) ?? text(record["english_name"]) ?? `Occupation ${String(id)}`,
        arabicName: text(record["arabic_name"]),
        occupationKey: text(record["occupation_key"]),
        categoryId,
        categoryName:
          text(category?.["name"]) ??
          text(category?.["english_name"]) ??
          text(record["category_name_en"]) ??
          text(record["category_name_ar"]),
        languages,
        driverLicenseRequired: parseSvpFlag(record["driver_license_required"]),
      };
    })
    .filter((entry): entry is SvpOccupation => entry !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function parseSvpCities(payload: unknown): SvpCity[] {
  const seen = new Set<string>();
  const cities: SvpCity[] = [];
  for (const entry of pickList(payload, [
    "cities",
    "test_center_cities",
    "testCenterCities",
    "available_cities",
    "availableCities",
    "results",
    "items",
  ])) {
    const record = asRecord(entry);
    const city =
      (typeof entry === "string" ? text(entry) : null) ??
      text(record?.["city"]) ??
      text(record?.["city_name"]) ??
      text(record?.["cityName"]) ??
      text(record?.["city_name_en"]) ??
      text(record?.["city_en"]) ??
      text(record?.["test_center_city"]) ??
      text(record?.["name"]) ??
      text(record?.["english_name"]);
    if (!city || seen.has(city.toLowerCase())) continue;
    seen.add(city.toLowerCase());
    const country = asRecord(record?.["country"]);
    cities.push({
      city,
      countryId: number(record?.["country_id"]) ?? number(country?.["id"]),
    });
  }
  return cities.sort((a, b) => a.city.localeCompare(b.city));
}

/** Build the SVP site-availability date range for the current month or next 11 months. */
export function getSvpMonthDateRange(
  month: string,
  now = new Date(),
): { startDate: string; endDate: string } | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const currentMonthIndex = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const selectedMonthIndex = year * 12 + monthIndex;
  const offset = selectedMonthIndex - currentMonthIndex;
  if (offset < 0 || offset > 11) return null;

  const startDate = offset === 0 ? now.toISOString().slice(0, 10) : `${match[1]}-${match[2]}-01`;
  const endDate = new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
  return { startDate, endDate };
}

export function parseSvpPermissions(payload: unknown): SvpBookingPermissions {
  const root = asRecord(payload);
  const country = asRecord(root?.["country"]) ?? asRecord(asRecord(root?.["data"])?.["country"]);
  return {
    freeReservations: parseSvpFlag(country?.["free_reservations"]),
    targeted: parseSvpFlag(country?.["targeted"]),
    loadBalancer: parseSvpFlag(country?.["load_balancer"]),
    testPrice: number(country?.["test_price"]),
    countryId: number(country?.["id"]),
    countryName: text(country?.["english_name"]) ?? text(country?.["name"]),
  };
}

export function parseSvpCredits(payload: unknown): number {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]);
  return (
    number(root?.["reservation_credits"]) ??
    number(data?.["reservation_credits"]) ??
    number(root?.["credits"]) ??
    0
  );
}

export function parseSvpAvailableDates(payload: unknown): SvpAvailableDate[] {
  const seen = new Set<string>();
  const dates: SvpAvailableDate[] = [];
  for (const entry of pickList(payload, ["available_dates"])) {
    const record = asRecord(entry);
    if (!record) continue;
    const startAt =
      text(record["start_at_in_tc_time_zone"]) ??
      text(record["start_date_in_tc_time_zone"]) ??
      text(record["start_date_in_browser_time_zone"]) ??
      text(record["start_at"]);
    if (!startAt) continue;
    const normalizedStartAt = normalizeSvpDate(startAt);
    const center = asRecord(record["test_center"]);
    const key = `${normalizedStartAt}|${text(center?.["city"]) ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dates.push({
      startAt: normalizedStartAt,
      city: text(center?.["city"]) ?? text(record["city"]),
      centerName: text(center?.["name"]) ?? text(record?.["test_center_name"]),
      seats: number(record["available_seats"]) ?? number(record["seats"]),
    });
  }
  return dates.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function parseSvpExamSessions(payload: unknown): SvpExamSession[] {
  return pickList(payload, ["exam_sessions", "sessions"])
    .map((entry) => {
      const record = asRecord(entry);
      const idValue = record?.["id"];
      if (!record || idValue === undefined || idValue === null) return null;
      const id = typeof idValue === "number" ? idValue : String(idValue);
      const center = asRecord(record["test_center"]);
      const rawStartAt =
        text(record["start_at_in_tc_time_zone"]) ??
        text(record["startDateTime"]) ??
        text(record["start_at"]) ??
        text(record["start_date_in_tc_time_zone"]) ??
        text(record["start_date_in_browser_time_zone"]) ??
        "";
      return {
        id,
        startAt: rawStartAt ? normalizeSvpDate(rawStartAt) : "",
        endAt: (() => {
          const rawEndAt = text(record["end_at_in_tc_time_zone"]) ?? text(record["end_at"]);
          return rawEndAt ? normalizeSvpDate(rawEndAt) : null;
        })(),
        duration: number(record["duration"]) ?? 0,
        availableSeats: number(record["available_seats"]),
        city: text(center?.["city"]) ?? text(record["city"]),
        centerName:
          text(center?.["name"]) ??
          text(center?.["english_name"]) ??
          text(center?.["test_center_name"]) ??
          text(record["test_center_name"]) ??
          text(record["center_name"]),
        siteId: number(record["site_id"]),
      };
    })
    .filter((entry): entry is SvpExamSession => entry !== null)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

export function buildSvpReservationBody(input: SvpCreateReservationInput) {
  const body: Record<string, unknown> = {
    exam_session_id: input.examSessionId,
    occupation_id: input.occupationId,
    language_code: input.languageCode,
    methodology: input.methodology ?? "in_person",
    site_id: input.siteId ?? null,
    site_city: input.siteCity ?? null,
    hold_id: input.holdId ?? null,
    country_id: input.countryId ?? null,
  };
  // Load-balancer sessions are date-only tokens; the portal omits these fields.
  if (input.duration !== null && input.duration !== undefined) body["duration"] = input.duration;
  if (input.startAt) body["start_at"] = input.startAt;
  return body;
}

/** SVP payment enums (verified against the official portal bundle). */
export const SVP_PAYMENT_METHOD_CARD = "card";
export const SVP_PAYABLE_TYPE_RESERVATION = "Reservation";

/**
 * The portal posts `{ payment: { payment_method: "card", payable_type: "Reservation",
 * payable_id } }` to /payments. The wrong casing returns "Unsupported payable type".
 */
export function buildSvpReservationPaymentBody(reservationId: string) {
  return {
    payment: {
      payment_method: SVP_PAYMENT_METHOD_CARD,
      payable_type: SVP_PAYABLE_TYPE_RESERVATION,
      // The portal sends the numeric reservation id.
      payable_id: /^\d+$/.test(reservationId) ? Number(reservationId) : reservationId,
    },
  };
}

export function parseSvpReservation(payload: unknown): {
  id: string | null;
  status: string | null;
} {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]) ?? root;
  const reservation = asRecord(data?.["reservation"]) ?? data;
  const idValue = reservation?.["id"] ?? data?.["id"];
  return {
    id: idValue === undefined || idValue === null ? null : String(idValue),
    status: text(reservation?.["reservation_status"]) ?? text(reservation?.["status"]),
  };
}

export function parseSvpReservations(payload: unknown): SvpReservation[] {
  return pickList(payload, ["exam_reservations", "reservations"])
    .map((entry) => {
      const record = asRecord(entry);
      const id = record?.["id"];
      if (!record || id === undefined || id === null) return null;
      const occupation = asRecord(record["occupation"]);
      const labor = asRecord(record["labor"]) ?? asRecord(record["individual_labor"]);
      const session = asRecord(record["exam_session"]);
      const center = asRecord(session?.["test_center"]) ?? asRecord(record["test_center"]);
      return {
        id: String(id),
        status: text(record["reservation_status"]) ?? text(record["status"]),
        laborName: text(labor?.["full_name"]) ?? text(labor?.["name"]),
        occupationName: text(occupation?.["name"]) ?? text(occupation?.["english_name"]),
        occupationEnglishName: text(occupation?.["english_name"]),
        city: text(center?.["city"]),
        centerName: text(center?.["name"]),
        startAt: text(session?.["start_at_in_tc_time_zone"]) ?? text(session?.["start_at"]),
        methodology: text(record["methodology"]),
        canBeRescheduled: parseSvpFlag(record["can_be_rescheduled"]),
        categoryId: number(record["category_id"]) ?? number(asRecord(record["category"])?.["id"]),
        examSessionId:
          typeof session?.["id"] === "string" ? session["id"] : (number(session?.["id"]) ?? null),
        duration: number(session?.["duration"]) ?? number(record["duration"]),
        languageCode: text(record["language_code"]),
        examResult: text(record["exam_result"]),
        finalResult: text(record["final_result"]),
        totalScore: resultScore(asRecord(record["examination_result"]), "total_score"),
        cbtScore: resultScore(asRecord(record["examination_result"]), "calculated_cbt_score"),
        practicalScore: resultScore(
          asRecord(record["examination_result"]),
          "calculated_practical_score",
        ),
        certificate: parseSvpCertificate(record["certificate"]),
      };
    })
    .filter((entry): entry is SvpReservation => entry !== null);
}

/** Provider messages that mean the language/prometric code was rejected. */
export function isSvpLanguageRejection(message: string | null): boolean {
  return Boolean(message && /language|prometric|locale/i.test(message));
}

/** The provider message for a failed response, never leaking values. */
export function parseSvpError(payload: unknown): string | null {
  return svpErrorMessage(payload);
}

/** Certificate block from a reservation detail response. */
export function parseSvpCertificate(value: unknown): SvpCertificate | null {
  const record = asRecord(value);
  const id = record?.["id"];
  if (!record || id === undefined || id === null) return null;
  return {
    id: String(id),
    certificateNumber: text(record["certificate_number"]),
    status: text(record["status"]),
    validUntil: text(record["valid_until"]),
    createdAt: text(record["created_at"]),
  };
}

function resultScore(record: Record<string, unknown> | null, key: string): number | null {
  return record ? number(record[key]) : null;
}

/**
 * Safe download name: `<Candidate>_<Occupation>_<Test center>_SVP_Certificate.pdf`.
 * Empty parts are dropped so the name stays readable.
 */
export function svpCertificateFileName(
  name: string | null | undefined,
  occupationEnglishName: string | null | undefined,
  centerName: string | null | undefined,
): string {
  const slug = (value: string | null | undefined) =>
    (value ?? "")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "_")
      .slice(0, 60);
  const parts = [slug(name), slug(occupationEnglishName), slug(centerName)].filter(Boolean);
  return `${parts.join("_") || "SVP"}_SVP_Certificate.pdf`;
}

/** Safe download name: `<Candidate>_<Occupation English>_SVP_Ticket.pdf`. */
export function svpTicketFileName(
  name: string | null | undefined,
  occupationEnglishName: string | null | undefined,
): string {
  const slug = (value: string | null | undefined, fallback: string) => {
    const cleaned = (value ?? "")
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "_")
      .slice(0, 80);
    return cleaned || fallback;
  };
  return `${slug(name, "Candidate")}_${slug(occupationEnglishName, "Occupation")}_SVP_Ticket.pdf`;
}

/** Reservation detail used by the reschedule flow. */
export function parseSvpReservationDetail(payload: unknown): SvpReservationDetail | null {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]) ?? root;
  const reservation = asRecord(data?.["reservation"]) ?? data;
  if (!reservation) return null;
  const idValue = reservation["id"] ?? data?.["id"];
  if (idValue === undefined || idValue === null) return null;

  const session = asRecord(reservation["exam_session"]);
  const category =
    asRecord(reservation["category"]) ??
    asRecord(session?.["category"]) ??
    asRecord(asRecord(reservation["occupation"])?.["category"]);
  const occupation = asRecord(reservation["occupation"]);
  const center = asRecord(session?.["test_center"]) ?? asRecord(reservation["test_center"]);
  const labor = asRecord(reservation["labor"]) ?? asRecord(reservation["individual_labor"]);

  return {
    id: String(idValue),
    status: text(reservation["reservation_status"]) ?? text(reservation["status"]),
    laborName: text(labor?.["full_name"]) ?? text(labor?.["name"]),
    occupationName: text(occupation?.["name"]) ?? text(occupation?.["english_name"]),
    occupationEnglishName: text(occupation?.["english_name"]),
    city: text(center?.["city"]),
    centerName: text(center?.["name"]),
    startAt: text(session?.["start_at_in_tc_time_zone"]) ?? text(session?.["start_at"]),
    methodology: text(reservation["methodology"]),
    canBeRescheduled: parseSvpFlag(reservation["can_be_rescheduled"]),
    categoryId: number(reservation["category_id"]) ?? number(category?.["id"]),
    examSessionId:
      typeof session?.["id"] === "string" ? session["id"] : (number(session?.["id"]) ?? null),
    duration: number(session?.["duration"]) ?? number(reservation["duration"]),
    occupationId: number(reservation["occupation_id"]) ?? number(occupation?.["id"]),
    categoryName: text(category?.["name"]) ?? text(category?.["english_name"]),
    languages: parseLanguages(category),
    examResult: text(reservation["exam_result"]),
    finalResult: text(reservation["final_result"]),
    totalScore: resultScore(asRecord(reservation["examination_result"]), "total_score"),
    cbtScore: resultScore(asRecord(reservation["examination_result"]), "calculated_cbt_score"),
    practicalScore: resultScore(
      asRecord(reservation["examination_result"]),
      "calculated_practical_score",
    ),
    certificate: parseSvpCertificate(reservation["certificate"]),
    languageCode: text(reservation["language_code"]),
    countryId:
      number(reservation["country_id"]) ?? number(asRecord(reservation["country"])?.["id"]),
  };
}

/** `/exam_constraints` values as SVP answered them (always concrete numbers). */
export type SvpParsedConstraints = {
  rescheduleTimes: number;
  bookingHoldSeconds: number;
  cancellationLimitHours: number | null;
};

/** `/exam_constraints` values that gate booking and rescheduling. */
export function parseSvpConstraints(payload: unknown): SvpParsedConstraints {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]) ?? root;
  return {
    rescheduleTimes: number(data?.["reservation_rescheduling"]) ?? 1,
    bookingHoldSeconds: number(data?.["reservation_duration"]) ?? 0,
    cancellationLimitHours:
      number(data?.["labor_reservation_cancellation_time_limit"]) ??
      number(data?.["labor_reservation_cancellation_limit"]),
  };
}

/** Flipper flags relevant to booking/rescheduling (`[{name, state}]` or a map). */
export function parseSvpFeatureFlags(payload: unknown): SvpFeatureFlags {
  const root = asRecord(payload);
  const container =
    root?.["feature_flags"] ??
    asRecord(root?.["data"])?.["feature_flags"] ??
    root?.["data"] ??
    root;

  const isOn = (value: unknown) => parseSvpFlag(value);

  const lookup = (name: string): boolean => {
    if (Array.isArray(container)) {
      const entry = container
        .map(asRecord)
        .find((item) => item && String(item["name"] ?? "").toLowerCase() === name.toLowerCase());
      return entry ? isOn(entry["state"]) : false;
    }
    const record = asRecord(container);
    if (!record) return false;
    const key = Object.keys(record).find((entry) => entry.toLowerCase() === name.toLowerCase());
    return key ? isOn(record[key]) : false;
  };

  return {
    rescheduleEnabled: lookup("enable_labor_rescheduling_flow"),
    creditsEnabled: lookup("labor_reservation_credits"),
  };
}

function paymentIdText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toPaymentRow(record: Record<string, unknown>): SvpPaymentRow | null {
  const id = paymentIdText(record["id"] ?? record["payment_id"]);
  if (!id) return null;
  const response = asRecord(record["response"]);
  const payableType = paymentIdText(record["payable_type"])?.toUpperCase() ?? null;
  const payableId = paymentIdText(record["payable_id"]);
  const invoice = asRecord(record["invoice"]);
  return {
    id,
    amount: number(record["amount"]),
    status: text(record["status"]) ?? text(record["payment_status"]),
    transactionStatus: text(response?.["transaction_status"]) ?? text(record["transaction_status"]),
    reservationId:
      text(record["reservation_id"]) ??
      (payableType === "RESERVATION" ? payableId : null) ??
      text(asRecord(record["reservation"])?.["id"]),
    invoiceId: paymentIdText(record["invoice_id"]) ?? paymentIdText(invoice?.["id"]),
    createdAt: text(record["created_at"]) ?? text(record["createdAt"]),
  };
}

/** Card payments of the signed-in labor (GET /payments). */
export function parseSvpPayments(payload: unknown): SvpPaymentRow[] {
  return pickList(payload, ["payments", "payment"])
    .map((entry) => {
      const record = asRecord(entry);
      return record ? toPaymentRow(record) : null;
    })
    .filter((entry): entry is SvpPaymentRow => entry !== null);
}

/** One payment record returned by GET /payments/{id}. */
export function parseSvpPayment(payload: unknown): SvpPaymentRow | null {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]) ?? root;
  const payment = asRecord(data?.["payment"]) ?? data;
  return payment ? toPaymentRow(payment) : null;
}

/** In-app SVP notifications (GET /notifications). */
export function parseSvpNotifications(payload: unknown): SvpNotification[] {
  return pickList(payload, ["notifications", "notification"])
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const id = paymentIdText(record["id"] ?? record["uuid"]);
      if (!id) return null;
      return {
        id,
        title: text(record["title"]) ?? text(record["subject"]),
        message: text(record["message"]) ?? text(record["body"]) ?? text(record["description"]),
        createdAt: text(record["created_at"]) ?? text(record["createdAt"]),
        read: Boolean(record["read_at"]) || parseSvpFlag(record["read"] ?? record["seen"]),
      };
    })
    .filter((entry): entry is SvpNotification => entry !== null);
}

/** Certificate price for the labor's country (GET /certificate_price). */
export function parseSvpCertificatePrice(payload: unknown): SvpCertificatePrice {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]) ?? root;
  const country = asRecord(data?.["country"]);
  return {
    amount:
      number(data?.["certificate_price"]) ??
      number(data?.["price"]) ??
      number(data?.["amount"]) ??
      number(country?.["certificate_price"]) ??
      number(country?.["test_price"]),
    currency:
      text(data?.["currency"]) ??
      text(data?.["currency_code"]) ??
      text(country?.["currency"]) ??
      text(country?.["currency_code"]),
  };
}

function collectTrueKeys(value: unknown, depth = 0, keys: string[] = []): string[] {
  if (depth > 4 || !value || typeof value !== "object" || Array.isArray(value)) return keys;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === true) keys.push(key);
    else collectTrueKeys(entry, depth + 1, keys);
  }
  return keys.slice(0, 40);
}

/** Country permissions plus the true boolean permission keys of the labor role. */
export function parseSvpAccountPermissions(payload: unknown): SvpAccountPermissions {
  const permissions = parseSvpPermissions(payload);
  const root = asRecord(payload);
  const raw = asRecord(root?.["permissions"]);
  const legislator = asRecord(raw?.["legislator"]) ?? raw;
  const labors = asRecord(legislator?.["labors"]);
  return {
    ...permissions,
    permissionKeys: collectTrueKeys(labors ?? legislator),
  };
}

/** Site availability list from `/prometric_scheduling/sites_availabilities`. */
export function parseSvpPrometricSites(payload: unknown): SvpPrometricSiteList {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]) ?? root;
  const sites: SvpPrometricSite[] = [];
  for (const entry of asArray(data?.["sites"])) {
    const record = asRecord(entry);
    const siteId = number(record?.["site_id"]) ?? number(record?.["id"]);
    if (!record || siteId === null) continue;
    const center = asRecord(record["test_center"]);
    const address = asRecord(center?.["address"]);
    const dates = asArray(record["available_dates"])
      .map((value) => {
        if (typeof value === "string") return normalizeSvpDate(value).slice(0, 10);
        const item = asRecord(value);
        const raw = text(item?.["date"]) ?? text(item?.["start_at"]) ?? "";
        return raw ? normalizeSvpDate(raw).slice(0, 10) : "";
      })
      .filter((value) => Boolean(value));
    sites.push({
      siteId,
      name: text(center?.["name"]) ?? text(record["site_name"]),
      city: text(address?.["locality"]) ?? text(center?.["city"]) ?? text(record["city"]),
      address: text(address?.["formattedAddress"]) ?? text(record["address"]),
      dates: [...new Set(dates)],
    });
  }
  return {
    examId: text(data?.["exam_id"]) ?? text(root?.["exam_id"]),
    sites,
  };
}

/** Slot list from `/prometric_scheduling/slots_availabilities` (`[{site_id, slots}]`). */
export function parseSvpPrometricSlots(payload: unknown): SvpPrometricSlot[] {
  let groups: unknown[] = [];
  if (Array.isArray(payload)) {
    groups = payload;
  } else {
    const root = asRecord(payload);
    if (root) {
      if (Array.isArray(root["data"])) groups = root["data"];
      else {
        const data = asRecord(root["data"]);
        for (const candidate of [root["slots"], data?.["slots"], data?.["sites"]]) {
          if (Array.isArray(candidate)) {
            groups = candidate;
            break;
          }
        }
      }
    }
  }

  const slots: SvpPrometricSlot[] = [];
  for (const entry of groups) {
    const group = asRecord(entry);
    if (!group) continue;
    const siteId = number(group["site_id"]);
    for (const value of asArray(group["slots"])) {
      const slot = asRecord(value);
      const id = slot?.["id"];
      const rawStartAt =
        text(slot?.["start_at_in_tc_time_zone"]) ??
        text(slot?.["startDateTime"]) ??
        text(slot?.["start_at"]);
      if (!slot || id === undefined || id === null || !rawStartAt) continue;
      slots.push({
        id: String(id),
        siteId: number(slot["site_id"]) ?? siteId,
        startAt: normalizeSvpDate(rawStartAt),
        duration: number(slot["duration"]) ?? 0,
        ...(slot["available_seats"] !== undefined
          ? { availableSeats: number(slot["available_seats"]) }
          : {}),
      });
    }
  }
  return slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** One exam session by id (load-balancer assignment response). */
export function parseSvpExamSession(payload: unknown): SvpExamSession | null {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]) ?? root;
  return parseSvpExamSessions({ exam_sessions: [data] })[0] ?? null;
}

/** Categories from the `/permissions` response, used to map occupations without a category id. */
export function parseSvpCategories(payload: unknown): SvpCategoryOption[] {
  const root = asRecord(payload);
  const data = asRecord(root?.["data"]);
  const list = asArray(root?.["categories"]).length
    ? asArray(root?.["categories"])
    : asArray(data?.["categories"]);
  return list
    .map((entry) => {
      const record = asRecord(entry);
      const id = number(record?.["id"]);
      if (!record || id === null) return null;
      return {
        id,
        name: text(record["english_name"]) ?? text(record["name"]) ?? `Category ${String(id)}`,
        arabicName: text(record["arabic_name"]),
        languages: parseLanguages(record),
      };
    })
    .filter((entry): entry is SvpCategoryOption => entry !== null);
}
