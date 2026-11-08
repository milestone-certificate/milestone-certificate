import { svpLanguageLabel, svpLanguageOptions } from "@/lib/svp-language.shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock3, LoaderCircle, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/app/ui-bits";
import { SvpSessionOptions } from "@/components/app/SvpSessionOptions";
import { SvpDateCalendar } from "@/components/app/SvpDateCalendar";
import { formatSvpDateTime } from "@/lib/svp-time";
import {
  getSvpReservationDetail,
  getSvpOccupationById,
  listSvpExamSessions,
  listSvpPrometricSites,
  listSvpPrometricSlots,
  listSvpRescheduleDates,
  rescheduleSvpBooking,
  rescheduleSvpSiteBooking,
} from "@/lib/svp-booking.functions";
import type {
  SvpAvailableDate,
  SvpExamSession,
  SvpPrometricSite,
  SvpPrometricSlot,
} from "@/lib/svp-api.shared";
import { lookupTakamolAvailability } from "@/lib/takamol-availability.functions";
import {
  mapTakamolRowsToSvpSlots,
  parseCities,
  parseOccupationLanguages,
  parseTakamolRescheduleRows,
  parseTestCenters,
} from "@/lib/takamol-availability.ui";

function splitDateTime(value: string): { date: string; time: string } {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);
  if (match) return { date: match[1] ?? "", time: match[2] ?? "" };
  return { date: value.slice(0, 10), time: "" };
}

function hashSlotId(value: string): number {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash || 1;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildMonthOptions(now = new Date()): Array<{ value: string; label: string }> {
  return Array.from({ length: 12 }, (_, offset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    return {
      value: monthKey(date),
      label: new Intl.DateTimeFormat("en", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(date),
    };
  });
}

export function SvpReschedulePanel({
  reservationId,
  rescheduleTimes,
  countryId,
  categoryId,
  isTargeted = true,
  loadBalancer = false,
  onCancel,
  onDone,
  onReconnect,
}: {
  reservationId: string;
  rescheduleTimes: number | null;
  countryId?: number | null;
  categoryId?: number | null;
  isTargeted?: boolean;
  /** Targeted dates are load-balancer tokens in some countries, exactly like booking. */
  loadBalancer?: boolean;
  onCancel: () => void;
  onReconnect?: () => void;
  onDone: (
    result: { startAt: string; city: string | null; centerName: string | null } | null,
  ) => void;
}) {
  const queryClient = useQueryClient();
  const [city, setCity] = useState<string | null>(null);
  const [languageCode, setLanguageCode] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()));
  const [selectedDate, setSelectedDate] = useState<SvpAvailableDate | null>(null);
  const [selectedSession, setSelectedSession] = useState<SvpExamSession | null>(null);
  const [prometricDate, setPrometricDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SvpPrometricSlot | null>(null);
  const [done, setDone] = useState(false);
  // The appointment SVP actually stored; load-balancer holds can assign a different
  // session than the one the agent picked, so this is read back after the reschedule.
  const [confirmed, setConfirmed] = useState<{
    startAt: string;
    city: string | null;
    centerName: string | null;
  } | null>(null);

  const detailQuery = useQuery({
    queryKey: ["svp-reservation-detail", reservationId],
    queryFn: () => getSvpReservationDetail({ data: { reservationId } }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const detail = detailQuery.data?.ok ? detailQuery.data.data : null;
  const detailNeedsSignIn = Boolean(
    detailQuery.data && !detailQuery.data.ok && detailQuery.data.needsSignIn,
  );
  const currentLanguageCode = detail?.languageCode?.trim() ?? "";
  const effectiveCountryId = detail?.countryId ?? countryId ?? null;
  const occupationQuery = useQuery({
    queryKey: ["svp-reschedule-occupation", reservationId, detail?.occupationId],
    queryFn: () =>
      getSvpOccupationById({
        data: {
          occupationId: detail!.occupationId!,
          ...(detail?.occupationName ? { name: detail.occupationName } : {}),
        },
      }),
    enabled: detail?.occupationId != null,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const occupation = occupationQuery.data?.ok ? occupationQuery.data.data : null;
  const effectiveCategoryId = detail?.categoryId ?? categoryId ?? occupation?.categoryId ?? null;
  const takamolOccupationsQuery = useQuery({
    queryKey: ["takamol-occupations"],
    queryFn: () => lookupTakamolAvailability({ data: { endpoint: "occupations" } }),
    enabled: detail != null,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const takamolLanguageCode = useMemo(() => {
    if (!takamolOccupationsQuery.data?.success) return null;
    const entries = parseOccupationLanguages(takamolOccupationsQuery.data.data);
    return (
      entries.find((entry) => Number(entry.occupationId) === detail?.occupationId)?.languageCode ??
      (occupation?.occupationKey
        ? entries.find((entry) => entry.occupationKey === occupation.occupationKey)?.languageCode
        : null) ??
      null
    );
  }, [detail?.occupationId, occupation?.occupationKey, takamolOccupationsQuery.data]);
  const languageOptions = useMemo(() => {
    const options = svpLanguageOptions(
      occupation?.languages ?? [],
      detail?.languages ?? [],
      isTargeted,
    );
    if (
      currentLanguageCode &&
      !options.some(
        (entry) =>
          entry.code === currentLanguageCode ||
          svpLanguageLabel(entry.label) === svpLanguageLabel(currentLanguageCode),
      )
    ) {
      options.push({
        code: currentLanguageCode,
        label: currentLanguageCode,
        questionCount: null,
        nonTargeted: !isTargeted,
      });
    }
    return options;
  }, [occupation?.languages, detail?.languages, isTargeted, currentLanguageCode]);
  const languageChoices = takamolLanguageCode
    ? [
        {
          code: takamolLanguageCode,
          label:
            occupation?.languages?.find((entry) => entry.code === takamolLanguageCode)?.label ??
            detail?.languages.find((entry) => entry.code === takamolLanguageCode)?.label ??
            languageOptions.find((entry) => entry.code === takamolLanguageCode)?.label ??
            takamolLanguageCode,
        },
      ]
    : languageOptions;
  const currentLanguage =
    languageOptions.find((entry) => entry.code === currentLanguageCode) ??
    languageOptions.find(
      (entry) => svpLanguageLabel(entry.label) === svpLanguageLabel(currentLanguageCode),
    );
  const activeLanguage =
    takamolLanguageCode ??
    (languageOptions.some((entry) => entry.code === languageCode)
      ? languageCode
      : (currentLanguage?.code ?? (languageOptions.length === 1 ? languageOptions[0].code : "")));
  const languagesLoading = occupationQuery.isFetching || takamolOccupationsQuery.isFetching;
  const fallbackLanguageCodes = languageOptions
    .map((entry) => entry.code)
    .filter((code) => code !== activeLanguage)
    .slice(0, 6);
  const monthOptions = useMemo(() => buildMonthOptions(), []);
  const datesQuery = useQuery({
    queryKey: ["svp-reschedule-dates", reservationId, effectiveCategoryId, effectiveCountryId],
    queryFn: () =>
      listSvpRescheduleDates({
        data: {
          reservationId,
          categoryId: effectiveCategoryId as number,
          countryId: effectiveCountryId,
        },
      }),
    enabled: isTargeted && effectiveCategoryId != null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const dates = useMemo(() => (datesQuery.data?.ok ? datesQuery.data.data : []), [datesQuery.data]);
  const citiesQuery = useQuery({
    queryKey: ["takamol-reschedule-cities", effectiveCategoryId],
    queryFn: () =>
      lookupTakamolAvailability({
        data: { endpoint: "cities", categoryId: String(effectiveCategoryId) },
      }),
    enabled: !isTargeted && effectiveCategoryId != null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const takamolCities = useMemo(
    () => (citiesQuery.data?.success ? parseCities(citiesQuery.data.data) : []),
    [citiesQuery.data],
  );
  const cityListFailed =
    citiesQuery.isError || Boolean(citiesQuery.data && !citiesQuery.data.success);
  const cityListEmpty = Boolean(citiesQuery.data?.success && takamolCities.length === 0);
  const cityOptions = useMemo(() => {
    const available = isTargeted
      ? dates
          .filter((entry) => entry.seats !== 0)
          .map((entry) => entry.city)
          .filter((entry): entry is string => Boolean(entry))
      : takamolCities;
    const keepCurrent = isTargeted
      ? !datesQuery.data || dates.some((entry) => !entry.city && entry.seats !== 0)
      : available.length === 0;
    const values = keepCurrent && detail?.city ? [...available, detail.city] : available;
    const unique = new Map<string, string>();
    for (const value of values) unique.set(value.trim().toLowerCase(), value.trim());
    return [...unique.values()].sort((a, b) => a.localeCompare(b));
  }, [dates, datesQuery.data, detail?.city, isTargeted, takamolCities]);
  const selectedCity =
    city !== null
      ? (cityOptions.find((entry) => entry.toLowerCase() === city.toLowerCase()) ?? "")
      : (cityOptions.find((entry) => entry.toLowerCase() === detail?.city?.trim().toLowerCase()) ??
        (cityOptions.length === 1 ? cityOptions[0] : ""));
  const dateOptions = useMemo(() => {
    const map = new Map<string, SvpAvailableDate>();
    for (const entry of dates) {
      if (entry.seats === 0 || !selectedCity) continue;
      if (entry.city && entry.city.trim().toLowerCase() !== selectedCity.toLowerCase()) continue;
      const { date } = splitDateTime(entry.startAt);
      if (date && !map.has(date)) map.set(date, entry);
    }
    return [...map.values()];
  }, [selectedCity, dates]);
  const centersQuery = useQuery({
    queryKey: ["takamol-reschedule-centers", selectedCity],
    queryFn: () => lookupTakamolAvailability({ data: { endpoint: "centers", city: selectedCity } }),
    enabled: !isTargeted && Boolean(selectedCity),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const takamolCenters = useMemo(
    () => (centersQuery.data?.success ? parseTestCenters(centersQuery.data.data) : []),
    [centersQuery.data],
  );

  const takamolSessionsQuery = useQuery({
    queryKey: ["takamol-reschedule-sessions", effectiveCategoryId, selectedCity, prometricDate],
    queryFn: () =>
      lookupTakamolAvailability({
        data: {
          endpoint: "sessions",
          categoryId: String(effectiveCategoryId),
          city: selectedCity,
          examDate: prometricDate as string,
        },
      }),
    enabled:
      !isTargeted && effectiveCategoryId != null && Boolean(selectedCity) && Boolean(prometricDate),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const takamolSessionRows = useMemo(
    () =>
      takamolSessionsQuery.data?.success
        ? parseTakamolRescheduleRows(
            takamolSessionsQuery.data.data,
            takamolCenters,
            selectedCity,
            prometricDate,
          )
        : [],
    [selectedCity, prometricDate, takamolCenters, takamolSessionsQuery.data],
  );
  // Mirror new booking: SVP site dates and slots drive the safe reschedule selection. Takamol
  // rows are used only as optional availability metadata, never to guess an SVP slot identifier.
  const sitesQuery = useQuery({
    queryKey: [
      "svp-reschedule-sites",
      activeLanguage,
      selectedCity,
      effectiveCountryId,
      selectedMonth,
    ],
    queryFn: () =>
      listSvpPrometricSites({
        data: {
          prometricCode: activeLanguage,
          city: selectedCity,
          countryId: effectiveCountryId,
          month: selectedMonth,
        },
      }),
    enabled: !isTargeted && Boolean(selectedCity) && Boolean(activeLanguage) && !languagesLoading,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const prometricSites: SvpPrometricSite[] = useMemo(
    () => (sitesQuery.data?.ok ? sitesQuery.data.data.sites : []),
    [sitesQuery.data],
  );
  const prometricExamId = sitesQuery.data?.ok ? sitesQuery.data.data.examId : null;
  const siteDateOptions = useMemo(() => {
    const map = new Map<string, { date: string; city: string | null }>();
    const today = new Date().toISOString().slice(0, 10);
    for (const site of prometricSites) {
      for (const date of site.dates) {
        if (date.slice(0, 7) !== selectedMonth) continue;
        if (selectedMonth === today.slice(0, 7) && date < today) continue;
        if (!map.has(date)) map.set(date, { date, city: site.city ?? selectedCity });
      }
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedCity, prometricSites, selectedMonth]);
  const siteIdsForDate = prometricSites
    .filter((site) => prometricDate && site.dates.includes(prometricDate))
    .map((site) => site.siteId);

  const slotsQuery = useQuery({
    queryKey: ["svp-reschedule-slots", prometricExamId, prometricDate, siteIdsForDate.join(",")],
    queryFn: () =>
      listSvpPrometricSlots({
        data: {
          examId: prometricExamId as string,
          siteIds: siteIdsForDate,
          date: prometricDate as string,
        },
      }),
    enabled:
      !isTargeted &&
      Boolean(prometricExamId) &&
      Boolean(prometricDate) &&
      siteIdsForDate.length > 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const prometricSlots: SvpPrometricSlot[] = useMemo(
    () => (slotsQuery.data?.ok ? slotsQuery.data.data : []),
    [slotsQuery.data],
  );
  const takamolSlotMappings = useMemo(
    () =>
      prometricDate
        ? mapTakamolRowsToSvpSlots(
            takamolSessionRows,
            prometricSites,
            prometricSlots,
            selectedCity,
            prometricDate,
          )
        : [],
    [selectedCity, prometricDate, prometricSites, prometricSlots, takamolSessionRows],
  );
  const slotSeats = useCallback(
    (slot: SvpPrometricSlot) =>
      slot.availableSeats ??
      takamolSlotMappings.find((entry) => entry.slot?.id === slot.id)?.row.seats ??
      null,
    [takamolSlotMappings],
  );
  const sessionDate = selectedDate ? splitDateTime(selectedDate.startAt).date : "";
  const sessionCity = selectedDate?.city ?? selectedCity;
  const sessionsQuery = useQuery({
    queryKey: ["svp-reschedule-sessions", effectiveCategoryId, sessionCity, sessionDate],
    queryFn: () =>
      listSvpExamSessions({
        data: {
          categoryId: effectiveCategoryId as number,
          city: sessionCity,
          examDate: sessionDate,
        },
      }),
    enabled:
      isTargeted && effectiveCategoryId != null && Boolean(sessionCity) && Boolean(sessionDate),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const sessions = useMemo(
    () => (sessionsQuery.data?.ok ? sessionsQuery.data.data : []),
    [sessionsQuery.data],
  );
  const currentSession = selectedSession
    ? (sessions.find((entry) => entry.id === selectedSession.id && entry.availableSeats !== 0) ??
      null)
    : null;
  const currentSlot = selectedSlot
    ? (prometricSlots.find(
        (slot) =>
          slot.id === selectedSlot.id &&
          slot.siteId === selectedSlot.siteId &&
          slotSeats(slot) !== 0,
      ) ?? null)
    : null;
  const availabilityQuery = isTargeted ? sessionsQuery : slotsQuery;
  const canConfirmReschedule =
    Boolean(detail?.canBeRescheduled) &&
    Boolean(activeLanguage) &&
    !languagesLoading &&
    !detailQuery.isFetching &&
    !detailQuery.isError &&
    (rescheduleTimes === null || rescheduleTimes > 0) &&
    !availabilityQuery.isFetching &&
    !availabilityQuery.isError &&
    Boolean(availabilityQuery.data?.ok) &&
    (isTargeted ? Boolean(currentSession) : Boolean(currentSlot && prometricExamId));

  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!canConfirmReschedule) {
        throw new Error("Availability changed. Select an available session again.");
      }
      if (isTargeted) {
        if (!currentSession) throw new Error("Choose a new session first.");
        const response = await rescheduleSvpBooking({
          data: {
            reservationId,
            examSessionId: currentSession.id,
            languageCode: activeLanguage,
            // Load-balancer dates are day tokens: hold every token SVP returned for
            // the date so SVP can assign the real session, exactly like booking.
            ...(loadBalancer && sessions.length > 0
              ? { sessionIds: sessions.map((entry) => entry.id) }
              : {}),
            countryId: effectiveCountryId,
            categoryId: effectiveCategoryId,
            ...(fallbackLanguageCodes.length > 0 ? { fallbackLanguageCodes } : {}),
          },
        });
        if (!response.ok) {
          // An expired SVP session must offer the reconnect flow, exactly like booking.
          if (response.needsSignIn) onReconnect?.();
          throw new Error(response.message);
        }
        return response.data;
      }

      if (!currentSlot?.siteId || !prometricExamId) {
        throw new Error("Choose a new slot first.");
      }
      const response = await rescheduleSvpSiteBooking({
        data: {
          reservationId,
          examId: prometricExamId,
          slotId: currentSlot.id,
          siteId: currentSlot.siteId,
          siteCity:
            prometricSites.find((site) => site.siteId === currentSlot.siteId)?.city ?? selectedCity,
          languageCode: activeLanguage,
          duration: currentSlot.duration,
          startAt: currentSlot.startAt,
          categoryId: effectiveCategoryId as number,
          countryId: effectiveCountryId,
        },
      });
      if (!response.ok) {
        if (response.needsSignIn) onReconnect?.();
        throw new Error(response.message);
      }
      return response.data;
    },
    onSuccess: async () => {
      // SVP may assign a different session than the one picked (load-balancer holds),
      // so report the appointment it actually stored instead of the local guess.
      try {
        const refreshed = await getSvpReservationDetail({ data: { reservationId } });
        if (refreshed.ok && refreshed.data.startAt) {
          setConfirmed({
            startAt: refreshed.data.startAt,
            city: refreshed.data.city,
            centerName: refreshed.data.centerName,
          });
        }
      } catch {
        // Fall back to the session the agent selected.
      }
      setDone(true);
      void queryClient.invalidateQueries({ queryKey: ["svp-reservations"] });
      void queryClient.invalidateQueries({ queryKey: ["svp-reservation-detail", reservationId] });
    },
  });

  const resetSelection = () => {
    setSelectedDate(null);
    setSelectedSession(null);
    setPrometricDate(null);
    setSelectedSlot(null);
  };

  const selectCity = (value: string) => {
    resetSelection();
    setCity(value);
  };

  useEffect(() => {
    setSelectedDate(null);
    setSelectedSession(null);
    setPrometricDate(null);
    setSelectedSlot(null);
  }, [selectedCity, activeLanguage]);

  const selectDateOption = (entry: { date: string; city: string | null }) => {
    setSelectedSession(null);
    setSelectedSlot(null);
    if (isTargeted) {
      setSelectedDate(
        dates.find(
          (candidate) =>
            splitDateTime(candidate.startAt).date === entry.date &&
            (!entry.city ||
              !candidate.city ||
              candidate.city.trim().toLowerCase() === entry.city.trim().toLowerCase()),
        ) ?? null,
      );
      if (entry.city) setCity(entry.city);
      return;
    }
    setPrometricDate(entry.date);
  };

  const chooseSlot = useCallback(
    (slot: SvpPrometricSlot) => {
      const site = prometricSites.find((entry) => entry.siteId === slot.siteId) ?? null;
      const numeric = Number(slot.id);
      setSelectedSlot(slot);
      setSelectedSession({
        id: Number.isFinite(numeric) ? numeric : hashSlotId(slot.id),
        startAt: slot.startAt,
        endAt: null,
        duration: slot.duration,
        availableSeats: slot.availableSeats ?? null,
        city: site?.city ?? selectedCity,
        centerName: site?.name ?? null,
        siteId: slot.siteId,
      });
    },
    [selectedCity, prometricSites],
  );

  useEffect(() => {
    if (
      !isTargeted ||
      !selectedDate ||
      selectedSession ||
      sessionsQuery.isFetching ||
      !sessionsQuery.data?.ok
    )
      return;
    const firstAvailable = sessions.find((session) => session.availableSeats !== 0);
    if (firstAvailable) setSelectedSession(firstAvailable);
  }, [
    isTargeted,
    selectedDate,
    selectedSession,
    sessions,
    sessionsQuery.isFetching,
    sessionsQuery.data,
  ]);

  useEffect(() => {
    if (isTargeted || !prometricDate || selectedSlot || prometricSlots.length === 0) return;
    const next = prometricSlots.find((slot) => slotSeats(slot) !== 0);
    if (next) chooseSlot(next);
  }, [chooseSlot, isTargeted, prometricDate, selectedSlot, slotSeats, prometricSlots]);

  if (detailQuery.isPending) {
    return (
      <section
        className="flex items-center gap-2 rounded-2xl border bg-card p-5 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle className="h-4 w-4 animate-spin" /> বুকিং আসছে…
      </section>
    );
  }

  if (detailQuery.isError || (detailQuery.data && !detailQuery.data.ok)) {
    return (
      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm">
        <h2 className="text-lg font-bold">তারিখ বদল</h2>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={detailQuery.isFetching}
          onClick={() =>
            detailNeedsSignIn && onReconnect ? onReconnect() : void detailQuery.refetch()
          }
        >
          <RotateCcw className="mr-1 h-4 w-4" />
          {detailNeedsSignIn && onReconnect ? "সংযোগ করুন" : "আবার দেখুন"}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
          <X className="mr-1 h-4 w-4" /> বন্ধ করুন
        </Button>
      </section>
    );
  }

  if (!detail) return null;

  // SVP reported the account has no reschedules left: the submit would be rejected, so do
  // not walk the agent through picking a date, center and slot first.
  if (rescheduleTimes !== null && rescheduleTimes <= 0) {
    return (
      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-bold">তারিখ বদল</h2>
        <Button type="button" variant="outline" disabled>
          এখন তারিখ বদলানো যাবে না
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          বন্ধ করুন
        </Button>
      </section>
    );
  }

  if (done) {
    const appointment =
      confirmed ??
      (selectedSession
        ? {
            startAt: selectedSession.startAt,
            city: selectedSession.city,
            centerName: selectedSession.centerName,
          }
        : null);
    return (
      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-soft text-success">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold">তারিখ বদল হয়েছে</h2>
            <p className="text-sm text-muted-foreground">
              নতুন সময়: {appointment ? formatSvpDateTime(appointment.startAt) : "—"}
            </p>
            {appointment?.centerName && (
              <p className="text-xs text-muted-foreground">{appointment.centerName}</p>
            )}
          </div>
        </div>
        <Button type="button" onClick={() => onDone(appointment)}>
          ঠিক আছে
        </Button>
      </section>
    );
  }

  if (!detail.canBeRescheduled) {
    return (
      <section className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <h2 className="text-lg font-bold">তারিখ বদল</h2>
        <Button type="button" variant="outline" disabled>
          এখন তারিখ বদলানো যাবে না
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          বন্ধ করুন
        </Button>
      </section>
    );
  }

  const shownDateOptions: Array<{ date: string; city: string | null; seats?: number | null }> =
    isTargeted
      ? dateOptions.map((entry) => ({
          date: splitDateTime(entry.startAt).date,
          city: entry.city ?? (selectedCity || null),
          seats: entry.seats,
        }))
      : siteDateOptions;
  const activeDateValue = isTargeted
    ? selectedDate
      ? splitDateTime(selectedDate.startAt).date
      : ""
    : (prometricDate ?? "");
  const datesLoading = isTargeted ? datesQuery.isFetching : sitesQuery.isFetching;
  const dateQuery = isTargeted ? datesQuery : sitesQuery;
  const datesFailed = dateQuery.isError || Boolean(dateQuery.data && !dateQuery.data.ok);
  const datesNeedSignIn = Boolean(
    dateQuery.data && !dateQuery.data.ok && dateQuery.data.needsSignIn,
  );
  const sessionViews = isTargeted
    ? sessions.map((entry) => ({
        key: `s-${entry.id}`,
        startAt: entry.startAt,
        endAt: entry.endAt,
        center: entry.centerName,
        city: entry.city ?? selectedCity,
        seats: entry.availableSeats,
        selected: selectedSession?.id === entry.id && !selectedSlot,
        onSelect: () => {
          setSelectedSession(entry);
          setSelectedSlot(null);
        },
      }))
    : prometricSlots.map((slot) => {
        const site = prometricSites.find((entry) => entry.siteId === slot.siteId) ?? null;
        const takamolMatch = takamolSlotMappings.find((entry) => entry.slot?.id === slot.id);
        return {
          key: `p-${slot.id}`,
          startAt: slot.startAt,
          center: site?.name ?? takamolMatch?.row.centerName ?? null,
          city: site?.city ?? selectedCity,
          seats: slotSeats(slot),
          selected: selectedSlot?.id === slot.id,
          onSelect: () => chooseSlot(slot),
        };
      });
  const sessionsLoading = isTargeted ? sessionsQuery.isFetching : slotsQuery.isFetching;
  const sessionsFailed =
    availabilityQuery.isError || Boolean(availabilityQuery.data && !availabilityQuery.data.ok);
  const sessionsLoaded = isTargeted
    ? Boolean(sessionsQuery.data?.ok)
    : Boolean(slotsQuery.data?.ok);
  const sessionsNeedSignIn = Boolean(
    availabilityQuery.data && !availabilityQuery.data.ok && availabilityQuery.data.needsSignIn,
  );
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold">তারিখ বদল</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {detail.occupationName ?? "পেশা"} · #{detail.id}
            {detail.city || detail.centerName ? ` · ${detail.centerName ?? detail.city}` : ""}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" /> বর্তমান সময়:{" "}
            {detail.startAt ? formatSvpDateTime(detail.startAt) : "—"}
            {rescheduleTimes !== null ? ` · ${rescheduleTimes} বার বাকি` : ""}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="mr-1 h-4 w-4" /> বাতিল
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="শহর">
          <NativeSelect
            value={selectedCity}
            onChange={(event) => selectCity(event.target.value)}
            disabled={isTargeted ? datesQuery.isFetching : citiesQuery.isFetching}
            required
          >
            <option value="">শহর বাছুন</option>
            {cityOptions.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="পরীক্ষার ভাষা">
          <NativeSelect
            value={activeLanguage}
            aria-busy={languagesLoading}
            disabled={
              languagesLoading || Boolean(takamolLanguageCode) || languageChoices.length < 2
            }
            required
            onChange={(event) => {
              setLanguageCode(event.target.value);
              resetSelection();
            }}
          >
            {!activeLanguage && (
              <option value="">{languagesLoading ? "ভাষা আসছে…" : "ভাষা বাছুন"}</option>
            )}
            {languageChoices.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {svpLanguageLabel(entry.label)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {!isTargeted && citiesQuery.isFetching && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircle className="h-4 w-4 animate-spin" /> শহর আসছে…
        </p>
      )}
      {!isTargeted && !citiesQuery.isFetching && (cityListFailed || cityListEmpty) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void citiesQuery.refetch()}
        >
          শহর আবার দেখুন
        </Button>
      )}
      {isTargeted && effectiveCategoryId == null && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void detailQuery.refetch();
            if (detail?.occupationId) void occupationQuery.refetch();
          }}
        >
          আবার দেখুন
        </Button>
      )}

      {(datesFailed ||
        (!datesLoading && shownDateOptions.length === 0 && effectiveCategoryId != null)) && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={datesLoading}
          onClick={() =>
            datesNeedSignIn && onReconnect ? onReconnect() : void dateQuery.refetch()
          }
        >
          {datesNeedSignIn && onReconnect ? "সংযোগ করুন" : "তারিখ আবার দেখুন"}
        </Button>
      )}
      {(isTargeted || Boolean(selectedCity.trim())) && (
        <SvpDateCalendar
          options={shownDateOptions}
          value={activeDateValue}
          loading={datesLoading}
          disabled={
            languagesLoading ||
            datesLoading ||
            (isTargeted
              ? effectiveCategoryId == null || (cityOptions.length > 0 && !selectedCity)
              : !selectedCity.trim())
          }
          onSelect={(date) =>
            selectDateOption(
              shownDateOptions.find((entry) => entry.date === date) ?? { date, city: selectedCity },
            )
          }
          {...(!isTargeted
            ? {
                month: selectedMonth,
                monthOptions,
                onMonthChange: (month: string) => {
                  setSelectedMonth(month);
                  resetSelection();
                },
              }
            : {})}
        />
      )}

      {activeDateValue && (
        <div className="space-y-2">
          <p className="text-sm font-medium">পরীক্ষাকেন্দ্র</p>
          {sessionsLoading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <LoaderCircle className="h-4 w-4 animate-spin" /> সময় ও আসন আসছে…
            </p>
          )}
          {sessionsFailed && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sessionsLoading}
              onClick={() =>
                sessionsNeedSignIn && onReconnect ? onReconnect() : void availabilityQuery.refetch()
              }
            >
              {sessionsNeedSignIn && onReconnect ? "সংযোগ করুন" : "আবার দেখুন"}
            </Button>
          )}
          {!isTargeted &&
            !takamolSessionsQuery.isFetching &&
            (takamolSessionsQuery.isError ||
              (takamolSessionsQuery.data && !takamolSessionsQuery.data.success)) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void takamolSessionsQuery.refetch()}
              >
                কেন্দ্র আবার দেখুন
              </Button>
            )}
          {!sessionsLoading && sessionsLoaded && sessionViews.length === 0 && (
            <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              এখন কোনো আসন নেই।
            </p>
          )}
          <SvpSessionOptions views={sessionViews} disabled={sessionsLoading || sessionsFailed} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          onClick={() => rescheduleMutation.mutate()}
          disabled={
            !canConfirmReschedule || rescheduleMutation.isPending || rescheduleMutation.isError
          }
        >
          {rescheduleMutation.isPending ? (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-2 h-4 w-4" />
          )}
          তারিখ বদল নিশ্চিত করুন
        </Button>
        {rescheduleMutation.isError && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              rescheduleMutation.reset();
              void detailQuery.refetch();
              void availabilityQuery.refetch();
            }}
          >
            বুকিং দেখুন
          </Button>
        )}
      </div>
    </section>
  );
}
