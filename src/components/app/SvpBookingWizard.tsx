import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  Award,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  UserRound,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/app/ui-bits";
import { SvpLoginPanel } from "@/components/app/SvpLoginPanel";
import { SvpReschedulePanel } from "@/components/app/SvpReschedulePanel";
import { SvpCardPayment, SvpPaymentPage } from "@/components/app/SvpCardPayment";
import { SvpDateCalendar } from "@/components/app/SvpDateCalendar";
import { SvpResultPanel } from "@/components/app/SvpResultPanel";
import { SvpSessionOptions, type SvpSessionOption } from "@/components/app/SvpSessionOptions";
import { formatSvpDateTime } from "@/lib/svp-time";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelSvpReservation,
  checkSvpBookingEligibility,
  createSvpBooking,
  createSvpPrometricHold,
  createSvpTargetedHold,
  downloadSvpCertificate,
  downloadSvpTicket,
  getSvpAccountOverview,
  getSvpBookingSetup,
  getSvpDiagnostics,
  getSvpOccupationById,
  getSvpExamSessionById,
  getSvpReservationDetail,
  listSvpAvailableDates,
  listSvpBookingOccupations,
  listSvpExamSessions,
  listSvpNotifications,
  listSvpPayments,
  listSvpPrometricSites,
  listSvpPrometricSlots,
  listSvpReservations,
  listSvpTestCenterCities,
  searchSvpOccupations,
  type SvpBookingResult,
  type SvpDiagnostics,
} from "@/lib/svp-booking.functions";
import { lookupTakamolAvailability } from "@/lib/takamol-availability.functions";
import { parseOccupationLanguages } from "@/lib/takamol-availability.ui";
import {
  getSvpSessionStatus,
  listSvpAccounts,
  reconnectSvpAccount,
  removeSvpAccount,
  signOutSvpSession,
  switchSvpAccount,
} from "@/lib/svp-session.functions";
import { svpCertificateFileName, svpTicketFileName } from "@/lib/svp-api.shared";
import { buildSvpResultPdf, svpCbtResultFileName } from "@/lib/svp-result-pdf";
import { settingsQ } from "@/lib/data";
import type {
  SvpAvailableDate,
  SvpEligibility,
  SvpExamSession,
  SvpOccupation,
  SvpPrometricSlot,
  SvpReservation,
  SvpReservationDetail,
} from "@/lib/svp-api.shared";
import {
  normalizeSvpBookingForm,
  SVP_BOOKING_COST_BDT,
  svpCandidateIdentitySchema,
  toSvpBookingInsert,
} from "@/lib/svp-booking.shared";
import { saveSvpLocalBookingRecord, type SvpLocalRecordPayload } from "@/lib/svp-local-record";

const SVP_PORTAL_BOOKING_URL = "https://svp-international.qiwa.sa/";
const SESSION_QUERY_KEY = ["svp-session-status"] as const;

function splitDateTime(value: string): { date: string; time: string } {
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(value);
  if (match) return { date: match[1] ?? "", time: match[2] ?? "" };
  return { date: value.slice(0, 10), time: "" };
}

function formatSlot(value: string): string {
  const { date, time } = splitDateTime(value);
  if (!date) return value;
  const parsed = new Date(`${date}T${time || "00:00"}:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return `${parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })}${time ? ` · ${time}` : ""}`;
}

function statusTone(status: string | null): string {
  if (!status) return "bg-muted text-muted-foreground";
  if (["reserved", "completed"].includes(status.toLowerCase())) {
    return "bg-success-soft text-success";
  }
  if (["canceled", "cancelled", "payment_failed"].includes(status.toLowerCase())) {
    return "bg-danger-soft text-danger";
  }
  return "bg-warning-soft text-warning";
}

type Stage = "select" | "dates" | "confirm" | "done";

function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function formatHoldExpiry(value: string): string {
  // SVP returns dd/mm/yyyy HH:MM for hold expiry.
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/.exec(value.trim());
  if (dmy) {
    const [, day, month, year, hours = "", minutes = ""] = dmy;
    return `${day}/${month}/${year}${hours ? ` · ${hours}:${minutes}` : ""}`;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function formatDateOnly(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function savePdfBase64(base64: string, contentType: string, fileName: string): void {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const blob = new Blob([bytes], { type: contentType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function BookingStepper({ stage }: { stage: Stage }) {
  const steps = [
    { key: "select", title: "Occupation & center", icon: BriefcaseBusiness },
    { key: "dates", title: "Date & session", icon: CalendarDays },
    { key: "confirm", title: "Confirm", icon: ShieldCheck },
  ] as const;
  const activeIndex = stage === "select" ? 0 : stage === "dates" ? 1 : stage === "confirm" ? 2 : 3;

  return (
    <ol className="flex flex-wrap items-center gap-2 rounded-2xl border bg-card/80 p-2 backdrop-blur sm:flex-nowrap">
      {steps.map((step, index) => {
        const complete = activeIndex > index;
        const active = activeIndex === index;
        return (
          <li key={step.key} className="flex min-w-0 flex-1 items-center gap-2.5 px-1.5 py-1">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                complete || active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {complete ? <CheckCircle2 className="h-4 w-4" /> : <step.icon className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                0{index + 1}
              </span>
              <span
                className={`block truncate text-xs font-semibold ${
                  active ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {step.title}
              </span>
            </span>
            {index < steps.length - 1 && (
              <ChevronRight className="ml-auto hidden h-4 w-4 text-muted-foreground/40 sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function SvpBookingWizard() {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: () => getSvpSessionStatus(),
    retry: false,
  });
  const status = sessionQuery.data;
  const accountsQuery = useQuery({
    queryKey: ["svp-accounts"],
    queryFn: () => listSvpAccounts(),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const accounts = accountsQuery.data?.accounts ?? [];
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [reconnectLogin, setReconnectLogin] = useState<string | null>(null);
  const [forceTargeted, setForceTargeted] = useState(false);
  const [occupationLookup, setOccupationLookup] = useState(false);
  const [manualCategoryId, setManualCategoryId] = useState<number | null>(null);
  const [diagnostics, setDiagnostics] = useState<SvpDiagnostics | null>(null);
  const selectionTokenRef = useRef(0);
  const occupationBoxRef = useRef<HTMLDivElement | null>(null);
  const signedIn = Boolean(status?.signedIn);

  const walletBalanceQuery = useQuery({
    queryKey: ["wallet-balance"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("wallet_my_balance");
      if (error) throw error;
      return Number(data ?? 0);
    },
    enabled: signedIn,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const walletBalance = walletBalanceQuery.data ?? 0;
  const canAffordBooking = walletBalanceQuery.isPending || walletBalance >= SVP_BOOKING_COST_BDT;
  const settingsQuery = useQuery(settingsQ);
  const cbtResultFee = Math.max(0, Number(settingsQuery.data?.["cbt_result_fee"] ?? "50") || 0);

  // The card widget redirects back here with ?paymentId=…; verify it once.
  // A dedicated payment tab uses ?payReservation=… and stays on the payment page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const paymentId = params.get("paymentId");
    if (paymentId) setReturnPaymentId(paymentId);
    const payReservation = params.get("payReservation");
    if (payReservation) setPayReservationId(payReservation);
  }, []);

  const [stage, setStage] = useState<Stage>("select");
  const [occupationId, setOccupationId] = useState<number | null>(null);
  const [languageCode, setLanguageCode] = useState("");
  const [city, setCity] = useState("");
  const [cityCountryId, setCityCountryId] = useState<number | null>(null);
  const [occupationSearch, setOccupationSearch] = useState("");
  const [occupationOpen, setOccupationOpen] = useState(false);
  const [selectedOccupation, setSelectedOccupation] = useState<SvpOccupation | null>(null);
  const [eligibility, setEligibility] = useState<SvpEligibility[] | null>(null);
  const [checked, setChecked] = useState(false);
  const [selectedDate, setSelectedDate] = useState<SvpAvailableDate | null>(null);
  const [selectedSession, setSelectedSession] = useState<SvpExamSession | null>(null);
  const [prometricDate, setPrometricDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SvpPrometricSlot | null>(null);
  const [holdId, setHoldId] = useState<string | null>(null);
  const [prometricHoldExpiresAt, setPrometricHoldExpiresAt] = useState<string | null>(null);
  const [targetedHoldExpiresAt, setTargetedHoldExpiresAt] = useState<string | null>(null);
  const [candidateName, setCandidateName] = useState("");
  const [passport, setPassport] = useState("");
  const [agency, setAgency] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [result, setResult] = useState<SvpBookingResult | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [resultDetails, setResultDetails] = useState<Record<string, SvpReservationDetail>>({});
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [returnPaymentId, setReturnPaymentId] = useState<string | null>(null);
  const [payReservationId, setPayReservationId] = useState<string | null>(null);
  const paymentWindowRef = useRef<Window | null>(null);
  const [localSaveStatus, setLocalSaveStatus] = useState<"idle" | "saving" | "saved" | "failed">(
    "idle",
  );
  const localRecordRef = useRef<SvpLocalRecordPayload | null>(null);
  const localSaveBusyRef = useRef(false);
  const bookingSubmittedRef = useRef(false);
  const identityAccountRef = useRef<string | null>(null);
  const identityHealRef = useRef(false);
  const candidateValidation = svpCandidateIdentitySchema.safeParse({
    candidate_name: candidateName,
    passport,
  });

  useEffect(() => {
    const login = signedIn ? (status?.login ?? null) : null;
    if (identityAccountRef.current !== login) {
      identityAccountRef.current = login;
      setCandidateName(status?.userName ?? "");
      setPassport(status?.userPassport ?? "");
      setAgency("");
      setAccepted(false);
      return;
    }
    // Only fill empty fields on a same-account refresh; never overwrite a correction.
    setCandidateName((current) => current || status?.userName || "");
    setPassport((current) => current || status?.userPassport || "");
  }, [signedIn, status?.login, status?.userName, status?.userPassport]);

  // A stored session can predate passport capture: ask the server to heal it once at confirm.
  useEffect(() => {
    if (stage !== "confirm") {
      identityHealRef.current = false;
      return;
    }
    if (!signedIn || passport || identityHealRef.current) return;
    identityHealRef.current = true;
    void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [passport, queryClient, signedIn, stage]);

  const invalidateSvpData = useCallback(() => {
    setForceTargeted(false);
    queryClient.removeQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return (
          typeof key === "string" &&
          key.startsWith("svp-") &&
          key !== "svp-accounts" &&
          key !== "svp-session-status"
        );
      },
    });
    void queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ["svp-accounts"] });
  }, [queryClient]);

  const requireSignIn = () => {
    invalidateSvpData();
  };

  const occupationsQuery = useQuery({
    queryKey: ["svp-occupations"],
    queryFn: () => listSvpBookingOccupations(),
    enabled: signedIn,
    retry: false,
    refetchOnWindowFocus: false,
  });
  // Takamol's catalogue carries the per-occupation language code used for the exam booking.
  const takamolOccupationsQuery = useQuery({
    queryKey: ["takamol-occupations"],
    queryFn: () => lookupTakamolAvailability({ data: { endpoint: "occupations" } }),
    enabled: signedIn,
    retry: false,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const takamolLanguages = useMemo(() => {
    const byId = new Map<number, string>();
    const byKey = new Map<string, string>();
    const payload = takamolOccupationsQuery.data;
    if (!payload?.success) return { byId, byKey };
    for (const entry of parseOccupationLanguages(payload.data)) {
      const id = Number(entry.occupationId);
      if (Number.isInteger(id) && id > 0) byId.set(id, entry.languageCode);
      if (entry.occupationKey) byKey.set(entry.occupationKey, entry.languageCode);
    }
    return { byId, byKey };
  }, [takamolOccupationsQuery.data]);
  const occupations = useMemo(
    () => (occupationsQuery.data?.ok ? occupationsQuery.data.data : []),
    [occupationsQuery.data],
  );
  const occupation = useMemo(() => {
    const fromList = occupations.find((entry) => entry.id === occupationId) ?? null;
    if (!selectedOccupation) return fromList;
    if (selectedOccupation.languages.length > 0) return selectedOccupation;
    if (fromList && fromList.languages.length > selectedOccupation.languages.length) {
      return fromList;
    }
    return selectedOccupation;
  }, [occupationId, occupations, selectedOccupation]);
  const filteredOccupations = useMemo(() => {
    const needle = occupationSearch.trim().toLowerCase();
    const filtered = needle
      ? occupations.filter((entry) =>
          [entry.name, entry.arabicName, entry.occupationKey, entry.categoryName].some((value) =>
            value?.toLowerCase().includes(needle),
          ),
        )
      : occupations;
    return filtered.slice(0, 250);
  }, [occupationSearch, occupations]);

  const debouncedOccupationSearch = useDebouncedValue(occupationSearch.trim(), 300);
  const occupationSearchQuery = useQuery({
    queryKey: ["svp-occupation-search", debouncedOccupationSearch],
    queryFn: () => searchSvpOccupations({ data: { query: debouncedOccupationSearch } }),
    enabled: signedIn && debouncedOccupationSearch.length >= 1,
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const searchResults = useMemo(
    () => (occupationSearchQuery.data?.ok ? occupationSearchQuery.data.data : []),
    [occupationSearchQuery.data],
  );
  const suggestions = useMemo(() => {
    const needle = occupationSearch.trim().toLowerCase();
    if (!needle) return filteredOccupations.slice(0, 12);
    // Some SVP responses ignore the search term and return the entire catalogue.
    // Keep matching local entries visible, then add matching remote-only entries.
    const matchingSearchResults = searchResults.filter((entry) =>
      [entry.name, entry.arabicName, entry.occupationKey, entry.categoryName].some((value) =>
        value?.toLowerCase().includes(needle),
      ),
    );
    const merged = new Map<number, SvpOccupation>();
    for (const entry of [...filteredOccupations, ...matchingSearchResults]) {
      if (!merged.has(entry.id)) merged.set(entry.id, entry);
    }
    return [...merged.values()].slice(0, 40);
  }, [occupationSearch, filteredOccupations, searchResults]);
  const occupationSearchPending =
    occupationSearch.trim() !== debouncedOccupationSearch || occupationSearchQuery.isFetching;

  const setupQuery = useQuery({
    queryKey: ["svp-setup", occupationId],
    queryFn: () => getSvpBookingSetup({ data: { occupationId } }),
    enabled: signedIn && occupationId !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const setup = setupQuery.data?.ok ? setupQuery.data.data : null;

  const overviewQuery = useQuery({
    queryKey: ["svp-account-overview", occupationId],
    queryFn: () => getSvpAccountOverview({ data: { occupationId } }),
    enabled: signedIn,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const overview = overviewQuery.data?.ok ? overviewQuery.data.data : null;
  // Session country flags come straight from the OTP user and are the most reliable source.
  const isTargeted =
    (forceTargeted || status?.countryTargeted) ??
    overview?.permissions.targeted ??
    setup?.permissions.targeted ??
    true;
  const isLoadBalancer =
    status?.countryLoadBalancer ??
    overview?.permissions.loadBalancer ??
    setup?.permissions.loadBalancer ??
    false;
  const categoryOptions = useMemo(() => overview?.categories ?? [], [overview]);
  const matchedCategory = useMemo(() => {
    if (!occupation) return null;
    const categoryId = occupation.categoryId ?? manualCategoryId;
    const byId = categoryId ? categoryOptions.find((entry) => entry.id === categoryId) : null;
    if (byId) return byId;
    const needle = (occupation.categoryName ?? occupation.name).trim().toLowerCase();
    if (!needle) return null;
    return (
      categoryOptions.find((entry) => {
        const name = entry.name.toLowerCase();
        return (
          name === needle ||
          entry.arabicName?.toLowerCase() === needle ||
          name.includes(needle) ||
          needle.includes(name)
        );
      }) ?? null
    );
  }, [categoryOptions, manualCategoryId, occupation]);
  const languageOptions = useMemo(() => {
    const all = occupation?.languages ?? [];
    // Fall back to the selected SVP category's prometric codes (the occupation record can omit them).
    const category =
      categoryOptions.find(
        (entry) =>
          entry.id === (occupation?.categoryId ?? manualCategoryId ?? matchedCategory?.id ?? -1),
      ) ?? matchedCategory;
    const categoryLanguages = category?.languages ?? [];
    const filtered = all.filter((entry) => entry.nonTargeted === !isTargeted);
    const categoryFiltered = categoryLanguages.filter((entry) => entry.nonTargeted === !isTargeted);
    const source =
      filtered.length > 0
        ? filtered
        : categoryFiltered.length > 0
          ? categoryFiltered
          : all.length > 0
            ? all
            : categoryLanguages;
    const byLabel = new Map<string, (typeof all)[number]>();
    for (const entry of source) {
      const key = entry.label.toLowerCase();
      const existing = byLabel.get(key);
      if (!existing || (entry.questionCount ?? 0) > (existing.questionCount ?? 0)) {
        byLabel.set(key, entry);
      }
    }
    const options = [...byLabel.values()];
    return options;
  }, [categoryOptions, isTargeted, manualCategoryId, matchedCategory, occupation]);
  // Takamol returns one language code per occupation: only that language is shown and applied.
  const takamolLanguageCode = occupationId
    ? (takamolLanguages.byId.get(occupationId) ??
      (occupation?.occupationKey
        ? (takamolLanguages.byKey.get(occupation.occupationKey) ?? null)
        : null))
    : null;
  const languageChoices = useMemo(
    () =>
      takamolLanguageCode
        ? [
            {
              code: takamolLanguageCode,
              label: takamolLanguageCode,
              questionCount: null,
              nonTargeted: false,
            },
          ]
        : languageOptions,
    [languageOptions, takamolLanguageCode],
  );
  useEffect(() => {
    if (takamolLanguageCode) {
      setLanguageCode((current) =>
        current === takamolLanguageCode ? current : takamolLanguageCode,
      );
      return;
    }
    const only = languageOptions.length === 1 ? languageOptions[0]?.code : null;
    if (only) setLanguageCode((current) => (current === only ? current : only));
  }, [languageOptions, takamolLanguageCode]);
  const activeLanguageCode =
    languageCode &&
    (languageChoices.length === 0 || languageChoices.some((entry) => entry.code === languageCode))
      ? languageCode
      : "";

  const citiesQuery = useQuery({
    queryKey: ["svp-cities", setup?.permissions.countryId ?? null],
    queryFn: () =>
      listSvpTestCenterCities({ data: { countryId: setup?.permissions.countryId ?? null } }),
    enabled: signedIn && overview !== null && !isTargeted && occupationId !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const cities = useMemo(
    () => (citiesQuery.data?.ok ? citiesQuery.data.data : []),
    [citiesQuery.data],
  );

  // Any SVP call can invalidate the stored session (refresh cookie expired/revoked).
  useEffect(() => {
    const results = [occupationsQuery.data, citiesQuery.data, setupQuery.data, overviewQuery.data];
    if (results.some((result) => result && !result.ok && result.needsSignIn)) {
      invalidateSvpData();
    }
  }, [
    citiesQuery.data,
    invalidateSvpData,
    occupationsQuery.data,
    overviewQuery.data,
    setupQuery.data,
  ]);

  useEffect(() => {
    if (!occupationOpen) return;
    const handleOutside = (event: MouseEvent) => {
      if (!occupationBoxRef.current?.contains(event.target as Node)) setOccupationOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [occupationOpen]);

  const effectiveCategoryId =
    occupation?.categoryId ?? manualCategoryId ?? matchedCategory?.id ?? null;
  const categoryId = effectiveCategoryId;
  const datesQuery = useQuery({
    queryKey: ["svp-dates", categoryId, cityCountryId ?? setup?.permissions.countryId ?? null],
    queryFn: () =>
      listSvpAvailableDates({
        data: {
          categoryId: categoryId as number,
          countryId: cityCountryId ?? setup?.permissions.countryId ?? null,
        },
      }),
    enabled: signedIn && categoryId !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const availableDates = useMemo(
    () => (datesQuery.data?.ok ? datesQuery.data.data : []),
    [datesQuery.data],
  );
  const cityOptions = useMemo(() => {
    // Targeted cities come from availability, never the site-only city endpoint.
    // Use those same SVP city labels as a discovery fallback if the site catalogue is empty.
    const source =
      !isTargeted && cities.length > 0
        ? cities
        : availableDates.map((entry) => ({ city: entry.city ?? "", countryId: null }));
    const unique = new Map<string, { city: string; countryId: number | null }>();
    for (const entry of source) {
      const label = entry.city.trim();
      if (label && !unique.has(label.toLowerCase())) {
        unique.set(label.toLowerCase(), { city: label, countryId: entry.countryId });
      }
    }
    return [...unique.values()].sort((a, b) => a.city.localeCompare(b.city));
  }, [availableDates, cities, isTargeted]);
  const chooseCity = useCallback(
    (value: string) => {
      setCity(value);
      setCityCountryId(cityOptions.find((entry) => entry.city === value)?.countryId ?? null);
      setSelectedDate(null);
      setPrometricDate(null);
      setSelectedSession(null);
      setSelectedSlot(null);
      setHoldId(null);
      setPrometricHoldExpiresAt(null);
      setTargetedHoldExpiresAt(null);
    },
    [cityOptions],
  );
  const citiesLoading = isTargeted
    ? datesQuery.isFetching
    : citiesQuery.isFetching || (cities.length === 0 && datesQuery.isFetching);
  useEffect(() => {
    if (!signedIn || citiesLoading || cityOptions.length === 0) return;
    if (stage !== "select" && stage !== "dates") return;
    if (city && cityOptions.some((entry) => entry.city === city)) return;
    const nextCity = cityOptions.length === 1 ? cityOptions[0].city : "";
    if (nextCity !== city) chooseCity(nextCity);
  }, [chooseCity, citiesLoading, city, cityOptions, signedIn, stage]);
  const citiesLoaded = isTargeted
    ? Boolean(datesQuery.data?.ok)
    : Boolean(citiesQuery.data?.ok || datesQuery.data?.ok);
  const cityError = isTargeted
    ? datesQuery.isError || (datesQuery.data && !datesQuery.data.ok)
      ? "SVP city availability could not be loaded."
      : null
    : citiesQuery.isError || (citiesQuery.data && !citiesQuery.data.ok)
      ? "The SVP city catalogue is unavailable."
      : null;
  const manualCityFallback =
    !citiesLoading && cityOptions.length === 0 && Boolean(citiesLoaded || cityError);
  const dateOptions = useMemo(() => {
    const map = new Map<string, { date: string; city: string | null; seats: number | null }>();
    for (const entry of availableDates) {
      // A chosen city narrows the list; with no city the calendar shows every available date.
      if (
        city.trim() &&
        entry.city &&
        entry.city.trim().toLowerCase() !== city.trim().toLowerCase()
      ) {
        continue;
      }
      const { date } = splitDateTime(entry.startAt);
      if (!date || map.has(date)) continue;
      map.set(date, { date, city: entry.city, seats: entry.seats });
    }
    return [...map.values()];
  }, [availableDates, city]);

  const sessionCity = selectedDate?.city ?? city;
  const sessionDate = selectedDate ? splitDateTime(selectedDate.startAt).date : "";
  const sessionsQuery = useQuery({
    queryKey: ["svp-sessions", categoryId, sessionCity, sessionDate],
    queryFn: () =>
      listSvpExamSessions({
        data: { categoryId: categoryId as number, city: sessionCity, examDate: sessionDate },
      }),
    enabled:
      signedIn && checked && categoryId !== null && Boolean(sessionCity) && Boolean(sessionDate),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const examSessions = sessionsQuery.data?.ok ? sessionsQuery.data.data : [];

  const prometricCode = activeLanguageCode;
  const sitesQuery = useQuery({
    queryKey: ["svp-sites", prometricCode, city, cityCountryId],
    queryFn: () =>
      listSvpPrometricSites({
        data: {
          prometricCode,
          city,
          countryId: cityCountryId ?? setup?.permissions.countryId ?? null,
        },
      }),
    enabled: signedIn && checked && !isTargeted && Boolean(city) && Boolean(prometricCode),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const prometricSites = useMemo(
    () => (sitesQuery.data?.ok ? sitesQuery.data.data.sites : []),
    [sitesQuery.data],
  );
  const prometricExamId = sitesQuery.data?.ok ? sitesQuery.data.data.examId : null;
  const siteDateOptions = useMemo(() => {
    const map = new Map<string, { date: string; city: string | null; seats: number | null }>();
    for (const site of prometricSites) {
      for (const date of site.dates) {
        if (date && !map.has(date)) map.set(date, { date, city: site.city, seats: null });
      }
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [prometricSites]);
  const siteIdsForDate = prometricSites
    .filter((site) => prometricDate && site.dates.includes(prometricDate))
    .map((site) => site.siteId);
  const slotsQuery = useQuery({
    queryKey: ["svp-slots", prometricExamId, prometricDate, siteIdsForDate.join(",")],
    queryFn: () =>
      listSvpPrometricSlots({
        data: {
          examId: prometricExamId as string,
          siteIds: siteIdsForDate,
          date: prometricDate as string,
        },
      }),
    enabled:
      signedIn &&
      checked &&
      !isTargeted &&
      Boolean(prometricExamId) &&
      Boolean(prometricDate) &&
      siteIdsForDate.length > 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const prometricSlots = useMemo(
    () => (slotsQuery.data?.ok ? slotsQuery.data.data : []),
    [slotsQuery.data],
  );

  const activeLanguageLabel =
    languageChoices.find((entry) => entry.code === activeLanguageCode)?.label ?? activeLanguageCode;

  // If the site-based attempt fails after eligibility but targeted dates exist, use them.
  useEffect(() => {
    if (isTargeted || !checked) return;
    const sitesFailed = sitesQuery.data && !sitesQuery.data.ok;
    const sitesEmpty = sitesQuery.data?.ok && prometricSites.length === 0;
    if ((sitesFailed || sitesEmpty) && availableDates.length > 0) setForceTargeted(true);
  }, [availableDates.length, checked, isTargeted, prometricSites.length, sitesQuery.data]);

  const reservationsQuery = useQuery({
    queryKey: ["svp-reservations"],
    queryFn: () => listSvpReservations(),
    enabled: signedIn,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const reservations: SvpReservation[] = reservationsQuery.data?.ok
    ? reservationsQuery.data.data
    : [];
  const cancelledReservations = reservations.filter((entry) =>
    /cancel/i.test(entry.status ?? ""),
  ).length;

  // Card payments and SVP notifications back the "account activity" panel.
  const paymentsQuery = useQuery({
    queryKey: ["svp-payments"],
    queryFn: () => listSvpPayments(),
    enabled: signedIn,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const payments = paymentsQuery.data?.ok ? paymentsQuery.data.data : [];
  const notificationsQuery = useQuery({
    queryKey: ["svp-notifications"],
    queryFn: () => listSvpNotifications(),
    enabled: signedIn,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const notifications = notificationsQuery.data?.ok ? notificationsQuery.data.data : [];

  const cancelMutation = useMutation({
    mutationFn: (reservationId: string) => cancelSvpReservation({ data: { reservationId } }),
    onSuccess: (response) => {
      if (!response.ok) {
        if (response.needsSignIn) requireSignIn();
        toast.error(response.message);
        return;
      }
      toast.success(response.data.message);
      void queryClient.invalidateQueries({ queryKey: ["svp-reservations"] });
      void queryClient.invalidateQueries({ queryKey: ["svp-account-overview"] });
    },
    onError: () => toast.error("SVP could not cancel this reservation."),
  });

  // The result + certificate live on the reservation detail endpoint.
  const reservationIdsKey = reservations.map((entry) => entry.id).join(",");
  useEffect(() => {
    const targets = reservations.filter((entry) =>
      /completed|reserved|confirmed/i.test(entry.status ?? ""),
    );
    if (targets.length === 0) return;
    let cancelled = false;
    const load = async () => {
      for (const entry of targets.slice(0, 10)) {
        if (cancelled) return;
        if (resultDetails[entry.id]) continue;
        const response = await getSvpReservationDetail({ data: { reservationId: entry.id } });
        if (cancelled) return;
        if (response.ok) {
          setResultDetails((current) => ({ ...current, [entry.id]: response.data }));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
    // Reservation ids are the stable trigger; details are fetched once per row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reservationIdsKey]);

  const selectOccupation = async (entry: SvpOccupation) => {
    const token = ++selectionTokenRef.current;

    // Prefer the full loaded labour record (it carries prometric language codes).
    const known = occupations.find((candidate) => candidate.id === entry.id) ?? null;
    const base =
      known && (known.languages.length > entry.languages.length || !entry.categoryId)
        ? known
        : entry;

    // Apply the selection immediately so the UI never stays on the old value.
    setManualCategoryId(null);
    setSelectedOccupation(base);
    setOccupationId(base.id);
    setLanguageCode("");
    setOccupationSearch(base.name);
    setOccupationOpen(false);
    setChecked(false);
    setEligibility(null);
    setSelectedDate(null);
    setSelectedSession(null);
    setPrometricDate(null);
    setSelectedSlot(null);
    setHoldId(null);
    setPrometricHoldExpiresAt(null);
    setTargetedHoldExpiresAt(null);
    setCity("");
    setCityCountryId(null);
    setStage("select");

    if (base.categoryId && base.languages.length > 0) return;
    setOccupationLookup(true);
    try {
      const detail = await getSvpOccupationById({
        data: { occupationId: base.id, name: base.name },
      });
      if (detail.ok && selectionTokenRef.current === token) {
        setSelectedOccupation(detail.data);
      }
    } catch {
      // Keep the selected entry; the category auto-match/manual selector handles it.
    } finally {
      if (selectionTokenRef.current === token) setOccupationLookup(false);
    }
  };

  const chooseSlot = useCallback(
    (slot: SvpPrometricSlot) => {
      const site = prometricSites.find((entry) => entry.siteId === slot.siteId) ?? null;
      setSelectedSlot(slot);
      setSelectedSession({
        id: slot.id,
        startAt: slot.startAt,
        endAt: null,
        duration: slot.duration,
        availableSeats: slot.availableSeats ?? null,
        city: site?.city ?? city,
        centerName: site?.name ?? null,
        siteId: slot.siteId,
      });
      setHoldId(null);
      setTargetedHoldExpiresAt(null);
      setPrometricHoldExpiresAt(null);
    },
    [city, prometricSites],
  );

  const holdMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSlot?.siteId) throw new Error("Select a slot first.");
      const response = await createSvpPrometricHold({
        data: { slotId: selectedSlot.id, siteId: selectedSlot.siteId },
      });
      if (!response.ok) {
        if (response.needsSignIn) requireSignIn();
        throw new Error(response.message);
      }
      return response.data;
    },
    onSuccess: (data) => {
      setHoldId(data.holdId);
      setPrometricHoldExpiresAt(data.expiresAt);
      setStage("confirm");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "SVP could not hold the slot."),
  });

  const targetedHoldMutation = useMutation({
    mutationFn: async (
      override?: SvpExamSession,
    ): Promise<{
      expiresAt: string | null;
      session: SvpExamSession | null;
    }> => {
      if (!effectiveCategoryId) throw new Error("Choose the SVP category first.");
      const chosen = override ?? selectedSession;
      const ids = isLoadBalancer
        ? // Hold every token SVP returned for the date (the portal holds the whole day).
          examSessions.map((entry) => entry.id)
        : chosen
          ? [chosen.id]
          : [];
      if (ids.length === 0) throw new Error("Select an exam session first.");

      const response = await createSvpTargetedHold({
        data: {
          examSessionId: isLoadBalancer ? ids : (ids[0] as string | number),
          categoryId: effectiveCategoryId,
          countryId: cityCountryId ?? setup?.permissions.countryId ?? null,
        },
      });
      if (!response.ok) {
        if (response.needsSignIn) requireSignIn();
        throw new Error(response.message);
      }

      // SVP assigns a specific session token on the hold; the reservation must use it.
      const heldId = response.data.examSessionId;
      let assigned = chosen ?? visibleExamSessions[0] ?? null;
      if (heldId !== null && heldId !== undefined) {
        const detail = await getSvpExamSessionById({ data: { examSessionId: String(heldId) } });
        assigned = detail.ok
          ? { ...detail.data, id: heldId }
          : assigned
            ? { ...assigned, id: heldId }
            : {
                id: heldId,
                startAt: "",
                endAt: null,
                duration: 0,
                availableSeats: null,
                city: null,
                centerName: null,
                siteId: null,
              };
      }
      return { expiresAt: response.data.expiresAt, session: assigned };
    },
    onSuccess: (data) => {
      if (data.session) setSelectedSession(data.session);
      setTargetedHoldExpiresAt(data.expiresAt);
      setStage("confirm");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "SVP could not hold this seat."),
  });

  const continueFromDates = () => {
    if (isTargeted) {
      // Load-balancer dates may preselect nothing yet; fall back to the first token.
      const session =
        selectedSession ?? visibleExamSessions.find((entry) => entry.availableSeats !== 0) ?? null;
      if (!session || session.availableSeats === 0) return;
      if (session && !selectedSession) setSelectedSession(session);
      targetedHoldMutation.mutate(session ?? undefined);
      return;
    }
    holdMutation.mutate();
  };

  // Double-click guard for the Continue button label state.
  const continueBusy = holdMutation.isPending || targetedHoldMutation.isPending;

  const selectDateOption = (entry: { date: string; city: string | null }) => {
    setSelectedSession(null);
    setSelectedSlot(null);
    setHoldId(null);
    setPrometricHoldExpiresAt(null);
    setTargetedHoldExpiresAt(null);
    if (isTargeted) {
      const nextDate =
        availableDates.find(
          (candidate) =>
            splitDateTime(candidate.startAt).date === entry.date &&
            (!candidate.city || candidate.city.trim().toLowerCase() === city.trim().toLowerCase()),
        ) ?? null;
      setSelectedDate(nextDate);
      return;
    }
    setPrometricDate(entry.date);
  };

  const retryOccupations = () => {
    void occupationsQuery.refetch();
    if (debouncedOccupationSearch) void occupationSearchQuery.refetch();
    void citiesQuery.refetch();
  };

  const refreshAvailability = () => {
    if (!isTargeted) void citiesQuery.refetch();
    if (isTargeted) {
      void datesQuery.refetch();
      if (activeDateValue) void sessionsQuery.refetch();
      return;
    }
    if (city && prometricCode) void sitesQuery.refetch();
    if (cities.length === 0) void datesQuery.refetch();
    if (prometricDate) void slotsQuery.refetch();
  };

  const diagnosticsMutation = useMutation({
    mutationFn: async () => {
      const response = await getSvpDiagnostics();
      if (!response.ok) throw new Error(response.message);
      return response.data;
    },
    onSuccess: (data) => setDiagnostics(data),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Diagnostics could not run."),
  });

  const startNewBooking = () => {
    resetFlow();
    setAddAccountOpen(false);
    setRescheduleId(null);
    setStage("select");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const openReschedule = (id: string) => {
    // Leave any half-finished new-booking flow behind: rescheduling and a new
    // booking must never share stale selections, so cancelling the reschedule
    // returns to a clean Step 1 instead of a mid-booking state.
    resetFlow();
    setRescheduleId(id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resetFlow = () => {
    paymentWindowRef.current?.close();
    paymentWindowRef.current = null;
    setManualCategoryId(null);
    setStage("select");
    setOccupationId(null);
    setSelectedOccupation(null);
    setLanguageCode("");
    setCity("");
    setCityCountryId(null);
    setOccupationSearch("");
    setOccupationOpen(false);
    setEligibility(null);
    setChecked(false);
    setSelectedDate(null);
    setSelectedSession(null);
    setPrometricDate(null);
    setSelectedSlot(null);
    setHoldId(null);
    setPrometricHoldExpiresAt(null);
    setTargetedHoldExpiresAt(null);
    setCandidateName(status?.userName ?? "");
    setPassport(status?.userPassport ?? "");
    setAgency("");
    setAccepted(false);
    setResult(null);
    setLocalSaveStatus("idle");
    localRecordRef.current = null;
    bookingSubmittedRef.current = false;
  };

  const downloadTicketById = async (
    reservationId: string,
    name: string | null,
    occupationEnglishName: string | null,
  ) => {
    if (downloadingId) return;
    setDownloadingId(reservationId);
    try {
      const response = await downloadSvpTicket({ data: { reservationId } });
      if (!response.ok) {
        if (response.needsSignIn) requireSignIn();
        toast.error(response.message);
        return;
      }
      const fileName = svpTicketFileName(name, occupationEnglishName);
      savePdfBase64(response.data.base64, response.data.contentType, fileName);
      toast.success(`Ticket saved as ${fileName}`);
    } catch {
      toast.error("The SVP ticket could not be downloaded.");
    } finally {
      setDownloadingId(null);
    }
  };

  const downloadCertificateById = async (
    certificateId: string,
    name: string | null,
    occupationEnglishName: string | null,
    centerName: string | null,
  ) => {
    if (downloadingId) return;
    setDownloadingId(`cert-${certificateId}`);
    try {
      const response = await downloadSvpCertificate({ data: { certificateId } });
      if (!response.ok) {
        if (response.needsSignIn) requireSignIn();
        toast.error(response.message);
        return;
      }
      const fileName = svpCertificateFileName(name, occupationEnglishName, centerName);
      savePdfBase64(response.data.base64, response.data.contentType, fileName);
      toast.success(`Certificate saved as ${fileName}`);
    } catch {
      toast.error("The SVP certificate could not be downloaded.");
    } finally {
      setDownloadingId(null);
    }
  };

  const downloadCbtResult = async (entry: SvpReservation, fileName: string) => {
    try {
      const { data: chargeData, error: chargeError } = await supabase.rpc(
        "wallet_charge_cbt_result",
        { _reference: entry.id },
      );
      if (chargeError) {
        toast.error(`CBT result PDF ফি চার্জ করা যায়নি: ${chargeError.message}`);
        return;
      }
      const charge = chargeData as {
        ok?: boolean;
        reason?: string;
        fee?: number;
        balance?: number;
      } | null;
      if (charge && charge.ok === false) {
        toast.error(
          charge.reason === "insufficient"
            ? `ব্যালেন্স কম — CBT result PDF ফি ৳${charge.fee ?? cbtResultFee}। /wallet থেকে ডিপোজিট করুন।`
            : "CBT result PDF ফি চার্জ করা যায়নি।",
        );
        return;
      }
      const base64 = buildSvpResultPdf({
        title: "SVP CBT Result",
        subtitle: "Saudi Skill Verification Program · official SVP data",
        candidateName: entry.laborName ?? status?.userName ?? candidateName,
        passport: passport || null,
        occupation: entry.occupationEnglishName ?? entry.occupationName,
        testCenter: entry.centerName,
        city: entry.city,
        examDate: entry.startAt ? formatSlot(entry.startAt) : null,
        result: entry.finalResult ?? entry.examResult,
        scores: [
          { label: "Total", value: entry.totalScore == null ? "-" : String(entry.totalScore) },
          { label: "CBT", value: entry.cbtScore == null ? "-" : String(entry.cbtScore) },
          {
            label: "Practical",
            value: entry.practicalScore == null ? "-" : String(entry.practicalScore),
          },
        ],
        extra: [
          { label: "Reservation", value: entry.id },
          ...(entry.certificate?.certificateNumber
            ? [{ label: "Certificate", value: entry.certificate.certificateNumber }]
            : []),
          ...(entry.certificate?.validUntil
            ? [{ label: "Certificate valid until", value: entry.certificate.validUntil }]
            : []),
        ],
      });
      savePdfBase64(base64, "application/pdf", fileName);
      const fee = Number(charge?.fee ?? 0);
      toast.success(
        `CBT result saved as ${fileName}${fee > 0 ? ` · ৳${fee} wallet থেকে চার্জ হয়েছে` : ""}`,
      );
      void queryClient.invalidateQueries({ queryKey: ["wallet-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet-transactions"] });
    } catch {
      toast.error("The CBT result PDF could not be created.");
    }
  };

  const syncLocalReschedule = async (
    reservationId: string,
    updated: { startAt: string; city: string | null; centerName: string | null },
  ) => {
    const { date, time } = splitDateTime(updated.startAt);
    const { data: updatedRows, error } = await supabase
      .from("svp_bookings")
      .update({
        exam_date: date || null,
        exam_time: time || null,
        center: updated.centerName ?? updated.city ?? null,
      })
      .eq("reference_no", reservationId)
      .select("id");
    if (error) {
      toast.error("SVP rescheduled the appointment, but the local record could not be updated.");
      return;
    }
    // Report honestly: a reservation booked outside this app has no local row to sync.
    if (!updatedRows || updatedRows.length === 0) {
      toast.warning(
        "Appointment rescheduled in SVP. No matching local record was found to update.",
      );
      return;
    }
    void queryClient.invalidateQueries({ queryKey: ["svp-bookings"] });
    toast.success("Local record updated with the new appointment");
  };

  const saveLocalRecord = async (payload: SvpLocalRecordPayload) => {
    if (localSaveBusyRef.current) return;
    localSaveBusyRef.current = true;
    setLocalSaveStatus("saving");
    try {
      await saveSvpLocalBookingRecord(supabase, payload);
      setLocalSaveStatus("saved");
      void queryClient.invalidateQueries({ queryKey: ["svp-bookings"] });
      toast.success("SVP reservation saved automatically to the local records.");
    } catch {
      setLocalSaveStatus("failed");
      toast.error("Booked in SVP, but the local record could not be saved.");
    } finally {
      localSaveBusyRef.current = false;
    }
  };

  // Open the payment tab on the click gesture so popup blockers allow it; it is
  // navigated to the secure widget once SVP confirms that payment is required.
  const openPaymentTab = () => {
    if (typeof window === "undefined") return;
    try {
      const tab = window.open("", "svp-card-payment");
      paymentWindowRef.current = tab;
      if (tab && tab.document) {
        tab.document.write(
          '<!doctype html><html><head><title>SVP card payment</title></head><body style="font-family:system-ui;padding:24px">Preparing the secure SVP card payment…</body></html>',
        );
        tab.document.close();
      }
    } catch {
      paymentWindowRef.current = null;
    }
  };

  const eligibilityMutation = useMutation({
    mutationFn: () =>
      checkSvpBookingEligibility({
        data: { categoryId: categoryId as number, countryId: setup?.permissions.countryId ?? null },
      }),
    onSuccess: (response) => {
      if (!response.ok) {
        if (response.needsSignIn) requireSignIn();
        toast.error(response.message);
        return;
      }
      setEligibility(response.data);
      const failed = response.data.find((entry) => !entry.passed);
      if (failed) {
        toast.error(failed.message);
        return;
      }
      setChecked(true);
      setStage("dates");
    },
    onError: () => toast.error("Eligibility checks could not be completed."),
  });

  const bookingMutation = useMutation({
    mutationFn: async (): Promise<{
      booking: SvpBookingResult;
      localRecord: SvpLocalRecordPayload;
    }> => {
      if (bookingSubmittedRef.current)
        throw new Error("This reservation is already being submitted.");
      if (!occupation || !selectedSession) throw new Error("Select an exam session first.");
      if (!activeLanguageCode)
        throw new Error("SVP has not provided a valid exam language for this occupation.");
      if (!accepted) throw new Error("Confirm the candidate details and SVP rules first.");
      if (occupation.driverLicenseRequired)
        throw new Error("Use the official SVP portal for this occupation.");
      const { date, time } = splitDateTime(selectedSession.startAt);
      // Validate and snapshot the local identity before an irreversible upstream submission.
      const localRecord = toSvpBookingInsert(
        normalizeSvpBookingForm({
          candidate_name: candidateName,
          passport,
          occupation: occupation.name,
          center: selectedSession.centerName ?? selectedSession.city ?? sessionCity,
          exam_date: date,
          exam_time: time,
          agency,
          login_email: status?.login?.includes("@") ? status.login : "",
          reference_no: "",
          notes: "",
          status: date && time ? "booked" : "draft",
        }),
      );
      bookingSubmittedRef.current = true;
      const fallbackLanguageCodes = languageOptions
        .map((entry) => entry.code)
        .filter((code) => code && code !== activeLanguageCode)
        .slice(0, 6);
      const response = await createSvpBooking({
        data: {
          occupationId: occupation.id,
          categoryId: effectiveCategoryId as number,
          examSessionId: isTargeted ? selectedSession.id : (prometricExamId ?? selectedSession.id),
          languageCode: activeLanguageCode,
          methodology: "in_person",
          duration: selectedSession.duration > 0 ? selectedSession.duration : null,
          startAt: /\d{2}:\d{2}/.test(selectedSession.startAt) ? selectedSession.startAt : null,
          siteId: selectedSession.siteId,
          // The portal only sends site_city for non-targeted (site-based) sessions.
          siteCity: selectedSession.siteId ? (selectedSession.city ?? sessionCity) : null,
          holdId: isTargeted ? null : holdId,
          countryId: cityCountryId ?? setup?.permissions.countryId ?? null,
          ...(fallbackLanguageCodes.length > 0 ? { fallbackLanguageCodes } : {}),
        },
      });
      if (!response.ok) {
        if (response.needsSignIn) requireSignIn();
        throw new Error(response.message);
      }
      const booking = response.data;
      return {
        booking,
        localRecord: {
          ...localRecord,
          reference_no: booking.reservationId,
          notes: `SVP ${booking.reservationId}: ${booking.message}`.slice(0, 1000),
          // Pending payment is not a confirmed local booking.
          status: booking.paymentRequired ? "draft" : localRecord.status,
        },
      };
    },
    onSuccess: async ({ booking, localRecord }) => {
      setResult(booking);
      setStage("done");
      localRecordRef.current = localRecord;
      try {
        const { data: charge } = await supabase.rpc("wallet_charge_booking", {
          _reservation_id: booking.reservationId,
          _amount: SVP_BOOKING_COST_BDT,
        });
        const result = charge as { ok?: boolean; reason?: string } | null;
        if (result && result.ok === false) {
          toast.error(
            result.reason === "insufficient"
              ? `Booking created, but the wallet is short for the ৳${SVP_BOOKING_COST_BDT} fee. Please top up.`
              : "Booking created, but the booking fee could not be charged.",
          );
        } else {
          toast.success(`৳${SVP_BOOKING_COST_BDT} booking fee charged from your balance.`);
        }
      } catch {
        toast.error("Booking created, but the wallet fee could not be recorded.");
      }
      void queryClient.invalidateQueries({ queryKey: ["wallet-balance"] });
      void queryClient.invalidateQueries({ queryKey: ["wallet-transactions"] });
      if (booking.paymentRequired) {
        // Complete the SVP card payment in the provider widget tab that was opened on click.
        const paymentUrl = `/svp-booking?payReservation=${encodeURIComponent(booking.reservationId)}`;
        const tab = paymentWindowRef.current;
        if (tab && !tab.closed) {
          tab.location.href = paymentUrl;
        } else if (typeof window !== "undefined") {
          window.open(paymentUrl, "_blank");
        }
      } else {
        paymentWindowRef.current?.close();
        paymentWindowRef.current = null;
      }
      await saveLocalRecord(localRecord);
      void queryClient.invalidateQueries({ queryKey: ["svp-reservations"] });
      void queryClient.invalidateQueries({ queryKey: ["svp-account-overview"] });
    },
    onError: (error) => {
      bookingSubmittedRef.current = false;
      paymentWindowRef.current?.close();
      paymentWindowRef.current = null;
      toast.error(error instanceof Error ? error.message : "The SVP reservation failed.");
    },
  });

  const signOutMutation = useMutation({
    mutationFn: (all: boolean) => signOutSvpSession({ data: all ? { all: true } : {} }),
    onSuccess: (_data, all) => {
      resetFlow();
      setAddAccountOpen(false);
      invalidateSvpData();
      toast.success(all ? "All SVP accounts removed" : "Active SVP account removed");
    },
    onError: () => toast.error("Could not sign out of SVP."),
  });

  const reconnectMutation = useMutation({
    mutationFn: (login: string) => reconnectSvpAccount({ data: { login } }),
    onSuccess: (response, login) => {
      if (!response.ok) {
        toast.error(response.message);
        return;
      }
      setReconnectLogin(login);
      setAddAccountOpen(false);
      toast.success(response.message);
    },
    onError: () => toast.error("SVP could not send the OTP. Try again."),
  });

  const switchMutation = useMutation({
    mutationFn: (login: string) => switchSvpAccount({ data: { login } }),
    onSuccess: () => {
      resetFlow();
      setAddAccountOpen(false);
      invalidateSvpData();
      toast.success("SVP account switched");
    },
    onError: () => toast.error("Could not switch the SVP account."),
  });

  const removeMutation = useMutation({
    mutationFn: (login: string) => removeSvpAccount({ data: { login } }),
    onSuccess: () => {
      resetFlow();
      setAddAccountOpen(false);
      invalidateSvpData();
      toast.success("SVP account removed");
    },
    onError: () => toast.error("Could not remove the SVP account."),
  });

  const handleSignedIn = () => {
    setAddAccountOpen(false);
    resetFlow();
    invalidateSvpData();
  };

  const shownDateOptions = isTargeted ? dateOptions : siteDateOptions;
  const datesLoading = isTargeted ? datesQuery.isFetching : sitesQuery.isFetching;
  const datesError = isTargeted
    ? datesQuery.data && !datesQuery.data.ok
      ? datesQuery.data.message
      : null
    : sitesQuery.data && !sitesQuery.data.ok
      ? sitesQuery.data.message
      : null;
  const datesLoaded = isTargeted ? Boolean(datesQuery.data?.ok) : Boolean(sitesQuery.data?.ok);
  const activeDateValue = isTargeted
    ? selectedDate
      ? splitDateTime(selectedDate.startAt).date
      : ""
    : (prometricDate ?? "");
  // Collapse identical capacity tokens, keeping distinct center/time/seat details.
  const visibleExamSessions = isTargeted
    ? examSessions.filter((entry, index, list) => {
        if (!isLoadBalancer) return true;
        const key = (session: SvpExamSession) =>
          JSON.stringify([
            session.startAt,
            session.endAt,
            session.city,
            session.centerName,
            session.availableSeats,
          ]);
        return list.findIndex((other) => key(other) === key(entry)) === index;
      })
    : examSessions;
  // Show the first SVP session as soon as the date loads.
  useEffect(() => {
    if (!isTargeted || stage !== "dates" || !sessionsQuery.data?.ok) return;
    // Keep a valid selection after refresh; never book a session that disappeared.
    const current = visibleExamSessions.find(
      (entry) => entry.id === selectedSession?.id && entry.availableSeats !== 0,
    );
    const next = current ?? visibleExamSessions.find((entry) => entry.availableSeats !== 0) ?? null;
    if (next !== selectedSession) setSelectedSession(next);
  }, [isTargeted, selectedSession, sessionsQuery.data, stage, visibleExamSessions]);

  // Site-based dates also resolve their first test center as soon as the date is chosen.
  useEffect(() => {
    if (isTargeted || stage !== "dates" || !slotsQuery.data?.ok) return;
    const current = prometricSlots.find(
      (slot) => slot.id === selectedSlot?.id && slot.availableSeats !== 0,
    );
    const next = current ?? prometricSlots.find((slot) => slot.availableSeats !== 0) ?? null;
    if (next === selectedSlot) return;
    if (next) chooseSlot(next);
    else {
      setSelectedSlot(null);
      setSelectedSession(null);
    }
  }, [chooseSlot, isTargeted, prometricSlots, selectedSlot, slotsQuery.data, stage]);

  const sessionViews: SvpSessionOption[] = isTargeted
    ? visibleExamSessions.map((entry) => ({
        key: `s-${entry.id}`,
        startAt: entry.startAt,
        endAt: entry.endAt,
        center: entry.centerName,
        city: entry.city ?? sessionCity,
        seats: entry.availableSeats,
        selected: selectedSession?.id === entry.id && !selectedSlot,
        onSelect: () => {
          setSelectedSession(entry);
          setSelectedSlot(null);
          setHoldId(null);
          setPrometricHoldExpiresAt(null);
          setTargetedHoldExpiresAt(null);
        },
      }))
    : prometricSlots.map((slot) => {
        const site = prometricSites.find((entry) => entry.siteId === slot.siteId) ?? null;
        return {
          key: `p-${slot.id}`,
          startAt: slot.startAt,
          center: site?.name ?? null,
          city: site?.city ?? city,
          seats: slot.availableSeats ?? null,
          selected: selectedSlot?.id === slot.id,
          onSelect: () => chooseSlot(slot),
        };
      });
  const activeSessionView = sessionViews.find((view) => view.selected) ?? null;
  const sessionsLoading = isTargeted ? sessionsQuery.isFetching : slotsQuery.isFetching;
  const sessionsError = isTargeted
    ? sessionsQuery.data && !sessionsQuery.data.ok
      ? sessionsQuery.data.message
      : sessionsQuery.isError
        ? "Could not load exam sessions. Please retry."
        : null
    : slotsQuery.data && !slotsQuery.data.ok
      ? slotsQuery.data.message
      : slotsQuery.isError
        ? "Could not load available slots. Please retry."
        : null;
  const sessionsLoaded = isTargeted
    ? Boolean(sessionsQuery.data?.ok)
    : Boolean(slotsQuery.data?.ok);

  if (payReservationId) {
    return <SvpPaymentPage reservationId={payReservationId} initialPaymentId={returnPaymentId} />;
  }

  if (sessionQuery.isPending) {
    return (
      <section
        className="flex items-center gap-2 rounded-2xl border bg-card p-6 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle className="h-4 w-4 animate-spin" /> Checking the SVP session…
      </section>
    );
  }

  if (!signedIn) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border bg-card/80 p-4 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            SVP booking workspace
          </p>
          <h1 className="mt-1 text-xl font-bold">New booking</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with the candidate&apos;s SVP account. After the OTP, this page opens the
            booking form automatically.
          </p>
        </div>
        {sessionQuery.isError && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            The SVP session could not be checked. Sign in again.
          </p>
        )}
        <p role="status" className="rounded-lg border bg-muted/40 p-3 text-sm">
          Sign in to an SVP account. You can keep up to 4 accounts and switch between them without
          entering the password and OTP again.
        </p>
        {(sessionQuery.data?.accountCount ?? 0) > 0 && (
          <p
            role="status"
            className="rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950"
          >
            Your saved SVP session expired. Sign in again with the username and password to refresh
            it.
          </p>
        )}
        <SvpLoginPanel onSignedIn={handleSignedIn} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {addAccountOpen && (
        <section className="card-surface space-y-3 p-4 sm:p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Add another SVP account</h2>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setAddAccountOpen(false)}
            >
              Cancel
            </Button>
          </div>
          <SvpLoginPanel onSignedIn={handleSignedIn} />
        </section>
      )}

      <section className="relative overflow-hidden rounded-3xl border border-emerald-900/20 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 p-5 text-white shadow-lg sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/20 bg-emerald-300/10 px-3 py-1 text-[11px] font-medium text-emerald-100">
              <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-300" />
              Official SVP API · live · v28
            </div>
            <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
              Book an SVP appointment
            </h2>
          </div>
          <div className="w-full space-y-2 sm:w-auto">
            <Button
              type="button"
              size="sm"
              className="w-full bg-emerald-400 font-semibold text-slate-950 shadow-sm hover:bg-emerald-300"
              onClick={startNewBooking}
              disabled={
                bookingMutation.isPending ||
                localSaveStatus === "saving" ||
                Boolean(result && localSaveStatus !== "saved")
              }
            >
              <Plus className="mr-1 h-4 w-4" /> New booking
            </Button>
          </div>
        </div>
      </section>

      <section className="card-surface space-y-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">
                Signed in to SVP{status?.userName ? ` as ${status.userName}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">
                {status?.login}
                {overview?.permissions.countryName
                  ? ` · ${overview.permissions.countryName}`
                  : setup?.permissions.countryName
                    ? ` · ${setup.permissions.countryName}`
                    : ""}
                {status?.expiresAt
                  ? ` · session valid until ${new Date(status.expiresAt * 1000).toLocaleTimeString(
                      "en-GB",
                      { hour: "2-digit", minute: "2-digit" },
                    )}`
                  : ""}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={startNewBooking}
              disabled={Boolean(result && localSaveStatus !== "saved")}
            >
              <Plus className="mr-1 h-4 w-4" /> New booking
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void overviewQuery.refetch()}
              disabled={overviewQuery.isFetching}
            >
              <RefreshCw
                className={`mr-1 h-4 w-4 ${overviewQuery.isFetching ? "animate-spin" : ""}`}
              />
              Permissions
            </Button>
            <a href={SVP_PORTAL_BOOKING_URL} target="_blank" rel="noreferrer">
              <Button type="button" variant="outline" size="sm">
                <ExternalLink className="mr-1 h-4 w-4" /> Portal
              </Button>
            </a>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => signOutMutation.mutate(false)}
              disabled={signOutMutation.isPending}
            >
              <LogOut className="mr-1 h-4 w-4" /> Remove active
            </Button>
          </div>
        </div>

        {overviewQuery.data && !overviewQuery.data.ok && (
          <p role="alert" className="text-sm text-destructive">
            {overviewQuery.data.message}
          </p>
        )}
      </section>

      <section className="card-surface space-y-3 p-4 sm:p-5" aria-labelledby="svp-accounts">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              SVP accounts
            </p>
            <h2 id="svp-accounts" className="text-lg font-bold">
              Active SVP account
            </h2>
            <p className="text-xs text-muted-foreground">
              {accounts.length} saved · Reconnect sends a fresh OTP with the saved email and
              password.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setReconnectLogin(null);
              setAddAccountOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Add account
          </Button>
        </div>

        {reconnectLogin && (
          <div className="space-y-2">
            <p className="rounded-lg border border-primary/30 bg-primary/5 p-2 text-xs">
              OTP sent to the saved email for {reconnectLogin}. Enter it below to reconnect — no
              password needed.
            </p>
            <SvpLoginPanel
              key={reconnectLogin}
              otpOnly
              login={reconnectLogin}
              onSignedIn={() => {
                setReconnectLogin(null);
                handleSignedIn();
              }}
            />
          </div>
        )}

        <div className="space-y-2">
          {(accounts.length > 0
            ? accounts
            : status?.login
              ? [
                  {
                    login: status.login,
                    userName: status.userName,
                    expiresAt: status.expiresAt,
                    active: true,
                  },
                ]
              : []
          ).map((account) => (
            <div
              key={account.login}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 ${
                account.active ? "border-primary/40 bg-primary/5" : "bg-background/40"
              }`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">
                  {account.userName ?? account.login}
                </p>
                <p className="truncate text-xs text-muted-foreground">{account.login}</p>
                <p className="text-[11px] text-muted-foreground">
                  {account.active ? "Active account" : "Saved account"}
                  {account.expiresAt > 0
                    ? ` · session valid until ${new Date(account.expiresAt * 1000).toLocaleString(
                        "en-GB",
                        {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        },
                      )}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {!account.active && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => switchMutation.mutate(account.login)}
                    disabled={switchMutation.isPending}
                  >
                    Use account
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => reconnectMutation.mutate(account.login)}
                  disabled={
                    reconnectMutation.isPending && reconnectMutation.variables === account.login
                  }
                >
                  <RefreshCw
                    className={`mr-1 h-3.5 w-3.5 ${
                      reconnectMutation.isPending && reconnectMutation.variables === account.login
                        ? "animate-spin"
                        : ""
                    }`}
                  />
                  Reconnect
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (window.confirm(`Delete the saved SVP account ${account.login}?`)) {
                      removeMutation.mutate(account.login);
                    }
                  }}
                  disabled={removeMutation.isPending}
                >
                  <XCircle className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </div>
          ))}
          {accounts.length === 0 && !status?.login && (
            <p className="rounded-xl border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
              No saved SVP accounts yet. Sign in once to save the email and password for reconnect.
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => signOutMutation.mutate(true)}
            disabled={signOutMutation.isPending}
          >
            Sign out all
          </Button>
          {status?.login && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => signOutMutation.mutate(false)}
              disabled={signOutMutation.isPending}
            >
              <LogOut className="mr-1 h-4 w-4" /> Remove active
            </Button>
          )}
        </div>
      </section>

      {!rescheduleId && <BookingStepper stage={stage} />}

      {rescheduleId && (
        <SvpReschedulePanel
          reservationId={rescheduleId}
          rescheduleTimes={overview?.constraints.rescheduleTimes ?? null}
          countryId={overview?.permissions.countryId ?? null}
          categoryId={reservations.find((entry) => entry.id === rescheduleId)?.categoryId ?? null}
          isTargeted={isTargeted}
          loadBalancer={isLoadBalancer}
          onCancel={() => setRescheduleId(null)}
          onReconnect={requireSignIn}
          onDone={(updated) => {
            const reservationId = rescheduleId;
            setRescheduleId(null);
            void queryClient.invalidateQueries({ queryKey: ["svp-reservations"] });
            void queryClient.invalidateQueries({ queryKey: ["svp-account-overview"] });
            if (updated && reservationId) void syncLocalReschedule(reservationId, updated);
          }}
        />
      )}

      <div className="space-y-4">
        {!addAccountOpen && !rescheduleId && stage === "select" && (
          <section className="card-surface space-y-4 p-4 sm:p-5">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <BriefcaseBusiness className="h-5 w-5" />
                </span>
                <h2 className="text-xl font-bold">Step 1 · Occupation and test center</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Use the signed-in candidate&apos;s SVP account. Only occupations linked to an SVP
                category can be booked. Booking cost ৳{SVP_BOOKING_COST_BDT} per reservation.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="order-2 space-y-2">
                <Field label="Exam language *">
                  {languageChoices.length > 0 || !occupation ? (
                    <NativeSelect
                      value={activeLanguageCode}
                      onChange={(event) => {
                        setLanguageCode(event.target.value);
                        setSelectedDate(null);
                        setSelectedSession(null);
                        setSelectedSlot(null);
                        setHoldId(null);
                        setPrometricHoldExpiresAt(null);
                        setTargetedHoldExpiresAt(null);
                        setChecked(false);
                        setEligibility(null);
                        setStage("select");
                      }}
                      disabled={languageChoices.length === 0 || Boolean(takamolLanguageCode)}
                      required
                    >
                      <option value="">
                        {languageChoices.length === 0
                          ? "Select an occupation first"
                          : "Select exam language"}
                      </option>
                      {languageChoices.map((entry) => (
                        <option key={entry.code} value={entry.code}>
                          {entry.label}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Input
                      value={languageCode}
                      onChange={(event) =>
                        setLanguageCode(
                          event.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
                        )
                      }
                      placeholder="Enter the SVP language code"
                      maxLength={40}
                      required
                    />
                  )}
                </Field>
                {occupation && languageChoices.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Enter the SVP prometric language code for this occupation so the booking can be
                    submitted.
                  </p>
                )}
              </div>
              <div className="order-1 space-y-2">
                <Field label="Occupation *">
                  <div className="relative" ref={occupationBoxRef}>
                    <Input
                      value={occupationSearch}
                      onChange={(event) => {
                        setOccupationSearch(event.target.value);
                        setOccupationOpen(true);
                      }}
                      onFocus={() => setOccupationOpen(true)}
                      placeholder="Type a name, e.g. welder or loading"
                      autoComplete="off"
                      aria-autocomplete="list"
                      required
                    />
                    {occupationOpen && (
                      <div
                        className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 shadow-lg"
                        aria-label="Similar occupations"
                      >
                        {occupationSearchPending && (
                          <p
                            className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground"
                            role="status"
                          >
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Searching similar
                            occupations…
                          </p>
                        )}
                        {occupationSearchQuery.data && !occupationSearchQuery.data.ok && (
                          <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
                            {occupationSearchQuery.data.message}
                          </p>
                        )}
                        {!occupationSearchPending &&
                          debouncedOccupationSearch.length >= 1 &&
                          suggestions.length === 0 &&
                          occupationSearchQuery.data?.ok && (
                            <p className="px-2 py-1.5 text-xs text-muted-foreground">
                              No similar occupation found for “{debouncedOccupationSearch}”.
                            </p>
                          )}
                        {suggestions.length > 0 && (
                          <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                            {suggestions.length} similar occupation
                            {suggestions.length === 1 ? "" : "s"}
                          </p>
                        )}
                        {suggestions.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => void selectOccupation(entry)}
                            className="flex w-full items-start justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{entry.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {entry.occupationKey ?? `Occupation ${entry.id}`}
                              </span>
                            </span>
                            {occupationId === entry.id && (
                              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>
                {occupation && (
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">Selected: {occupation.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {occupation.occupationKey ?? `Occupation ${occupation.id}`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSelectedOccupation(null);
                        setOccupationId(null);
                        setOccupationSearch("");
                        setOccupationOpen(true);
                      }}
                    >
                      Change
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 rounded-xl border bg-muted/20 p-3">
              <Field label={isTargeted ? "Test center city" : "Test center city *"}>
                <NativeSelect
                  value={cityOptions.some((entry) => entry.city === city) ? city : ""}
                  onChange={(event) => chooseCity(event.target.value)}
                  disabled={cityOptions.length === 0}
                  aria-busy={citiesLoading}
                  required
                >
                  <option value="">
                    {citiesLoading && cityOptions.length === 0
                      ? "Loading available cities…"
                      : cityOptions.length === 0
                        ? "No cities returned by SVP"
                        : "Select an available city"}
                  </option>
                  {cityOptions.map((entry) => (
                    <option key={entry.city} value={entry.city}>
                      {entry.city}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {citiesLoading && (
                <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading available cities…
                </p>
              )}
              {manualCityFallback && (
                <Field label="City (manual fallback)">
                  <Input
                    value={city}
                    onChange={(event) => chooseCity(event.target.value)}
                    maxLength={120}
                    placeholder="Enter a known SVP test center city"
                    required
                  />
                  <span className="block text-xs text-muted-foreground">
                    The API has no city list. Enter a city only if you know the SVP test center;
                    availability must still be confirmed by SVP.
                  </span>
                </Field>
              )}
            </div>

            {occupationsQuery.isPending && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading occupations from SVP…
              </p>
            )}
            {occupationsQuery.isError && (
              <div
                className="flex flex-wrap items-center gap-2 text-sm text-destructive"
                role="alert"
              >
                <span>
                  Occupations could not be loaded:{" "}
                  {occupationsQuery.error instanceof Error
                    ? occupationsQuery.error.message
                    : "unknown error"}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={retryOccupations}>
                  Retry
                </Button>
              </div>
            )}
            {occupationsQuery.data && !occupationsQuery.data.ok && (
              <div
                className="flex flex-wrap items-center gap-2 text-sm text-destructive"
                role="alert"
              >
                <span>{occupationsQuery.data.message}</span>
                <Button type="button" size="sm" variant="outline" onClick={retryOccupations}>
                  Retry
                </Button>
              </div>
            )}
            {occupationsQuery.data?.ok && occupations.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {occupations.length} occupations loaded from SVP.
              </p>
            )}
            {occupationsQuery.data?.ok &&
              occupations.length === 0 &&
              !occupation &&
              !occupationSearch.trim() && (
                <div className="space-y-2 rounded-lg border bg-muted/20 p-3 text-sm" role="status">
                  <p className="font-medium">SVP returned no occupations for this account.</p>
                  <p className="text-xs text-muted-foreground">Build v28</p>
                  <p className="text-xs text-muted-foreground">
                    Type a word such as <strong>welder</strong> or <strong>loading</strong> in the
                    Occupation field to search SVP directly.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" onClick={retryOccupations}>
                      Reload occupations
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => diagnosticsMutation.mutate()}
                      disabled={diagnosticsMutation.isPending}
                    >
                      {diagnosticsMutation.isPending ? "Checking…" : "Run diagnostics"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => signOutMutation.mutate(false)}
                      disabled={signOutMutation.isPending}
                    >
                      Sign out SVP & retry
                    </Button>
                  </div>
                  {diagnostics && (
                    <div className="grid gap-1 rounded-lg border bg-background/60 p-2 font-mono text-[11px] text-muted-foreground">
                      <p>
                        session: {diagnostics.login ?? "—"} · svp id: {diagnostics.svpUserId ?? "—"}{" "}
                        · stored targeted: {String(diagnostics.countryTargeted)}
                      </p>
                      <p>
                        permissions: HTTP {diagnostics.permissions.status} · targeted:{" "}
                        {String(diagnostics.permissions.targeted)} · country:{" "}
                        {diagnostics.permissions.country ?? "—"}
                      </p>
                      <p>
                        labor occupations: HTTP {diagnostics.labor.status} ·{" "}
                        {diagnostics.labor.count} items · {diagnostics.labor.message ?? "ok"}
                      </p>
                      <p>
                        visitor occupations: HTTP {diagnostics.visitor.status} ·{" "}
                        {diagnostics.visitor.count} items · {diagnostics.visitor.message ?? "ok"}
                      </p>
                    </div>
                  )}
                </div>
              )}
            {occupationLookup && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading the full occupation…
              </p>
            )}
            {occupation && !effectiveCategoryId && !occupationLookup && (
              <p role="alert" className="text-sm text-destructive">
                This occupation is not linked to a bookable SVP category.
              </p>
            )}
            {setupQuery.data && !setupQuery.data.ok && (
              <p role="alert" className="text-sm text-destructive">
                {setupQuery.data.message}
              </p>
            )}

            {eligibility && (
              <div className="space-y-2">
                {eligibility.map((check) => (
                  <div
                    key={check.key}
                    className={`flex items-start gap-2 rounded-lg border p-2 text-sm ${
                      check.passed
                        ? "border-border bg-muted/30"
                        : "border-destructive/30 bg-destructive/5 text-destructive"
                    }`}
                  >
                    {check.passed ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>
                      <strong>{check.label}:</strong> {check.message}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => eligibilityMutation.mutate()}
                disabled={
                  !occupation ||
                  !effectiveCategoryId ||
                  !activeLanguageCode ||
                  occupationLookup ||
                  (!city.trim() && cityOptions.length > 0) ||
                  eligibilityMutation.isPending
                }
              >
                {eligibilityMutation.isPending ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CalendarDays className="mr-2 h-4 w-4" />
                )}
                Continue
              </Button>
            </div>
          </section>
        )}

        {!addAccountOpen && !rescheduleId && stage === "dates" && (
          <section className="card-surface space-y-4 p-4 sm:p-5">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                  <CalendarDays className="h-5 w-5" />
                </span>
                <h2 className="text-xl font-bold">Step 2 · Choose the exam session</h2>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="ml-auto shrink-0"
                  aria-label="Refresh sessions"
                  title="Refresh"
                  disabled={datesLoading || sessionsLoading}
                  onClick={refreshAvailability}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {occupation?.name} · {city}
                {activeDateValue ? ` · ${formatDateOnly(activeDateValue)}` : ""}
              </p>
            </div>

            {datesLoading && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <LoaderCircle className="h-4 w-4 animate-spin" /> Loading available dates…
              </p>
            )}
            {datesError && (
              <p role="alert" className="text-sm text-destructive">
                {datesError}
              </p>
            )}
            {Boolean(city.trim()) &&
              !datesLoading &&
              datesLoaded &&
              shownDateOptions.length === 0 && (
                <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
                  {isTargeted
                    ? "No dates with free seats are available for this occupation right now."
                    : "No test center sites have free dates this month for this city. Try another city."}
                </p>
              )}

            {(shownDateOptions.length > 0 || datesLoading || Boolean(city.trim())) && (
              <SvpDateCalendar
                options={shownDateOptions}
                value={activeDateValue}
                loading={datesLoading}
                disabled={datesLoading || !effectiveCategoryId}
                onSelect={(date) => {
                  const entry = shownDateOptions.find((option) => option.date === date) ?? {
                    date,
                    city,
                  };
                  selectDateOption(entry);
                }}
              />
            )}

            {activeDateValue && (
              <div className="space-y-2">
                {sessionsLoading && (
                  <p
                    className="flex items-center gap-2 text-sm text-muted-foreground"
                    role="status"
                  >
                    <LoaderCircle className="h-4 w-4 animate-spin" /> Loading the test center…
                  </p>
                )}
                {sessionsError && (
                  <p role="alert" className="text-sm text-destructive">
                    {sessionsError}
                  </p>
                )}
                {sessionsLoaded && !sessionsLoading && sessionViews.length === 0 && (
                  <p className="text-sm text-muted-foreground" role="status">
                    No sessions available. Choose another date.
                  </p>
                )}
                {sessionViews.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Test center</p>
                    <SvpSessionOptions
                      views={sessionViews}
                      disabled={sessionsLoading || Boolean(sessionsError)}
                    />
                  </div>
                )}

                {!isTargeted && holdId && (
                  <p className="text-xs text-muted-foreground">
                    SVP has held this slot for you. Continue to confirm the booking.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setStage("select")}>
                <RotateCcw className="mr-2 h-4 w-4" /> Back
              </Button>
              <Button
                type="button"
                onClick={continueFromDates}
                disabled={
                  continueBusy ||
                  sessionsLoading ||
                  Boolean(sessionsError) ||
                  !activeSessionView ||
                  (isTargeted
                    ? !selectedDate || (!isLoadBalancer && !selectedSession)
                    : !city.trim() || !prometricDate || !selectedSession)
                }
              >
                {(holdMutation.isPending || targetedHoldMutation.isPending) && (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                )}
                Continue
              </Button>
            </div>
          </section>
        )}

        {!addAccountOpen &&
          !rescheduleId &&
          stage === "confirm" &&
          selectedSession &&
          occupation && (
            <section className="card-surface space-y-4 p-4 sm:p-5">
              <div>
                <div className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
                    <ShieldCheck className="h-5 w-5" />
                  </span>
                  <h2 className="text-xl font-bold">Step 3 · Confirm the booking</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  The reservation is created with the real SVP API for this signed-in account.
                </p>
              </div>

              <dl className="grid gap-2 rounded-xl border bg-muted/20 p-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Occupation</dt>
                  <dd className="font-medium">{occupation.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Date and time</dt>
                  <dd className="font-medium">{formatSvpDateTime(selectedSession.startAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Test center</dt>
                  <dd className="font-medium">
                    {selectedSession.centerName ?? selectedSession.city ?? city}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Language</dt>
                  <dd className="font-medium" title={activeLanguageCode}>
                    {activeLanguageLabel}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Booking cost</dt>
                  <dd className="font-medium">৳{SVP_BOOKING_COST_BDT}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Wallet balance</dt>
                  <dd className={`font-medium ${canAffordBooking ? "" : "text-destructive"}`}>
                    ৳{walletBalance.toLocaleString("en-BD")}
                  </dd>
                </div>
              </dl>

              {!canAffordBooking && (
                <p
                  role="alert"
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
                >
                  <span>
                    ব্যালেন্স কম — প্রতি বুকিং ৳{SVP_BOOKING_COST_BDT} লাগবে। অন্তত ৳
                    {SVP_BOOKING_COST_BDT} ব্যালেন্স রাখুন।
                  </span>
                  <a href="/wallet" className="font-semibold underline">
                    ডিপোজিট করুন
                  </a>
                </p>
              )}

              {isTargeted && targetedHoldExpiresAt && (
                <p className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" /> Seat held by SVP until{" "}
                  {formatHoldExpiry(targetedHoldExpiresAt)}. Complete the booking to confirm it.
                </p>
              )}
              {!isTargeted && holdId && (
                <p className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2 text-xs text-muted-foreground">
                  <Clock3 className="h-3.5 w-3.5" /> Slot held by SVP
                  {prometricHoldExpiresAt
                    ? ` until ${formatHoldExpiry(prometricHoldExpiresAt)}`
                    : ""}
                  . Complete the booking to confirm it.
                </p>
              )}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Candidate name *">
                  <Input
                    value={candidateName}
                    maxLength={120}
                    autoComplete="off"
                    required
                    disabled={bookingMutation.isPending}
                    onChange={(event) => setCandidateName(event.target.value)}
                    placeholder="Full name"
                  />
                </Field>
                <Field label="Passport *">
                  <Input
                    value={passport}
                    maxLength={20}
                    autoComplete="off"
                    required
                    pattern="[A-Za-z0-9]{5,20}"
                    disabled={bookingMutation.isPending}
                    aria-invalid={Boolean(passport.trim()) && !candidateValidation.success}
                    onChange={(event) =>
                      setPassport(
                        event.target.value
                          .replace(/[^A-Za-z0-9]/g, "")
                          .slice(0, 20)
                          .toUpperCase(),
                      )
                    }
                    placeholder="Passport number"
                  />
                </Field>
                <Field label="Agency">
                  <Input
                    value={agency}
                    maxLength={120}
                    disabled={bookingMutation.isPending}
                    onChange={(event) => setAgency(event.target.value)}
                    placeholder="Optional"
                  />
                </Field>
              </div>
              <p className="text-xs text-muted-foreground">
                Name and passport are filled automatically when supplied by this SVP account. Review
                them or complete any missing details. Agency is optional. The local record is saved
                automatically only after SVP creates the reservation.
              </p>
              {passport.trim() && !/^[A-Za-z0-9]{5,20}$/.test(passport.trim()) && (
                <p role="alert" className="text-xs text-destructive">
                  Use 5–20 letters and numbers for the passport.
                </p>
              )}

              {occupation.driverLicenseRequired && (
                <p
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  This occupation requires a driver license upload. Complete this booking in the
                  official SVP portal instead.
                </p>
              )}

              <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4"
                  checked={accepted}
                  disabled={bookingMutation.isPending}
                  onChange={(event) => setAccepted(event.target.checked)}
                />
                <span>
                  I confirm the candidate details are correct and accept the SVP booking and refund
                  rules.
                </span>
              </label>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setStage("dates")}
                  disabled={bookingMutation.isPending}
                >
                  <RotateCcw className="mr-2 h-4 w-4" /> Back
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    if (bookingSubmittedRef.current) return;
                    openPaymentTab();
                    bookingMutation.mutate();
                  }}
                  disabled={
                    !candidateValidation.success ||
                    !accepted ||
                    !canAffordBooking ||
                    occupation.driverLicenseRequired ||
                    bookingMutation.isPending
                  }
                >
                  {bookingMutation.isPending && (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Create SVP booking
                </Button>
              </div>
            </section>
          )}

        {!addAccountOpen && !rescheduleId && stage === "done" && result && (
          <section className="card-surface space-y-3 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success-soft text-success">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold">Reservation created</h2>
                <p className="text-sm text-muted-foreground">
                  SVP reservation number: {result.reservationId}
                </p>
              </div>
            </div>
            <p className="rounded-lg border bg-muted/30 p-3 text-sm">{result.message}</p>
            {localSaveStatus === "saving" && (
              <p role="status" className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <LoaderCircle className="h-4 w-4 animate-spin" /> Saving the local reservation
                record automatically…
              </p>
            )}
            {localSaveStatus === "saved" && (
              <p
                role="status"
                className="rounded-lg border bg-success-soft p-3 text-sm text-success"
              >
                Local reservation record saved automatically.
              </p>
            )}
            {localSaveStatus === "failed" && (
              <div
                role="alert"
                className="space-y-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950"
              >
                <p>
                  SVP created the reservation, but the local record was not saved. Do not book
                  again.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    if (localRecordRef.current) void saveLocalRecord(localRecordRef.current);
                  }}
                >
                  Retry local save
                </Button>
                <p className="text-xs">
                  This retries the local record only; it does not create another SVP reservation.
                </p>
              </div>
            )}
            {result.paymentRequired && (
              <div className="space-y-2">
                <p className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-950">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  The reservation is not confirmed until payment is completed. Use the SVP card
                  payment below.
                </p>
                <SvpCardPayment
                  reservationId={result.reservationId}
                  amountHint={overview?.permissions.testPrice ?? null}
                  initialPaymentId={returnPaymentId}
                  onPaid={() => {
                    setResult((current) =>
                      current ? { ...current, paid: true, paymentRequired: false } : current,
                    );
                    void queryClient.invalidateQueries({ queryKey: ["svp-reservations"] });
                    void queryClient.invalidateQueries({ queryKey: ["svp-bookings"] });
                  }}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={resetFlow} disabled={localSaveStatus !== "saved"}>
                Book another
              </Button>
              {!result.paymentRequired && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    void downloadTicketById(
                      result.reservationId,
                      status?.userName ?? candidateName,
                      occupation?.name ?? null,
                    )
                  }
                  disabled={downloadingId === result.reservationId}
                >
                  {downloadingId === result.reservationId ? (
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Download ticket PDF
                </Button>
              )}
              <a href={SVP_PORTAL_BOOKING_URL} target="_blank" rel="noreferrer">
                <Button type="button" variant="outline">
                  <ExternalLink className="mr-2 h-4 w-4" /> Open SVP portal
                </Button>
              </a>
            </div>
          </section>
        )}

        <section
          className="card-surface space-y-3 p-4 sm:p-5"
          aria-labelledby="svp-account-bookings"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Official reservations
              </p>
              <h2 id="svp-account-bookings" className="text-lg font-bold">
                SVP bookings on this account
              </h2>
              <p className="text-xs text-muted-foreground">
                {reservations.length} total
                {cancelledReservations > 0 ? ` · ${cancelledReservations} cancelled` : ""}
              </p>
            </div>
            {reservationsQuery.isFetching && (
              <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          {reservationsQuery.data && !reservationsQuery.data.ok && (
            <p role="alert" className="text-sm text-destructive">
              {reservationsQuery.data.message}
            </p>
          )}
          {reservations.length === 0 ? (
            <p className="rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
              No SVP bookings found for this account.
            </p>
          ) : (
            <div className="divide-y overflow-hidden rounded-xl border bg-background/40">
              {reservations.map((rawEntry) => {
                const entry: SvpReservation = {
                  ...rawEntry,
                  ...(resultDetails[rawEntry.id] ?? {}),
                };
                const ticketReady = entry.status
                  ? /reserved|completed|confirmed/i.test(entry.status)
                  : false;
                return (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 text-sm transition-colors hover:bg-muted/30"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">
                        <UserRound className="mr-1 inline h-4 w-4" />{" "}
                        {entry.occupationName ?? "Occupation"} · #{entry.id}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {entry.startAt ? formatSvpDateTime(entry.startAt) : "Date not set"}
                        {(entry.centerName ?? entry.city)
                          ? ` · ${entry.centerName ?? entry.city}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusTone(entry.status)}`}
                      >
                        {entry.status ?? "unknown"}
                      </span>
                      {entry.canBeRescheduled ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => openReschedule(entry.id)}
                        >
                          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Reschedule
                        </Button>
                      ) : (
                        <span
                          className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                          title="SVP marks this booking as not reschedulable"
                        >
                          Not reschedulable
                        </span>
                      )}
                      {entry.status && !/cancel/i.test(entry.status) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (window.confirm(`Cancel SVP reservation #${entry.id}?`)) {
                              cancelMutation.mutate(entry.id);
                            }
                          }}
                          disabled={cancelMutation.isPending}
                        >
                          {cancelMutation.isPending && cancelMutation.variables === entry.id ? (
                            <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <XCircle className="mr-1 h-3.5 w-3.5" />
                          )}
                          Cancel
                        </Button>
                      )}
                      {ticketReady && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void downloadTicketById(
                              entry.id,
                              entry.laborName ?? status?.userName ?? candidateName,
                              entry.occupationEnglishName ?? entry.occupationName,
                            )
                          }
                          disabled={downloadingId === entry.id}
                        >
                          {downloadingId === entry.id ? (
                            <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="mr-1 h-3.5 w-3.5" />
                          )}
                          Ticket PDF
                        </Button>
                      )}
                      {(entry.examResult || entry.finalResult) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void downloadCbtResult(
                              entry,
                              svpCbtResultFileName(
                                entry.laborName ?? status?.userName ?? candidateName,
                                entry.occupationEnglishName ?? entry.occupationName,
                                entry.centerName,
                              ),
                            )
                          }
                        >
                          <FileText className="mr-1 h-3.5 w-3.5" /> CBT result PDF
                          {cbtResultFee > 0 ? ` · ৳${cbtResultFee}` : ""}
                        </Button>
                      )}
                      {entry.certificate &&
                        entry.certificate.status?.toLowerCase() === "active" && (
                          <Button
                            type="button"
                            size="sm"
                            onClick={() =>
                              void downloadCertificateById(
                                entry.certificate!.id,
                                entry.laborName ?? status?.userName ?? candidateName,
                                entry.occupationEnglishName ?? entry.occupationName,
                                entry.centerName ?? entry.city,
                              )
                            }
                            disabled={downloadingId === `cert-${entry.certificate.id}`}
                          >
                            {downloadingId === `cert-${entry.certificate.id}` ? (
                              <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Award className="mr-1 h-3.5 w-3.5" />
                            )}
                            Certificate PDF
                          </Button>
                        )}
                    </div>
                    {(entry.examResult || entry.finalResult || entry.certificate) && (
                      <div className="w-full">
                        <SvpResultPanel
                          reservation={entry}
                          downloading={downloadingId === `cert-${entry.certificate?.id ?? ""}`}
                          onDownloadCertificate={() => {
                            if (!entry.certificate) return;
                            void downloadCertificateById(
                              entry.certificate.id,
                              entry.laborName ?? status?.userName ?? candidateName,
                              entry.occupationEnglishName ?? entry.occupationName,
                              entry.centerName ?? entry.city,
                            );
                          }}
                          onDownloadCbtResult={(fileName) =>
                            void downloadCbtResult(entry, fileName)
                          }
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {(payments.length > 0 || notifications.length > 0) && (
          <section className="card-surface space-y-3 p-4 sm:p-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                SVP account activity
              </p>
              <h2 className="text-lg font-bold">Payments & notifications</h2>
            </div>

            {payments.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <CreditCard className="h-3.5 w-3.5" /> Card payments
                </p>
                <div className="divide-y overflow-hidden rounded-xl border bg-background/40">
                  {payments.slice(0, 8).map((payment) => (
                    <div
                      key={payment.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                    >
                      <span className="font-semibold">#{payment.id}</span>
                      <span>{payment.amount != null ? `${payment.amount} SAR` : "Amount n/a"}</span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusTone(
                          payment.transactionStatus ?? payment.status,
                        )}`}
                      >
                        {payment.transactionStatus ?? payment.status ?? "unknown"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {payment.reservationId ? `Reservation #${payment.reservationId}` : ""}
                        {payment.createdAt
                          ? `${payment.reservationId ? " · " : ""}${formatDateOnly(
                              payment.createdAt.slice(0, 10),
                            )}`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {notifications.length > 0 && (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Bell className="h-3.5 w-3.5" /> SVP notifications
                </p>
                <div className="space-y-2">
                  {notifications.slice(0, 5).map((notification) => (
                    <div key={notification.id} className="rounded-lg border bg-background/40 p-3">
                      <p className="text-sm font-medium">
                        {notification.title ?? "SVP notification"}
                      </p>
                      {notification.message && (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {notification.message}
                        </p>
                      )}
                      {notification.createdAt && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {notification.createdAt}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
