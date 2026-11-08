import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchTakamolAvailability } from "@/lib/takamol-availability.server";
import {
  resolveSvpSessionAvailability,
  svpSessionNeedsDetails,
} from "@/lib/svp-session-availability";
import {
  buildSvpReservationBody,
  buildSvpReservationPaymentBody,
  getSvpMonthDateRange,
  parseSvpAccountPermissions,
  parseSvpAvailableDates,
  parseSvpCategories,
  parseSvpCities,
  parseSvpConstraints,
  parseSvpCredits,
  parseSvpError,
  parseSvpExamSession,
  parseSvpExamSessions,
  parseSvpFeatureFlags,
  parseSvpOccupations,
  parseSvpPayment,
  parseSvpPayments,
  parseSvpPermissions,
  parseSvpPrometricSites,
  parseSvpPrometricSlots,
  parseSvpReservation,
  parseSvpReservationDetail,
  parseSvpReservations,
  parseSvpHoldSessionId,
  parseSvpCertificatePrice,
  parseSvpNotifications,
  isSvpLanguageRejection,
  svpExamSessionIdListSchema,
  svpExamSessionIdSchema,
  svpExamSessionIdStringSchema,
  svpLanguageCodeSchema,
  type SvpAccountPermissions,
  type SvpAvailableDate,
  type SvpBookingPermissions,
  type SvpCategoryOption,
  type SvpCertificatePrice,
  type SvpCity,
  type SvpConstraints,
  type SvpEligibility,
  type SvpExamSession,
  type SvpFeatureFlags,
  type SvpNotification,
  type SvpOccupation,
  type SvpPaymentRow,
  type SvpPrometricSiteList,
  type SvpPrometricSlot,
  type SvpReservation,
  type SvpReservationDetail,
} from "@/lib/svp-api.shared";
import {
  readStoredSvpSession,
  requireSvpAllowedRole,
  SvpSessionMissingError,
  svpAuthedBinary,
  svpAuthedRequest,
} from "@/lib/svp-session.server";

export type SvpResult<T> =
  { ok: true; data: T } | { ok: false; message: string; needsSignIn: boolean };

function failure(
  message: string,
  needsSignIn = false,
): { ok: false; message: string; needsSignIn: boolean } {
  return { ok: false, message, needsSignIn };
}

function apiFailure(payload: unknown, fallback: string, status?: number): string {
  const message = parseSvpError(payload) ?? fallback;
  return status ? `${message} (HTTP ${status})` : message;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mergeOccupations(target: Map<number, SvpOccupation>, items: SvpOccupation[]) {
  for (const item of items) target.set(item.id, item);
}

const LOCALE_QUERY = { locale: "en" } as const;

/**
 * Feature flags: the labor-space endpoint is primary; older tenants expose /flipper.
 * Both shapes are parsed by parseSvpFeatureFlags.
 */
async function readSvpFlags(userId: string) {
  const primary = await svpAuthedRequest(userId, "/individual_labor_space/feature_flags", {
    query: LOCALE_QUERY,
    retries: 0,
  });
  if (primary.ok) return primary;
  return svpAuthedRequest(userId, "/flipper/feature_flags", { query: LOCALE_QUERY, retries: 0 });
}

/** Reservation credits: labor-space user_balance is primary, /users/{id}/balance is legacy. */
async function readSvpCredits(
  userId: string,
  svpUserId: string,
  occupationId?: number | null,
): Promise<number> {
  const query: Record<string, string | number> = {
    ...LOCALE_QUERY,
    methodology_type: "in_person",
  };
  if (occupationId) query["occupation_id"] = occupationId;
  const primary = await svpAuthedRequest(
    userId,
    `/individual_labor_space/user_balance/${encodeURIComponent(svpUserId)}`,
    { query, retries: 0 },
  );
  if (primary.ok) return parseSvpCredits(primary.payload);
  const legacy = await svpAuthedRequest(userId, `/users/${encodeURIComponent(svpUserId)}/balance`, {
    query,
    retries: 0,
  });
  return legacy.ok ? parseSvpCredits(legacy.payload) : 0;
}

const categoryInput = z.object({
  categoryId: z.number().int().positive(),
  countryId: z.number().int().positive().nullable().optional(),
});

/** Permissions (free reservations / targeted country) and credit balance. */
export const getSvpBookingSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ occupationId: z.number().int().positive().nullable().optional() }).parse(input),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<
      SvpResult<{ permissions: SvpBookingPermissions; credits: number; svpUserId: string | null }>
    > => {
      await requireSvpAllowedRole(context.supabase, context.userId);
      try {
        const permissionsResponse = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/permissions",
          { query: LOCALE_QUERY },
        );
        if (!permissionsResponse.ok) {
          return failure(
            apiFailure(
              permissionsResponse.payload,
              "SVP permissions could not be loaded.",
              permissionsResponse.status,
            ),
          );
        }
        const permissions = parseSvpPermissions(permissionsResponse.payload);
        const session = readStoredSvpSession(context.userId);
        const credits =
          session?.svpUserId && data.occupationId
            ? await readSvpCredits(context.userId, session.svpUserId, data.occupationId)
            : 0;
        return {
          ok: true,
          data: { permissions, credits, svpUserId: session?.svpUserId ?? null },
        };
      } catch (error) {
        if (error instanceof SvpSessionMissingError) return failure(error.message, true);
        return failure("SVP booking setup could not be loaded.");
      }
    },
  );

/** Occupations available in the signed-in labor's space. */
export const listSvpBookingOccupations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SvpResult<SvpOccupation[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const merged = new Map<number, SvpOccupation>();
      let firstError: string | null = null;

      const loadLaborPages = async (perPage: number) => {
        for (let page = 1; page <= 100; page++) {
          const response = await svpAuthedRequest(
            context.userId,
            "/individual_labor_space/occupations",
            { query: { ...LOCALE_QUERY, per_page: perPage, page, name: "" } },
          );
          if (!response.ok) {
            if (page === 1 && !firstError) {
              firstError = apiFailure(
                response.payload,
                "Occupations could not be loaded.",
                response.status,
              );
            }
            break;
          }
          const items = parseSvpOccupations(response.payload);
          mergeOccupations(merged, items);
          const root = record(response.payload);
          const pagination =
            record(root?.["pagination"]) ?? record(record(root?.["data"])?.["pagination"]);
          if (!pagination?.["next"] || items.length === 0) break;
        }
      };

      // Some deployments reject large pages; try progressively smaller pages.
      for (const perPage of [194, 100, 50]) {
        await loadLaborPages(perPage);
        if (merged.size > 0) break;
      }

      if (merged.size === 0) {
        const fallback = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/occupations",
          { query: { ...LOCALE_QUERY, per_page: 50, page: 1 } },
        );
        if (fallback.ok) mergeOccupations(merged, parseSvpOccupations(fallback.payload));
      }

      // Public catalogue fallback: the category is filled on selection via getSvpOccupationById.
      if (merged.size === 0) {
        const visitor = await svpAuthedRequest(context.userId, "/visitor_space/occupations", {
          query: { ...LOCALE_QUERY, per_page: 1000, page: 1 },
        });
        if (visitor.ok) mergeOccupations(merged, parseSvpOccupations(visitor.payload));
      }

      if (merged.size === 0 && firstError) return failure(firstError);
      return { ok: true, data: [...merged.values()] };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("Occupations could not be loaded.");
    }
  });

/** Full occupation record (used when a search result lacks its category). */
export const getSvpOccupationById = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        occupationId: z.number().int().positive(),
        name: z.string().trim().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpOccupation>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        `/individual_labor_space/occupations/${data.occupationId}`,
        { query: { ...LOCALE_QUERY, per_page: 1 } },
      );
      let occupation: SvpOccupation | null = null;
      if (response.ok) {
        const root = record(response.payload);
        const payload = root?.["data"] ?? root ?? {};
        occupation = parseSvpOccupations({ occupations: [payload] })[0] ?? null;
      }

      // The detail endpoint can omit prometric codes; search the labor list by name as a fallback.
      if ((!occupation || occupation.languages.length === 0) && data.name) {
        const search = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/occupations",
          { query: { ...LOCALE_QUERY, per_page: 50, page: 1, name: data.name } },
        );
        if (search.ok) {
          const candidates = parseSvpOccupations(search.payload);
          const match =
            candidates.find((entry) => entry.id === data.occupationId) ??
            candidates.find(
              (entry) => entry.name.toLowerCase() === data.name?.trim().toLowerCase(),
            ) ??
            null;
          if (match && (!occupation || match.languages.length > occupation.languages.length)) {
            occupation = match;
          }
        }
      }

      if (!occupation) return failure("SVP did not return this occupation.");
      return { ok: true, data: occupation };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The occupation could not be loaded.");
    }
  });

/** Server-side similar-occupation search using the SVP `name` filter. */
export const searchSvpOccupations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ query: z.string().trim().max(120) }).parse(input))
  .handler(async ({ context, data }): Promise<SvpResult<SvpOccupation[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    if (!data.query) return { ok: true, data: [] };
    try {
      const merged = new Map<number, SvpOccupation>();

      // 1) SVP name filter, then the alternative `search` key.
      for (const query of [
        { per_page: 100, page: 1, name: data.query },
        { per_page: 100, page: 1, search: data.query },
      ]) {
        const response = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/occupations",
          { query: { ...LOCALE_QUERY, ...query } },
        );
        if (response.ok) mergeOccupations(merged, parseSvpOccupations(response.payload));
        if (merged.size > 0) break;
      }

      // 2) Local filter over the full (paginated) catalogue as a fallback.
      if (merged.size === 0) {
        const needle = data.query.toLowerCase();
        for (let page = 1; page <= 100; page++) {
          const response = await svpAuthedRequest(
            context.userId,
            "/individual_labor_space/occupations",
            { query: { ...LOCALE_QUERY, per_page: 194, page, name: "" } },
          );
          if (!response.ok) break;
          const items = parseSvpOccupations(response.payload).filter((entry) =>
            [entry.name, entry.arabicName, entry.occupationKey, entry.categoryName].some((value) =>
              value?.toLowerCase().includes(needle),
            ),
          );
          mergeOccupations(merged, items);
          const root = record(response.payload);
          const pagination =
            record(root?.["pagination"]) ?? record(record(root?.["data"])?.["pagination"]);
          if (!pagination?.["next"]) break;
        }
      }

      // 3) Public catalogue fallback, filtered locally.
      if (merged.size === 0) {
        const visitor = await svpAuthedRequest(context.userId, "/visitor_space/occupations", {
          query: { ...LOCALE_QUERY, per_page: 1000, page: 1 },
        });
        if (visitor.ok) {
          const needle = data.query.toLowerCase();
          mergeOccupations(
            merged,
            parseSvpOccupations(visitor.payload).filter((entry) =>
              [entry.name, entry.arabicName, entry.occupationKey, entry.categoryName].some(
                (value) => value?.toLowerCase().includes(needle),
              ),
            ),
          );
        }
      }

      return { ok: true, data: [...merged.values()].slice(0, 50) };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("Similar occupations could not be loaded.");
    }
  });

/** Test-center cities for the signed-in labor's country. */
export const listSvpTestCenterCities = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ countryId: z.number().int().positive().nullable().optional() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpCity[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/test_centers/cities",
        {
          query: {
            ...LOCALE_QUERY,
            per_page: 10000,
            ...(data.countryId ? { country_id: data.countryId } : {}),
          },
        },
      );
      if (!response.ok) {
        return failure(
          apiFailure(response.payload, "Test center cities could not be loaded.", response.status),
        );
      }
      return { ok: true, data: parseSvpCities(response.payload) };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("Test center cities could not be loaded.");
    }
  });

/** Run the three SVP pre-booking validations for a category. */
export const checkSvpBookingEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => categoryInput.parse(input))
  .handler(async ({ context, data }): Promise<SvpResult<SvpEligibility[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    const checks: { key: SvpEligibility["key"]; label: string }[] = [
      { key: "passport_expiration_condition", label: "Passport validity" },
      { key: "booking_availability_condition", label: "Booking availability" },
      { key: "already_existing_booking", label: "Existing booking check" },
    ];
    try {
      const results: SvpEligibility[] = [];
      for (const check of checks) {
        const response = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/exam_reservations/validate",
          {
            query: {
              ...LOCALE_QUERY,
              condition: check.key,
              ...(check.key === "passport_expiration_condition"
                ? {}
                : { category_id: data.categoryId }),
            },
          },
        );
        results.push({
          ...check,
          passed: response.ok,
          message: response.ok ? "Passed" : (response.message ?? "SVP did not accept this check."),
        });
      }
      return { ok: true, data: results };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("Eligibility checks could not be completed.");
    }
  });

/** Calendar dates with free seats for a category. */
export const listSvpAvailableDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => categoryInput.parse(input))
  .handler(async ({ context, data }): Promise<SvpResult<SvpAvailableDate[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/exam_sessions/available_dates",
        {
          query: {
            ...LOCALE_QUERY,
            category_id: data.categoryId,
            ...(data.countryId ? { country_id: data.countryId } : {}),
            start_at_date_from: new Date().toISOString().slice(0, 10),
            available_seats: "greater_than::0",
            status: "scheduled",
            per_page: 1000,
          },
        },
      );
      if (!response.ok) {
        return failure(apiFailure(response.payload, "Available dates could not be loaded."));
      }
      return { ok: true, data: parseSvpAvailableDates(response.payload) };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("Available dates could not be loaded.");
    }
  });

/** Exam sessions for one date + city. */
export const listSvpExamSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        categoryId: z.number().int().positive(),
        city: z.string().trim().min(1).max(120),
        examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpExamSession[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/exam_sessions",
        {
          query: {
            ...LOCALE_QUERY,
            category_id: data.categoryId,
            city: data.city,
            exam_date: data.examDate,
            available_seats: "greater_than::0",
          },
        },
      );
      if (!response.ok) {
        return failure(apiFailure(response.payload, "Exam sessions could not be loaded."));
      }
      const sessions = parseSvpExamSessions(response.payload);
      if (!sessions.some(svpSessionNeedsDetails)) return { ok: true, data: sessions };
      // The native targeted response can contain only opaque day tokens. The
      // availability service resolves each session's own token, center and time.
      // Keep this optional lookup bounded so a slow gateway cannot block booking.
      const availability = await fetchTakamolAvailability(
        {
          endpoint: "sessions",
          categoryId: String(data.categoryId),
          city: data.city,
          examDate: data.examDate,
        },
        { timeoutMs: 5_000, maxRetries: 0 },
      );
      return {
        ok: true,
        data: availability.success
          ? resolveSvpSessionAvailability(sessions, availability.data, data)
          : sessions,
      };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("Exam sessions could not be loaded.");
    }
  });

/** Existing SVP reservations for the signed-in labor. */
export const listSvpReservations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SvpResult<SvpReservation[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/exam_reservations",
        { query: LOCALE_QUERY },
      );
      if (!response.ok) {
        return failure(apiFailure(response.payload, "SVP reservations could not be loaded."));
      }
      return { ok: true, data: parseSvpReservations(response.payload) };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("SVP reservations could not be loaded.");
    }
  });

export type SvpBookingResult = {
  reservationId: string;
  paid: boolean;
  paymentRequired: boolean;
  credits: number;
  message: string;
};

/** Create the reservation with the real SVP payload, then settle it with free seats or credits. */
export const createSvpBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        occupationId: z.number().int().positive(),
        categoryId: z.number().int().positive(),
        examSessionId: svpExamSessionIdSchema,
        languageCode: svpLanguageCodeSchema,
        methodology: z.string().trim().min(1).max(40).optional(),
        duration: z.number().nonnegative().nullable().optional(),
        startAt: z.string().trim().max(64).nullable().optional(),
        siteId: z.number().int().positive().nullable().optional(),
        siteCity: z.string().trim().max(120).nullable().optional(),
        holdId: z.string().trim().max(64).nullable().optional(),
        countryId: z.number().int().positive().nullable().optional(),
        /** SVP-owned language/prometric codes to try if the first one is rejected. */
        fallbackLanguageCodes: z.array(svpLanguageCodeSchema).max(6).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpBookingResult>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const pending = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/payments/validate_pending",
        { query: LOCALE_QUERY },
      );
      if (!pending.ok) {
        return failure(apiFailure(pending.payload, "Pending payments could not be checked."));
      }
      const pendingRecord = record(pending.payload);
      const canProceed =
        record(pendingRecord?.["data"])?.["can_proceed"] ?? pendingRecord?.["can_proceed"];
      if (canProceed === false) {
        return failure(
          "A previous SVP payment is still being processed. Wait for it to finish before booking again.",
        );
      }

      // Session token to book. SVP can reassign it on the temporary-seat hold below.
      let bookSessionId: string | number = data.examSessionId;
      // A site-based (prometric) booking carries a site id and/or a slot hold id; only a
      // targeted booking takes the temporary-seat hold. Sending the prometric exam id to
      // /temporary_seats would hand back an unrelated session token.
      const siteBased = Boolean(data.holdId) || Boolean(data.siteId);

      // Targeted flow: the portal creates a temporary seat for the chosen session.
      // Session tokens can be numeric ids or opaque strings (load-balancer day tokens),
      // so the hold must run for both — skipping it for string ids booked an unheld seat.
      if (!siteBased) {
        const hold = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/temporary_seats",
          {
            method: "POST",
            query: LOCALE_QUERY,
            body: {
              exam_session_id: data.examSessionId,
              methodology: "in_person",
              country_id: data.countryId ?? null,
              category_id: data.categoryId,
            },
          },
        );
        if (!hold.ok) {
          return failure(
            apiFailure(hold.payload, "SVP could not hold this seat. Choose another session."),
          );
        }
        // SVP assigns the session token to book on the hold; in load-balancer mode it
        // differs from the requested id, so the reservation must use the assigned one.
        const assigned = parseSvpHoldSessionId(hold.payload);
        if (assigned === null) {
          return failure("SVP did not assign a session for this date. Choose another session.");
        }
        bookSessionId = assigned;
      }

      if (data.holdId) {
        // The portal holds the temporary seat again for a held slot; best effort, like the portal.
        await svpAuthedRequest(context.userId, "/individual_labor_space/temporary_seats", {
          method: "POST",
          query: LOCALE_QUERY,
          body: {
            exam_session_id: data.holdId,
            methodology: "in_person",
            country_id: data.countryId ?? null,
            category_id: data.categoryId,
          },
        }).catch(() => undefined);
      }

      // SVP rejects a language code that is not one of its prometric codes. Try the
      // occupation's own codes as fallbacks so a Takamol-derived label cannot block booking.
      const languageCodes = [data.languageCode, ...(data.fallbackLanguageCodes ?? [])].filter(
        (code, index, list) => code && list.indexOf(code) === index,
      );

      let create = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/exam_reservations",
        {
          method: "POST",
          query: LOCALE_QUERY,
          body: buildSvpReservationBody({
            examSessionId: bookSessionId,
            occupationId: data.occupationId,
            languageCode: languageCodes[0]!,
            methodology: data.methodology ?? "in_person",
            duration: data.duration,
            startAt: data.startAt,
            siteId: data.siteId ?? null,
            siteCity: data.siteCity ?? null,
            holdId: data.holdId ?? null,
            countryId: data.countryId ?? null,
          }),
        },
      );

      for (const code of languageCodes.slice(1)) {
        if (create.ok) break;
        const message = parseSvpError(create.payload);
        // Only retry an explicit language validation error; preserve the selected
        // language for unrelated validation or ambiguous server failures.
        if (create.status !== 422 || !isSvpLanguageRejection(message)) break;
        create = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/exam_reservations",
          {
            method: "POST",
            query: LOCALE_QUERY,
            body: buildSvpReservationBody({
              examSessionId: bookSessionId,
              occupationId: data.occupationId,
              languageCode: code,
              methodology: data.methodology ?? "in_person",
              duration: data.duration,
              startAt: data.startAt,
              siteId: data.siteId ?? null,
              siteCity: data.siteCity ?? null,
              holdId: data.holdId ?? null,
              countryId: data.countryId ?? null,
            }),
          },
        );
      }

      if (!create.ok) {
        return failure(
          apiFailure(create.payload, "SVP did not accept the reservation. Check the details."),
        );
      }

      const reservation = parseSvpReservation(create.payload);
      if (!reservation.id) {
        return failure("SVP did not return a reservation number. Book again from the portal.");
      }

      const permissionsResponse = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/permissions",
        { query: LOCALE_QUERY },
      );
      const permissions = permissionsResponse.ok
        ? parseSvpPermissions(permissionsResponse.payload)
        : { freeReservations: false, targeted: false, countryId: null, countryName: null };

      if (permissions.freeReservations) {
        return {
          ok: true,
          data: {
            reservationId: reservation.id,
            paid: true,
            paymentRequired: false,
            credits: 0,
            message: "Reservation confirmed by SVP. No payment is required.",
          },
        };
      }

      const session = readStoredSvpSession(context.userId);
      let credits = 0;
      if (session?.svpUserId) {
        const creditsResponse = await svpAuthedRequest(
          context.userId,
          `/users/${encodeURIComponent(session.svpUserId)}/balance`,
          {
            query: {
              ...LOCALE_QUERY,
              methodology_type: "in_person",
              occupation_id: data.occupationId,
            },
          },
        );
        if (creditsResponse.ok) credits = parseSvpCredits(creditsResponse.payload);
      }

      if (credits > 0) {
        const payment = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/reservation_credits/use",
          {
            method: "POST",
            query: LOCALE_QUERY,
            body: {
              methodology_type: "in_person",
              reservation_id: reservation.id,
              occupation_id: data.occupationId,
            },
          },
        );
        if (payment.ok) {
          return {
            ok: true,
            data: {
              reservationId: reservation.id,
              paid: true,
              paymentRequired: false,
              credits,
              message: "Reservation confirmed and paid with SVP credits.",
            },
          };
        }
        return {
          ok: true,
          data: {
            reservationId: reservation.id,
            paid: false,
            paymentRequired: true,
            credits,
            message:
              parseSvpError(payment.payload) ??
              "Reservation created, but the credit payment did not complete. Pay in the official SVP portal.",
          },
        };
      }

      return {
        ok: true,
        data: {
          reservationId: reservation.id,
          paid: false,
          paymentRequired: true,
          credits,
          message:
            "Reservation created. Complete the payment in the official SVP portal to confirm it.",
        },
      };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The SVP reservation could not be created.");
    }
  });

export type SvpTicketFile = { base64: string; contentType: string };

/** Download the official SVP ticket PDF for a reservation. */
export const downloadSvpTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reservationId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpTicketFile>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedBinary(
        context.userId,
        `/individual_labor_space/tickets/${encodeURIComponent(data.reservationId)}/show_pdf`,
      );
      if (!response.ok || !response.base64) {
        return failure(response.message ?? "The SVP ticket could not be downloaded.");
      }
      return {
        ok: true,
        data: {
          base64: response.base64,
          contentType: response.contentType ?? "application/pdf",
        },
      };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The SVP ticket could not be downloaded.");
    }
  });

export type SvpAccountOverview = {
  permissions: SvpAccountPermissions;
  categories: SvpCategoryOption[];
  constraints: SvpConstraints;
  flags: SvpFeatureFlags;
  credits: number;
};

/** Everything the SVP account is allowed to do: country permissions, policies and flags. */
export const getSvpAccountOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ occupationId: z.number().int().positive().nullable().optional() }).parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpAccountOverview>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const [permissionsResponse, constraintsResponse, flagsResponse] = await Promise.all([
        svpAuthedRequest(context.userId, "/individual_labor_space/permissions", {
          query: LOCALE_QUERY,
        }),
        svpAuthedRequest(context.userId, "/individual_labor_space/exam_constraints", {
          query: LOCALE_QUERY,
        }),
        readSvpFlags(context.userId),
      ]);
      if (!permissionsResponse.ok) {
        return failure(
          apiFailure(permissionsResponse.payload, "SVP account permissions could not be loaded."),
        );
      }
      const permissions = parseSvpAccountPermissions(permissionsResponse.payload);
      const constraints: SvpConstraints = constraintsResponse.ok
        ? parseSvpConstraints(constraintsResponse.payload)
        : // Unknown, not zero: the reschedule UI must not claim "0 reschedules left" here.
          { rescheduleTimes: null, bookingHoldSeconds: null, cancellationLimitHours: null };
      const flags = flagsResponse.ok
        ? parseSvpFeatureFlags(flagsResponse.payload)
        : { rescheduleEnabled: false, creditsEnabled: false };

      const session = readStoredSvpSession(context.userId);
      let credits = 0;
      if (session?.svpUserId && data.occupationId) {
        credits = await readSvpCredits(context.userId, session.svpUserId, data.occupationId);
      }
      return {
        ok: true,
        data: {
          permissions,
          categories: parseSvpCategories(permissionsResponse.payload),
          constraints,
          flags,
          credits,
        },
      };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("SVP account permissions could not be loaded.");
    }
  });

/** Full reservation record, including whether SVP allows rescheduling it. */
export const getSvpReservationDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reservationId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpReservationDetail>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        `/individual_labor_space/exam_reservations/${encodeURIComponent(data.reservationId)}`,
        { query: LOCALE_QUERY },
      );
      if (!response.ok) {
        return failure(apiFailure(response.payload, "The reservation could not be loaded."));
      }
      const detail = parseSvpReservationDetail(response.payload);
      if (!detail) return failure("SVP did not return reservation details.");
      return { ok: true, data: detail };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The reservation could not be loaded.");
    }
  });

/** Available dates for rescheduling, starting two days ahead like the portal. */
export const listSvpRescheduleDates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reservationId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
        categoryId: z.number().int().positive(),
        countryId: z.number().int().positive().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpAvailableDate[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const from = new Date(Date.now() + 6 * 60 * 60 * 1000);
      from.setUTCDate(from.getUTCDate() + 2);
      const response = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/exam_sessions/available_dates",
        {
          query: {
            ...LOCALE_QUERY,
            reservation_id: data.reservationId,
            category_id: data.categoryId,
            ...(data.countryId ? { country_id: data.countryId } : {}),
            start_at_date_from: from.toISOString().slice(0, 10),
            available_seats: "greater_than::0",
            status: "scheduled",
            per_page: 1000,
          },
        },
      );
      if (!response.ok) {
        return failure(apiFailure(response.payload, "Reschedule dates could not be loaded."));
      }
      return { ok: true, data: parseSvpAvailableDates(response.payload) };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("Reschedule dates could not be loaded.");
    }
  });

/**
 * Real SVP reschedule, implemented exactly like the new booking flow: hold the new
 * seat (all date tokens in load-balancer mode, with country/category like the
 * booking hold), book the session token SVP assigns on the hold, and retry rejected
 * language codes with the SVP-owned fallback codes.
 */
export const rescheduleSvpBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reservationId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
        examSessionId: svpExamSessionIdSchema,
        languageCode: svpLanguageCodeSchema,
        /** Every session token for the date in load-balancer mode, like the booking hold. */
        sessionIds: svpExamSessionIdListSchema.optional(),
        countryId: z.number().int().positive().nullable().optional(),
        categoryId: z.number().int().positive().nullable().optional(),
        /** SVP-owned language/prometric codes to try if the first one is rejected. */
        fallbackLanguageCodes: z.array(svpLanguageCodeSchema).max(6).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<{ message: string }>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const [detailResponse, constraintsResponse, flagsResponse] = await Promise.all([
        svpAuthedRequest(
          context.userId,
          `/individual_labor_space/exam_reservations/${encodeURIComponent(data.reservationId)}`,
          { query: LOCALE_QUERY },
        ),
        svpAuthedRequest(context.userId, "/individual_labor_space/exam_constraints", {
          query: LOCALE_QUERY,
        }),
        readSvpFlags(context.userId),
      ]);

      if (detailResponse.ok) {
        const detail = parseSvpReservationDetail(detailResponse.payload);
        if (detail && !detail.canBeRescheduled) {
          return failure("SVP does not allow rescheduling this reservation.");
        }
      }
      if (flagsResponse.ok) {
        const flags = parseSvpFeatureFlags(flagsResponse.payload);
        if (!flags.rescheduleEnabled) {
          return failure("SVP rescheduling is disabled for this account.");
        }
      }
      if (constraintsResponse.ok) {
        const constraints = parseSvpConstraints(constraintsResponse.payload);
        if (constraints.rescheduleTimes <= 0) {
          return failure("No reschedules are left for this reservation.");
        }
      }

      // Same hold as the booking flow: the whole day's tokens in load-balancer mode,
      // a single session id otherwise, always in_person with country + category.
      const holdIds =
        data.sessionIds && data.sessionIds.length > 0 ? data.sessionIds : [data.examSessionId];
      const hold = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/temporary_seats",
        {
          method: "POST",
          query: LOCALE_QUERY,
          body: {
            exam_session_id: holdIds.length > 1 ? holdIds : holdIds[0],
            methodology: "in_person",
            country_id: data.countryId ?? null,
            category_id: data.categoryId ?? null,
          },
        },
      );
      if (!hold.ok) {
        return failure(
          apiFailure(hold.payload, "SVP could not hold the new seat. Choose another session."),
        );
      }
      // The hold response carries the assigned session token; the reservation must use
      // it even when it differs from the requested id. exam_session_id 0 is a broken hold.
      const holdRoot = record(hold.payload);
      const holdPayload = record(holdRoot?.["data"]) ?? holdRoot;
      const assignedRaw = holdPayload?.["exam_session_id"] ?? holdRoot?.["exam_session_id"];
      if (assignedRaw === 0 || assignedRaw === "0") {
        return failure("SVP did not assign a session for this date. Choose another session.");
      }
      const assignedSessionId = parseSvpHoldSessionId(hold.payload);
      if (assignedSessionId === null) {
        return failure("SVP did not assign a session for this date. Choose another session.");
      }

      // SVP rejects a language code that is not one of its prometric codes; retry with
      // the SVP-owned codes exactly like the booking flow.
      const languageCodes = [data.languageCode, ...(data.fallbackLanguageCodes ?? [])].filter(
        (code, index, list) => code && list.indexOf(code) === index,
      );
      const path = `/individual_labor_space/exam_reservations/${encodeURIComponent(
        data.reservationId,
      )}/reschedule`;
      let response = await svpAuthedRequest(context.userId, path, {
        method: "POST",
        query: LOCALE_QUERY,
        body: {
          id: data.reservationId,
          exam_session_id: assignedSessionId,
          language_code: languageCodes[0]!,
          methodology: "in_person",
        },
      });
      for (const code of languageCodes.slice(1)) {
        if (response.ok) break;
        const message = parseSvpError(response.payload);
        if (response.status !== 422 || !isSvpLanguageRejection(message)) break;
        response = await svpAuthedRequest(context.userId, path, {
          method: "POST",
          query: LOCALE_QUERY,
          body: {
            id: data.reservationId,
            exam_session_id: assignedSessionId,
            language_code: code,
            methodology: "in_person",
          },
        });
      }
      if (!response.ok) {
        return failure(
          apiFailure(response.payload, "SVP did not accept the reschedule. Check the policy."),
        );
      }
      return { ok: true, data: { message: "Appointment rescheduled with SVP." } };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The appointment could not be rescheduled.");
    }
  });

/** Site availability for non-targeted (site-based) countries. */
export const listSvpPrometricSites = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        prometricCode: svpLanguageCodeSchema,
        city: z.string().trim().min(1).max(120),
        countryId: z.number().int().positive().nullable().optional(),
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpPrometricSiteList>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const now = new Date();
      const month = data.month ?? now.toISOString().slice(0, 7);
      const dateRange = getSvpMonthDateRange(month, now);
      if (!dateRange) {
        return failure("Choose the current month or one of the next 11 months.");
      }
      const response = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/prometric_scheduling/sites_availabilities",
        {
          query: {
            ...LOCALE_QUERY,
            prometric_code: data.prometricCode,
            city: data.city,
            start_date: dateRange.startDate,
            end_date: dateRange.endDate,
            ...(data.countryId ? { country_id: data.countryId } : {}),
          },
        },
      );
      if (!response.ok) {
        return failure(apiFailure(response.payload, "Test center sites could not be loaded."));
      }
      return { ok: true, data: parseSvpPrometricSites(response.payload) };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("Test center sites could not be loaded.");
    }
  });

/** Free slots for the selected day across the given sites. */
export const listSvpPrometricSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        examId: z.string().trim().min(1).max(40),
        siteIds: z.array(z.number().int().positive()).min(1).max(200),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpPrometricSlot[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/prometric_scheduling/slots_availabilities",
        {
          query: {
            ...LOCALE_QUERY,
            site_ids: data.siteIds,
            exam_id: data.examId,
            start_date: data.date,
            end_date: data.date,
          },
        },
      );
      if (!response.ok) {
        return failure(apiFailure(response.payload, "Slots could not be loaded."));
      }
      return { ok: true, data: parseSvpPrometricSlots(response.payload) };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("Slots could not be loaded.");
    }
  });

/** Hold a selected slot before creating the site-based reservation. */
export const createSvpPrometricHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        slotId: z.string().trim().min(1).max(64),
        siteId: z.number().int().positive(),
      })
      .parse(input),
  )
  .handler(
    async ({ context, data }): Promise<SvpResult<{ holdId: string; expiresAt: string | null }>> => {
      await requireSvpAllowedRole(context.supabase, context.userId);
      try {
        const response = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/prometric_scheduling/slots_availabilities",
          {
            method: "POST",
            query: LOCALE_QUERY,
            body: { slot_id: data.slotId, site_id: data.siteId },
          },
        );
        if (!response.ok) {
          return failure(apiFailure(response.payload, "SVP could not hold this slot."));
        }
        const root = record(response.payload);
        const payload = record(root?.["data"]) ?? root;
        const holdValue = payload?.["id"] ?? root?.["id"];
        if (holdValue === undefined || holdValue === null) {
          return failure("SVP did not return a seat hold. Choose another slot.");
        }
        return {
          ok: true,
          data: {
            holdId: String(holdValue),
            expiresAt: typeof payload?.["expired_at"] === "string" ? payload["expired_at"] : null,
          },
        };
      } catch (error) {
        if (error instanceof SvpSessionMissingError) return failure(error.message, true);
        return failure("SVP could not hold this slot.");
      }
    },
  );

/** Shared reschedule gates: reservation flag, feature flag and remaining quota. */
async function assertRescheduleAllowed(
  userId: string,
  reservationId: string,
): Promise<{ ok: false; message: string; needsSignIn: boolean } | null> {
  const [detailResponse, constraintsResponse, flagsResponse] = await Promise.all([
    svpAuthedRequest(
      userId,
      `/individual_labor_space/exam_reservations/${encodeURIComponent(reservationId)}`,
      { query: LOCALE_QUERY },
    ),
    svpAuthedRequest(userId, "/individual_labor_space/exam_constraints", { query: LOCALE_QUERY }),
    readSvpFlags(userId),
  ]);

  if (detailResponse.ok) {
    const detail = parseSvpReservationDetail(detailResponse.payload);
    if (detail && !detail.canBeRescheduled) {
      return failure("SVP does not allow rescheduling this reservation.");
    }
  }
  if (flagsResponse.ok) {
    const flags = parseSvpFeatureFlags(flagsResponse.payload);
    if (!flags.rescheduleEnabled) {
      return failure("SVP rescheduling is disabled for this account.");
    }
  }
  if (constraintsResponse.ok) {
    const constraints = parseSvpConstraints(constraintsResponse.payload);
    if (constraints.rescheduleTimes <= 0) {
      return failure("No reschedules are left for this reservation.");
    }
  }
  return null;
}

/**
 * Site-based (non-targeted) reschedule: hold the new slot, then reschedule with
 * the prometric exam id + site/hold fields. Some SVP deployments expect the
 * slot id instead, so a rejected request is retried with that shape.
 */
export const rescheduleSvpSiteBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reservationId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
        examId: z.string().trim().min(1).max(40),
        slotId: z.string().trim().min(1).max(64),
        siteId: z.number().int().positive(),
        siteCity: z.string().trim().max(120).nullable().optional(),
        languageCode: svpLanguageCodeSchema,
        duration: z.number().nonnegative().nullable().optional(),
        startAt: z.string().trim().max(64).nullable().optional(),
        categoryId: z.number().int().positive(),
        countryId: z.number().int().positive().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<{ message: string }>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const blocked = await assertRescheduleAllowed(context.userId, data.reservationId);
      if (blocked) return blocked;

      const hold = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/prometric_scheduling/slots_availabilities",
        {
          method: "POST",
          query: LOCALE_QUERY,
          body: { slot_id: data.slotId, site_id: data.siteId },
        },
      );
      if (!hold.ok) {
        return failure(apiFailure(hold.payload, "SVP could not hold the new slot."));
      }
      const holdRoot = record(hold.payload);
      const holdPayload = record(holdRoot?.["data"]) ?? holdRoot;
      const holdValue = holdPayload?.["id"] ?? holdRoot?.["id"];
      const holdId =
        holdValue === undefined || holdValue === null ? null : String(holdValue).trim();
      if (!holdId || holdId === "0") {
        return failure("SVP did not return a seat hold. Choose another slot.");
      }

      if (holdId) {
        await svpAuthedRequest(context.userId, "/individual_labor_space/temporary_seats", {
          method: "POST",
          query: LOCALE_QUERY,
          body: {
            exam_session_id: holdId,
            methodology: "in_person",
            country_id: data.countryId ?? null,
            category_id: data.categoryId,
          },
        }).catch(() => undefined);
      }

      const path = `/individual_labor_space/exam_reservations/${encodeURIComponent(
        data.reservationId,
      )}/reschedule`;

      let response = await svpAuthedRequest(context.userId, path, {
        method: "POST",
        query: LOCALE_QUERY,
        body: {
          id: data.reservationId,
          exam_session_id: data.examId,
          language_code: data.languageCode,
          methodology: "in_person",
          site_id: data.siteId,
          site_city: data.siteCity ?? null,
          hold_id: holdId,
          duration: data.duration,
          start_at: data.startAt,
          country_id: data.countryId ?? null,
        },
      });

      // Retry only a rejected payload; server/network errors may follow a successful
      // mutation and must not submit the same reschedule twice.
      if (!response.ok && response.status === 422) {
        response = await svpAuthedRequest(context.userId, path, {
          method: "POST",
          query: LOCALE_QUERY,
          body: {
            id: data.reservationId,
            exam_session_id: data.slotId,
            language_code: data.languageCode,
            methodology: "in_person",
            site_id: data.siteId,
            site_city: data.siteCity ?? null,
            hold_id: holdId,
          },
        });
      }

      if (!response.ok) {
        return failure(
          apiFailure(response.payload, "SVP did not accept the site-based reschedule."),
        );
      }
      return { ok: true, data: { message: "Appointment rescheduled with SVP." } };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The appointment could not be rescheduled.");
    }
  });

/** Temporary seat hold for a targeted exam session (portal summary step). */
export const createSvpTargetedHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        examSessionId: z.union([svpExamSessionIdSchema, svpExamSessionIdListSchema]),
        categoryId: z.number().int().positive(),
        countryId: z.number().int().positive().nullable().optional(),
      })
      .parse(input),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<SvpResult<{ expiresAt: string | null; examSessionId: string | number | null }>> => {
      await requireSvpAllowedRole(context.supabase, context.userId);
      try {
        const response = await svpAuthedRequest(
          context.userId,
          "/individual_labor_space/temporary_seats",
          {
            method: "POST",
            query: LOCALE_QUERY,
            body: {
              exam_session_id: data.examSessionId,
              methodology: "in_person",
              country_id: data.countryId ?? null,
              category_id: data.categoryId,
            },
          },
        );
        if (!response.ok) {
          return failure(
            apiFailure(response.payload, "SVP could not hold this seat.", response.status),
          );
        }
        const root = record(response.payload);
        const payload = record(root?.["data"]) ?? root;
        const expires = payload?.["expired_at"] ?? root?.["expired_at"];
        return {
          ok: true,
          data: {
            expiresAt: typeof expires === "string" ? expires : null,
            // Same parser as booking/reschedule: 0 is a broken hold, not a session id.
            examSessionId: parseSvpHoldSessionId(response.payload),
          },
        };
      } catch (error) {
        if (error instanceof SvpSessionMissingError) return failure(error.message, true);
        return failure("SVP could not hold this seat.");
      }
    },
  );

/** One targeted exam session by its (often string) token. */
export const getSvpExamSessionById = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ examSessionId: svpExamSessionIdStringSchema }).parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpExamSession>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        `/individual_labor_space/exam_sessions/${encodeURIComponent(data.examSessionId)}`,
        { query: LOCALE_QUERY },
      );
      if (!response.ok) {
        return failure(apiFailure(response.payload, "The exam session could not be loaded."));
      }
      const session = parseSvpExamSession(response.payload);
      if (!session) return failure("SVP did not return the assigned session.");
      return { ok: true, data: session };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The exam session could not be loaded.");
    }
  });

export type SvpDiagnostics = {
  login: string | null;
  svpUserId: string | null;
  countryTargeted: boolean | null;
  countryLoadBalancer: boolean | null;
  permissions: {
    status: number;
    ok: boolean;
    targeted: boolean | null;
    loadBalancer: boolean | null;
    country: string | null;
  };
  labor: { status: number; ok: boolean; count: number; message: string | null };
  visitor: { status: number; ok: boolean; count: number; message: string | null };
};

/** One-click SVP diagnostics for the booking page (no tokens returned). */
export const getSvpDiagnostics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SvpResult<SvpDiagnostics>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    const session = readStoredSvpSession(context.userId);
    if (!session) return failure("Sign in to SVP first.", true);
    try {
      const [permissionsResponse, laborResponse, visitorResponse] = await Promise.all([
        svpAuthedRequest(
          context.userId,
          "/individual_labor_space/permissions",
          { query: LOCALE_QUERY, timeoutMs: 8000, retries: 1 },
          session,
        ),
        svpAuthedRequest(
          context.userId,
          "/individual_labor_space/occupations",
          {
            query: { ...LOCALE_QUERY, per_page: 5, page: 1, name: "" },
            timeoutMs: 8000,
            retries: 1,
          },
          session,
        ),
        svpAuthedRequest(
          context.userId,
          "/visitor_space/occupations",
          { query: { ...LOCALE_QUERY, per_page: 5, page: 1 }, timeoutMs: 8000, retries: 1 },
          session,
        ),
      ]);

      const permissions = permissionsResponse.ok
        ? parseSvpPermissions(permissionsResponse.payload)
        : { targeted: null, loadBalancer: null, countryName: null };
      const laborItems = laborResponse.ok ? parseSvpOccupations(laborResponse.payload) : [];
      const visitorItems = visitorResponse.ok ? parseSvpOccupations(visitorResponse.payload) : [];

      return {
        ok: true,
        data: {
          login: session.login,
          svpUserId: session.svpUserId,
          countryTargeted: session.countryTargeted,
          countryLoadBalancer: session.countryLoadBalancer,
          permissions: {
            status: permissionsResponse.status,
            ok: permissionsResponse.ok,
            targeted: permissions.targeted,
            loadBalancer: permissions.loadBalancer,
            country: permissions.countryName,
          },
          labor: {
            status: laborResponse.status,
            ok: laborResponse.ok,
            count: laborItems.length,
            message: laborResponse.message,
          },
          visitor: {
            status: visitorResponse.status,
            ok: visitorResponse.ok,
            count: visitorItems.length,
            message: visitorResponse.message,
          },
        },
      };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("Diagnostics could not run.");
    }
  });

export type SvpPaymentSession = {
  paymentId: string;
  amount: number | null;
  hyperpayUrl: string | null;
  checkoutId: string | null;
  integrity: string | null;
};

/**
 * Real SVP reservation payment: POST /individual_labor_space/payments with
 * { payment: { payment_method: "card", payable_type: "Reservation", payable_id } }.
 * Returns the HyperPay checkout data used by the official payment widget.
 */
export const startSvpReservationPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reservationId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpPaymentSession>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(context.userId, "/individual_labor_space/payments", {
        method: "POST",
        query: LOCALE_QUERY,
        body: buildSvpReservationPaymentBody(data.reservationId),
      });
      if (!response.ok) {
        return failure(
          apiFailure(response.payload, "SVP could not start the card payment.", response.status),
        );
      }
      const root = record(response.payload);
      const payload = record(root?.["data"]) ?? root;
      const idValue = payload?.["id"];
      if (idValue === undefined || idValue === null) {
        return failure("SVP did not return a payment id.");
      }
      const provider = record(payload?.["response"]);
      return {
        ok: true,
        data: {
          paymentId: String(idValue),
          amount: typeof payload?.["amount"] === "number" ? payload["amount"] : null,
          hyperpayUrl:
            typeof payload?.["hyperpay_url"] === "string" ? payload["hyperpay_url"] : null,
          checkoutId:
            typeof provider?.["ndc"] === "string"
              ? provider["ndc"]
              : typeof payload?.["ndc"] === "string"
                ? payload["ndc"]
                : null,
          integrity:
            typeof provider?.["integrity"] === "string"
              ? provider["integrity"]
              : typeof payload?.["integrity"] === "string"
                ? payload["integrity"]
                : null,
        },
      };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("SVP could not start the card payment.");
    }
  });

/** Verify a payment with PUT /individual_labor_space/payments/{id}. */
export const getSvpPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        paymentId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
      })
      .parse(input),
  )
  .handler(
    async ({
      context,
      data,
    }): Promise<
      SvpResult<{ transactionStatus: string | null; reservationId: string | null; paid: boolean }>
    > => {
      await requireSvpAllowedRole(context.supabase, context.userId);
      try {
        const response = await svpAuthedRequest(
          context.userId,
          `/individual_labor_space/payments/${encodeURIComponent(data.paymentId)}`,
          { method: "PUT", query: LOCALE_QUERY },
        );
        if (!response.ok) {
          return failure(
            apiFailure(
              response.payload,
              "The payment status could not be checked.",
              response.status,
            ),
          );
        }
        const root = record(response.payload);
        const payload = record(root?.["data"]) ?? root;
        const reservation = record(payload?.["reservation"]);
        const status =
          typeof payload?.["transaction_status"] === "string"
            ? payload["transaction_status"]
            : null;
        return {
          ok: true,
          data: {
            transactionStatus: status,
            reservationId:
              reservation?.["id"] === undefined || reservation?.["id"] === null
                ? null
                : String(reservation["id"]),
            paid: status === "success" || status === "completed",
          },
        };
      } catch (error) {
        if (error instanceof SvpSessionMissingError) return failure(error.message, true);
        return failure("The payment status could not be checked.");
      }
    },
  );

/** Card payments recorded on the signed-in labor account (GET /payments). */
export const listSvpPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SvpResult<SvpPaymentRow[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(context.userId, "/individual_labor_space/payments", {
        query: LOCALE_QUERY,
      });
      if (!response.ok) {
        return failure(
          apiFailure(response.payload, "SVP payments could not be loaded.", response.status),
        );
      }
      return { ok: true, data: parseSvpPayments(response.payload) };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("SVP payments could not be loaded.");
    }
  });

/** One card payment with its gateway status (GET /payments/{id}). */
export const getSvpPaymentDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        paymentId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpPaymentRow>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        `/individual_labor_space/payments/${encodeURIComponent(data.paymentId)}`,
        { query: LOCALE_QUERY },
      );
      if (!response.ok) {
        return failure(
          apiFailure(response.payload, "The payment could not be loaded.", response.status),
        );
      }
      const payment = parseSvpPayment(response.payload);
      if (!payment) return failure("SVP did not return this payment.");
      return { ok: true, data: payment };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The payment could not be loaded.");
    }
  });

/** In-app SVP notifications (GET /notifications). */
export const listSvpNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SvpResult<SvpNotification[]>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/notifications",
        { query: LOCALE_QUERY },
      );
      if (!response.ok) {
        return failure(
          apiFailure(response.payload, "SVP notifications could not be loaded.", response.status),
        );
      }
      return { ok: true, data: parseSvpNotifications(response.payload) };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("SVP notifications could not be loaded.");
    }
  });

/** Certificate price for the account's country (GET /certificate_price). */
export const getSvpCertificatePrice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SvpResult<SvpCertificatePrice>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedRequest(
        context.userId,
        "/individual_labor_space/certificate_price",
        { query: LOCALE_QUERY },
      );
      if (!response.ok) {
        return failure(
          apiFailure(
            response.payload,
            "The certificate price could not be loaded.",
            response.status,
          ),
        );
      }
      return { ok: true, data: parseSvpCertificatePrice(response.payload) };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The certificate price could not be loaded.");
    }
  });

/** Cancel an SVP reservation (DELETE /exam_reservations/{id}). */
export const cancelSvpReservation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        reservationId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
      })
      .parse(input),
  )
  .handler(
    async ({ context, data }): Promise<SvpResult<{ reservationId: string; message: string }>> => {
      await requireSvpAllowedRole(context.supabase, context.userId);
      try {
        const response = await svpAuthedRequest(
          context.userId,
          `/individual_labor_space/exam_reservations/${encodeURIComponent(data.reservationId)}`,
          { method: "DELETE", query: LOCALE_QUERY },
        );
        if (!response.ok) {
          return failure(
            apiFailure(response.payload, "SVP could not cancel this reservation.", response.status),
          );
        }
        return {
          ok: true,
          data: {
            reservationId: data.reservationId,
            message: "Reservation cancelled in SVP.",
          },
        };
      } catch (error) {
        if (error instanceof SvpSessionMissingError) return failure(error.message, true);
        return failure("SVP could not cancel this reservation.");
      }
    },
  );

/** Official invoice PDF for a completed payment. */
export const downloadSvpInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        invoiceId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpTicketFile>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedBinary(
        context.userId,
        `/individual_labor_space/invoices/${encodeURIComponent(data.invoiceId)}/show_pdf`,
      );
      if (!response.ok || !response.base64) {
        return failure(response.message ?? "The invoice could not be downloaded.");
      }
      return {
        ok: true,
        data: { base64: response.base64, contentType: response.contentType ?? "application/pdf" },
      };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The invoice could not be downloaded.");
    }
  });

/** Real SVP certificate PDF for a passed reservation (`/certificates/{id}/show_pdf`). */
export const downloadSvpCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        certificateId: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9-]{1,64}$/),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SvpResult<SvpTicketFile>> => {
    await requireSvpAllowedRole(context.supabase, context.userId);
    try {
      const response = await svpAuthedBinary(
        context.userId,
        `/individual_labor_space/certificates/${encodeURIComponent(data.certificateId)}/show_pdf`,
      );
      if (!response.ok || !response.base64) {
        return failure(response.message ?? "The certificate could not be downloaded.");
      }
      return {
        ok: true,
        data: { base64: response.base64, contentType: response.contentType ?? "application/pdf" },
      };
    } catch (error) {
      if (error instanceof SvpSessionMissingError) return failure(error.message, true);
      return failure("The certificate could not be downloaded.");
    }
  });
