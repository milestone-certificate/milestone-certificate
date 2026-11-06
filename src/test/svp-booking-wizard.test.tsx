import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SvpBookingWizard } from "@/components/app/SvpBookingWizard";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  occupations: vi.fn(),
  search: vi.fn(),
  occupationById: vi.fn(),
  reservationDetail: vi.fn(),
  cities: vi.fn(),
  setup: vi.fn(),
  overview: vi.fn(),
  sites: vi.fn(),
  slots: vi.fn(),
  hold: vi.fn(),
  targetedHold: vi.fn(),
  sessionById: vi.fn(),
  dates: vi.fn(),
  sessions: vi.fn(),
  reservations: vi.fn(),
  eligibility: vi.fn(),
  create: vi.fn(),
  takamol: vi.fn(),
  ticket: vi.fn(),
  insert: vi.fn(),
  signOut: vi.fn(),
  accounts: vi.fn(),
  switchAccount: vi.fn(),
  removeAccount: vi.fn(),
  reconnect: vi.fn(),
  payments: vi.fn(),
  notifications: vi.fn(),
  cancel: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/svp-session.functions", () => ({
  getSvpSessionStatus: mocks.status,
  signOutSvpSession: mocks.signOut,
  listSvpAccounts: mocks.accounts,
  switchSvpAccount: mocks.switchAccount,
  removeSvpAccount: mocks.removeAccount,
  reconnectSvpAccount: mocks.reconnect,
  submitSvpLogin: vi.fn(),
  submitStoredSvpOtp: vi.fn(),
}));

vi.mock("@/lib/svp-booking.functions", () => ({
  listSvpBookingOccupations: mocks.occupations,
  searchSvpOccupations: mocks.search,
  getSvpOccupationById: mocks.occupationById,
  getSvpReservationDetail: mocks.reservationDetail,
  listSvpTestCenterCities: mocks.cities,
  getSvpBookingSetup: mocks.setup,
  getSvpAccountOverview: mocks.overview,
  listSvpPrometricSites: mocks.sites,
  listSvpPrometricSlots: mocks.slots,
  createSvpPrometricHold: mocks.hold,
  createSvpTargetedHold: mocks.targetedHold,
  getSvpExamSessionById: mocks.sessionById,
  listSvpAvailableDates: mocks.dates,
  listSvpExamSessions: mocks.sessions,
  listSvpReservations: mocks.reservations,
  checkSvpBookingEligibility: mocks.eligibility,
  createSvpBooking: mocks.create,
  downloadSvpTicket: mocks.ticket,
  listSvpPayments: mocks.payments,
  listSvpNotifications: mocks.notifications,
  cancelSvpReservation: mocks.cancel,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ insert: mocks.insert }),
    rpc: mocks.rpc,
  },
}));

vi.mock("@/lib/takamol-availability.functions", () => ({
  lookupTakamolAvailability: mocks.takamol,
}));

vi.mock("@/lib/svp-local-record", () => ({
  saveSvpLocalBookingRecord: (_client: unknown, payload: unknown) => mocks.insert(payload),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/components/app/SvpLoginPanel", () => ({
  SvpLoginPanel: () => <div>SVPLOGINPANEL</div>,
}));

vi.mock("@/components/app/SvpReschedulePanel", () => ({
  SvpReschedulePanel: ({ onCancel }: { onCancel: () => void }) => (
    <div>
      RESCHEDULEPANEL
      <button type="button" onClick={onCancel}>
        Close reschedule
      </button>
    </div>
  ),
}));

const occupation = {
  id: 11,
  name: "Welder",
  arabicName: null,
  occupationKey: "721201",
  categoryId: 159,
  categoryName: "Welding",
  languages: [{ code: "en", label: "English", questionCount: 30 }],
  driverLicenseRequired: false,
};

const session = {
  id: 501,
  startAt: "2026-11-05 09:30:00",
  endAt: null,
  duration: 3600,
  availableSeats: 7,
  city: "Dhaka",
  centerName: "Dhaka Center",
  siteId: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no tab support; tests that need a payment tab provide a fake window.
  vi.spyOn(window, "open").mockImplementation(() => null);
  mocks.status.mockResolvedValue({
    signedIn: true,
    userName: "Noor Rahman",
    userPassport: "AB123456",
    login: "noor@example.com",
    expiresAt: 1_900_000_000,
  });
  mocks.occupations.mockResolvedValue({ ok: true, data: [occupation] });
  mocks.search.mockResolvedValue({ ok: true, data: [occupation] });
  mocks.occupationById.mockResolvedValue({ ok: true, data: occupation });
  mocks.reservationDetail.mockResolvedValue({
    ok: false,
    needsSignIn: false,
    message: "not loaded in tests",
  });
  mocks.sites.mockResolvedValue({
    ok: true,
    data: {
      examId: "555",
      sites: [
        {
          siteId: 9,
          name: "Site A",
          city: "Dhaka",
          address: "1 Test Road",
          dates: ["2026-12-01"],
        },
      ],
    },
  });
  mocks.slots.mockResolvedValue({
    ok: true,
    data: [{ id: "slot-1", siteId: 9, startAt: "2026-12-01T10:00:00", duration: 30 }],
  });
  mocks.hold.mockResolvedValue({ ok: true, data: { holdId: "hold-1", expiresAt: null } });
  mocks.targetedHold.mockResolvedValue({
    ok: true,
    data: { expiresAt: "2026-11-05T09:40:00.000Z", examSessionId: null },
  });
  mocks.sessionById.mockResolvedValue({ ok: true, data: session });
  mocks.cities.mockResolvedValue({ ok: true, data: [{ city: "Dhaka", countryId: 4 }] });
  mocks.setup.mockResolvedValue({
    ok: true,
    data: {
      permissions: {
        freeReservations: true,
        targeted: true,
        countryId: 4,
        countryName: "Bangladesh",
      },
      credits: 0,
      svpUserId: "969955",
    },
  });
  mocks.overview.mockResolvedValue({
    ok: true,
    data: {
      permissions: {
        freeReservations: true,
        targeted: true,
        countryId: 4,
        countryName: "Bangladesh",
        permissionKeys: ["book_appointment", "reschedule_appointment"],
      },
      constraints: { rescheduleTimes: 1, bookingHoldSeconds: 600, cancellationLimitHours: 48 },
      flags: { rescheduleEnabled: true, creditsEnabled: true },
      credits: 0,
    },
  });
  mocks.dates.mockResolvedValue({
    ok: true,
    data: [{ startAt: "2026-11-05 09:30:00", city: "Dhaka", centerName: "Dhaka Center" }],
  });
  mocks.sessions.mockResolvedValue({ ok: true, data: [session] });
  mocks.reservations.mockResolvedValue({ ok: true, data: [] });
  mocks.reconnect.mockResolvedValue({
    ok: true,
    message: "OTP sent to the saved SVP email.",
  });
  mocks.rpc.mockResolvedValue({ data: 1000, error: null });
  mocks.payments.mockResolvedValue({ ok: true, data: [] });
  mocks.notifications.mockResolvedValue({ ok: true, data: [] });
  mocks.cancel.mockResolvedValue({
    ok: true,
    data: { reservationId: "R-123", message: "Reservation cancelled in SVP." },
  });
  mocks.eligibility.mockResolvedValue({
    ok: true,
    data: [
      {
        key: "passport_expiration_condition",
        label: "Passport validity",
        passed: true,
        message: "Passed",
      },
      {
        key: "booking_availability_condition",
        label: "Booking availability",
        passed: true,
        message: "Passed",
      },
      {
        key: "already_existing_booking",
        label: "Existing booking check",
        passed: true,
        message: "Passed",
      },
    ],
  });
  mocks.create.mockResolvedValue({
    ok: true,
    data: {
      reservationId: "R-123",
      paid: true,
      paymentRequired: false,
      credits: 0,
      message: "Reservation confirmed by SVP.",
    },
  });
  mocks.takamol.mockImplementation((request: { data: { endpoint: string } }) =>
    Promise.resolve(
      request?.data?.endpoint === "occupations"
        ? {
            success: true,
            data: {
              occupations: [
                {
                  id: 159,
                  occupation_id: 11,
                  category_name: "Welding",
                  english_name: "Welder",
                  occupation_key: "721201",
                  language_code: "en",
                },
                {
                  id: 159,
                  occupation_id: 77,
                  category_name: "Loading",
                  english_name: "Load and Unload Worker",
                  occupation_key: "933301",
                  language_code: "en",
                },
              ],
            },
          }
        : { success: false, status: 200, message: "not loaded" },
    ),
  );
  mocks.ticket.mockResolvedValue({
    ok: true,
    data: { base64: globalThis.btoa("%PDF-1.4 ticket"), contentType: "application/pdf" },
  });
  mocks.insert.mockResolvedValue("local-record-1");
  mocks.signOut.mockResolvedValue({ ok: true });
  mocks.accounts.mockResolvedValue({
    accounts: [
      {
        login: "noor@example.com",
        userName: "Noor Rahman",
        expiresAt: 1_900_000_000,
        active: true,
      },
    ],
    activeLogin: "noor@example.com",
  });
  mocks.switchAccount.mockResolvedValue({
    accounts: [
      {
        login: "noor@example.com",
        userName: "Noor Rahman",
        expiresAt: 1_900_000_000,
        active: true,
      },
    ],
    activeLogin: "noor@example.com",
  });
  mocks.removeAccount.mockResolvedValue({ accounts: [], activeLogin: null });
});

/** Dates live behind a click-to-open calendar now. */
async function pickDate(label: string) {
  const matcher = new RegExp(label);
  const trigger = await screen.findByRole("button", { name: "Exam date" });
  await waitFor(() => expect(trigger).not.toBeDisabled());

  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (!screen.queryByRole("button", { name: matcher })) fireEvent.click(trigger);
    const option = await screen
      .findByRole("button", { name: matcher }, { timeout: 1500 })
      .catch(() => null);
    if (option) {
      fireEvent.click(option);
      return;
    }
  }
  throw new Error(`Date option not found: ${label}`);
}

/** The date click resolves the test center automatically, so wait for Continue to enable. */
async function clickContinue() {
  const button = screen.getByRole("button", { name: "Continue" });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
}

/** The exam language is a manual choice now, so every flow picks one first. */
function pickLanguage(label = "English") {
  const select = screen.getByLabelText("Exam language *") as HTMLSelectElement;
  const option =
    Array.from(select.options).find((entry) => entry.textContent?.trim() === label) ??
    Array.from(select.options).find((entry) => entry.value);
  if (option) fireEvent.change(select, { target: { value: option.value } });
}

function renderWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SvpBookingWizard />
    </QueryClientProvider>,
  );
}

function configureSiteMode() {
  mocks.status.mockResolvedValue({
    signedIn: true,
    userName: "Noor Rahman",
    userPassport: "AB123456",
    login: "noor@example.com",
    expiresAt: 1_900_000_000,
    countryTargeted: false,
  });
  mocks.setup.mockResolvedValue({
    ok: true,
    data: {
      permissions: {
        freeReservations: true,
        targeted: false,
        countryId: 4,
        countryName: "Bangladesh",
      },
      credits: 0,
      svpUserId: "969955",
    },
  });
  mocks.overview.mockResolvedValue({
    ok: true,
    data: {
      permissions: {
        freeReservations: true,
        targeted: false,
        countryId: 4,
        countryName: "Bangladesh",
        permissionKeys: ["book_appointment"],
      },
      constraints: { rescheduleTimes: 1, bookingHoldSeconds: 600, cancellationLimitHours: 48 },
      flags: { rescheduleEnabled: true, creditsEnabled: true },
      credits: 0,
    },
  });
}

function configureTargetedMode() {
  mocks.status.mockResolvedValue({
    signedIn: true,
    userName: "Noor Rahman",
    userPassport: "AB123456",
    login: "noor@example.com",
    expiresAt: 1_900_000_000,
    countryTargeted: true,
  });
  mocks.setup.mockResolvedValue({
    ok: true,
    data: {
      permissions: {
        freeReservations: true,
        targeted: true,
        countryId: 4,
        countryName: "Bangladesh",
      },
      credits: 0,
      svpUserId: "969955",
    },
  });
  mocks.overview.mockResolvedValue({
    ok: true,
    data: {
      permissions: {
        freeReservations: true,
        targeted: true,
        countryId: 4,
        countryName: "Bangladesh",
        permissionKeys: ["book_appointment"],
      },
      constraints: { rescheduleTimes: 1, bookingHoldSeconds: 600, cancellationLimitHours: 48 },
      flags: { rescheduleEnabled: true, creditsEnabled: true },
      credits: 0,
    },
  });
}

async function openDatesStep(city?: string) {
  await screen.findByText(/Signed in to SVP as Noor Rahman/);
  fireEvent.focus(await screen.findByLabelText("Occupation *"));
  fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
  pickLanguage();
  if (city) {
    const citySelect = await screen.findByLabelText(/Test center city/);
    await waitFor(() =>
      expect(screen.getByRole("option", { name: new RegExp(city) })).toBeInTheDocument(),
    );
    fireEvent.change(citySelect, { target: { value: city } });
  }
  await clickContinue();
  await screen.findByText(/Step 2/);
}

describe("SVP booking wizard", () => {
  it("shows the resolved test center details before any hold", async () => {
    mocks.sessions.mockResolvedValue({
      ok: true,
      data: [
        { ...session, endAt: "2026-11-05 10:30:00" },
        {
          ...session,
          id: 502,
          startAt: "2026-11-05 13:00:00",
          centerName: "Second Dhaka Center",
          availableSeats: 12,
        },
      ],
    });
    renderWizard();
    await openDatesStep();
    await pickDate("5 Nov 2026");
    const secondCenter = await screen.findByRole("button", { name: /Second Dhaka Center/ });
    expect(within(secondCenter).getByText("13:00")).toBeInTheDocument();
    expect(within(secondCenter).getByText("12")).toBeInTheDocument();
    const firstCenter = screen.getByRole("button", { name: /Dhaka Center.*09:30/ });
    expect(within(firstCenter).getByText("09:30 – 10:30")).toBeInTheDocument();
    expect(within(firstCenter).getByText("7")).toBeInTheDocument();
    fireEvent.click(secondCenter);
    expect(secondCenter).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/SVP sessions for this date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Session 1/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not provided by SVP/)).not.toBeInTheDocument();
    // The city is chosen on Step 1; Step 2 starts with the date and then loads the test center.
    expect(screen.queryByLabelText(/Test center city/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Real booking payload/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    expect(mocks.targetedHold).not.toHaveBeenCalled();
    expect(mocks.hold).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("shows the SVP login panel when there is no stored session", async () => {
    mocks.status.mockResolvedValue({
      signedIn: false,
      userName: null,
      login: null,
      expiresAt: 0,
    });
    renderWizard();

    expect(await screen.findByText("SVPLOGINPANEL")).toBeInTheDocument();
  });

  it("books a session end to end and saves the local record", async () => {
    renderWizard();

    expect(await screen.findByText(/Signed in to SVP as Noor Rahman/)).toBeInTheDocument();

    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/Step 2/)).toBeInTheDocument();
    await pickDate("5 Nov 2026");
    await clickContinue();

    await waitFor(() =>
      expect(mocks.targetedHold).toHaveBeenCalledWith({
        data: { examSessionId: 501, categoryId: 159, countryId: 4 },
      }),
    );
    expect(await screen.findByText(/Step 3/)).toBeInTheDocument();
    expect(await screen.findByText(/Seat held by SVP until/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Candidate name *"), {
      target: { value: "Noor Rahman" },
    });
    fireEvent.change(screen.getByLabelText("Passport *"), { target: { value: "AB123456" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create SVP booking" }));

    expect(await screen.findByText(/SVP reservation number: R-123/)).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        data: {
          occupationId: 11,
          categoryId: 159,
          examSessionId: 501,
          holdId: null,
          languageCode: "en",
          methodology: "in_person",
          duration: 3600,
          startAt: "2026-11-05 09:30:00",
          siteId: null,
          siteCity: null,
          countryId: 4,
        },
      }),
    );
    await waitFor(() => expect(mocks.insert).toHaveBeenCalled());
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_name: "NOOR RAHMAN",
        passport: "AB123456",
        reference_no: "R-123",
        status: "booked",
      }),
    );
  });

  it("blocks the flow when an SVP eligibility check fails", async () => {
    mocks.eligibility.mockResolvedValue({
      ok: true,
      data: [
        {
          key: "already_existing_booking",
          label: "Existing booking check",
          passed: false,
          message: "An existing reservation already uses this category.",
        },
      ],
    });
    renderWizard();

    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText(/An existing reservation already uses this category/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Step 2/)).not.toBeInTheDocument();
  });
});

describe("occupation auto-suggest", () => {
  it("keeps matching occupations visible when SVP returns an unfiltered catalogue", async () => {
    const loading = {
      ...occupation,
      id: 77,
      name: "Load and Unload Worker",
      occupationKey: "933301",
    };
    const unrelated = Array.from({ length: 45 }, (_, index) => ({
      ...occupation,
      id: 100 + index,
      name: `Unrelated occupation ${index}`,
    }));
    mocks.occupations.mockResolvedValue({ ok: true, data: [...unrelated, loading] });
    mocks.search.mockResolvedValue({ ok: true, data: [...unrelated, loading] });
    renderWizard();
    const input = await screen.findByLabelText("Occupation *");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "load" } });
    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith({ data: { query: "load" } }));
    await waitFor(() =>
      expect(screen.queryByText(/Searching similar occupations/)).not.toBeInTheDocument(),
    );
    const option = await screen.findByRole("button", { name: /Load and Unload Worker/ });
    expect(screen.queryByRole("button", { name: /Unrelated occupation/ })).not.toBeInTheDocument();
    fireEvent.click(option);
    expect(screen.getByText(/Selected: Load and Unload Worker/)).toBeInTheDocument();
  });

  it("searches SVP for similar occupations while typing", async () => {
    mocks.occupations.mockResolvedValue({
      ok: true,
      data: [{ ...occupation, id: 99, name: "Plumber", occupationKey: "713601" }],
    });
    mocks.search.mockResolvedValue({
      ok: true,
      data: [
        {
          ...occupation,
          id: 77,
          name: "Loading and Unloading Worker",
          occupationKey: "933301",
        },
      ],
    });

    renderWizard();
    const input = await screen.findByLabelText("Occupation *");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "load" } });

    await waitFor(() => expect(mocks.search).toHaveBeenCalledWith({ data: { query: "load" } }), {
      timeout: 3000,
    });
    const suggestion = await screen.findByRole("button", {
      name: /Loading and Unloading Worker/,
    });
    fireEvent.click(suggestion);

    expect(screen.getByText(/Selected: Loading and Unloading Worker/)).toBeInTheDocument();
  });
});

describe("SVP multi-account vault UI", () => {
  it("switches the active SVP account from the account selector", async () => {
    mocks.accounts.mockResolvedValue({
      accounts: [
        {
          login: "noor@example.com",
          userName: "Noor Rahman",
          expiresAt: 1_900_000_000,
          active: true,
        },
        {
          login: "other@example.com",
          userName: "Other Labor",
          expiresAt: 1_900_000_000,
          active: false,
        },
      ],
      activeLogin: "noor@example.com",
    });

    renderWizard();
    const useButtons = await screen.findAllByRole("button", { name: "Use account" });
    fireEvent.click(useButtons[0]!);

    await waitFor(() =>
      expect(mocks.switchAccount).toHaveBeenCalledWith({ data: { login: "other@example.com" } }),
    );
  });

  it("reconnects a saved account with OTP only and can delete it", async () => {
    mocks.accounts.mockResolvedValue({
      accounts: [
        {
          login: "noor@example.com",
          userName: "Noor Rahman",
          expiresAt: 1_900_000_000,
          active: true,
        },
        {
          login: "other@example.com",
          userName: "Other Labor",
          expiresAt: 1_900_000_000,
          active: false,
        },
      ],
      activeLogin: "noor@example.com",
    });
    mocks.reconnect.mockResolvedValue({
      ok: true,
      message: "OTP sent to the saved SVP email.",
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWizard();

    const reconnectButtons = await screen.findAllByRole("button", { name: "Reconnect" });
    fireEvent.click(reconnectButtons[1]!);

    await waitFor(() =>
      expect(mocks.reconnect).toHaveBeenCalledWith({ data: { login: "other@example.com" } }),
    );
    expect(await screen.findByText(/OTP sent to the saved email/)).toBeInTheDocument();
    expect(screen.getByText("SVPLOGINPANEL")).toBeInTheDocument();

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(deleteButtons[1]!);
    await waitFor(() =>
      expect(mocks.removeAccount).toHaveBeenCalledWith({ data: { login: "other@example.com" } }),
    );
  });

  it("opens the login panel to add another account without losing the active one", async () => {
    renderWizard();

    fireEvent.click(await screen.findByRole("button", { name: "Add account" }));

    expect(await screen.findByText("SVPLOGINPANEL")).toBeInTheDocument();
    expect(screen.getByText("Add another SVP account")).toBeInTheDocument();
  });
});

describe("occupation category enrichment", () => {
  it("loads the full occupation when a search result has no category", async () => {
    mocks.occupations.mockResolvedValue({ ok: true, data: [] });
    mocks.search.mockResolvedValue({
      ok: true,
      data: [
        {
          ...occupation,
          id: 77,
          name: "Load and Unload Worker",
          occupationKey: "933301",
          categoryId: null,
          categoryName: null,
        },
      ],
    });
    mocks.occupationById.mockResolvedValue({
      ok: true,
      data: {
        ...occupation,
        id: 77,
        name: "Load and Unload Worker",
        occupationKey: "933301",
        categoryId: 159,
        categoryName: "Loading",
      },
    });

    renderWizard();
    const input = await screen.findByLabelText("Occupation *");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "load" } });
    fireEvent.click(await screen.findByRole("button", { name: /Load and Unload Worker/ }));

    await waitFor(() =>
      expect(mocks.occupationById).toHaveBeenCalledWith({
        data: { occupationId: 77, name: "Load and Unload Worker" },
      }),
    );
    expect(await screen.findByText(/Selected: Load and Unload Worker/)).toBeInTheDocument();
    expect(screen.queryByText(/category 159/)).not.toBeInTheDocument();
    pickLanguage();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});

describe("SVP category auto-match", () => {
  it("matches a missing category from the occupation name", async () => {
    mocks.overview.mockResolvedValue({
      ok: true,
      data: {
        permissions: {
          freeReservations: false,
          targeted: true,
          loadBalancer: false,
          countryId: 4,
          countryName: "Bangladesh",
          permissionKeys: [],
        },
        categories: [{ id: 159, name: "Load and unload workers", arabicName: null }],
        constraints: { rescheduleTimes: 1, bookingHoldSeconds: 20, cancellationLimitHours: 72 },
        flags: { rescheduleEnabled: true, creditsEnabled: true },
        credits: 0,
      },
    });
    mocks.occupations.mockResolvedValue({ ok: true, data: [] });
    mocks.search.mockResolvedValue({
      ok: true,
      data: [
        {
          ...occupation,
          id: 77,
          name: "Load and Unload Worker",
          occupationKey: "933301",
          categoryId: null,
          categoryName: null,
        },
      ],
    });
    mocks.occupationById.mockResolvedValue({
      ok: false,
      needsSignIn: false,
      message: "not found",
    });

    renderWizard();
    const input = await screen.findByLabelText("Occupation *");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "load" } });
    fireEvent.click(await screen.findByRole("button", { name: /Load and Unload Worker/ }));

    await waitFor(() => expect(mocks.occupationById).toHaveBeenCalled());
    expect(screen.queryByText(/Auto-matched to/)).not.toBeInTheDocument();
    pickLanguage();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});

describe("SVP city dropdowns", () => {
  it("auto-selects a sole site city and passes its catalogue country id to availability", async () => {
    configureSiteMode();
    mocks.cities.mockResolvedValue({ ok: true, data: [{ city: "Dhaka", countryId: 77 }] });
    mocks.sites.mockResolvedValue({
      ok: true,
      data: {
        examId: "555",
        sites: [
          {
            siteId: 9,
            name: "Dhaka Site",
            city: "Dhaka",
            address: "1 Test Road",
            dates: ["2026-12-01"],
          },
        ],
      },
    });

    renderWizard();
    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();

    const citySelect = await screen.findByLabelText("Test center city *");
    await waitFor(() => expect(citySelect).toHaveValue("Dhaka"));
    await clickContinue();
    await waitFor(() =>
      expect(mocks.sites).toHaveBeenCalledWith({
        data: { prometricCode: "en", city: "Dhaka", countryId: 77 },
      }),
    );
  });

  it("keeps several site cities blank until selected and resets the date/session cascade on change", async () => {
    configureSiteMode();
    mocks.cities.mockResolvedValue({
      ok: true,
      data: [
        { city: "Dhaka", countryId: 77 },
        { city: "Rajshahi", countryId: 88 },
      ],
    });
    mocks.sites.mockResolvedValue({
      ok: true,
      data: {
        examId: "555",
        sites: [
          {
            siteId: 19,
            name: "Rajshahi Site",
            city: "Rajshahi",
            address: "2 Test Road",
            dates: ["2026-12-02"],
          },
        ],
      },
    });
    mocks.slots.mockResolvedValue({
      ok: true,
      data: [{ id: "slot-raj", siteId: 19, startAt: "2026-12-02T10:00:00", duration: 30 }],
    });

    renderWizard();
    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();

    const citySelect = await screen.findByLabelText("Test center city *");
    await waitFor(() => expect(citySelect).toHaveValue(""));
    await waitFor(() =>
      expect(screen.getByRole("option", { name: "Rajshahi" })).toBeInTheDocument(),
    );
    fireEvent.change(citySelect, { target: { value: "Rajshahi" } });
    await clickContinue();
    await waitFor(() =>
      expect(mocks.sites).toHaveBeenCalledWith({
        data: { prometricCode: "en", city: "Rajshahi", countryId: 88 },
      }),
    );

    await pickDate("2 Dec 2026");
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    const citySelectAgain = await screen.findByLabelText("Test center city *");
    fireEvent.change(citySelectAgain, { target: { value: "Dhaka" } });
    await clickContinue();
    await screen.findByText(/Step 2/);

    // Changing the city resets the date/session cascade.
    expect(screen.getByRole("button", { name: "Exam date" })).not.toHaveTextContent(/2 Dec 2026/);
    expect(mocks.hold).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("filters targeted dates by city before deduplication and only looks up sessions for that city", async () => {
    configureTargetedMode();
    mocks.dates.mockResolvedValue({
      ok: true,
      data: [
        { startAt: "2026-11-05 09:30:00", city: "Rajshahi", centerName: "Rajshahi Center" },
        { startAt: "2026-11-05 10:30:00", city: "Dhaka", centerName: "Dhaka Center" },
        { startAt: "2026-11-07 09:30:00", city: "Rajshahi", centerName: "Rajshahi Center" },
      ],
    });
    mocks.sessions.mockResolvedValue({
      ok: true,
      data: [{ ...session, city: "Dhaka", centerName: "Dhaka Center" }],
    });

    renderWizard();
    await openDatesStep("Dhaka");

    fireEvent.click(await screen.findByRole("button", { name: "Exam date" }));
    expect(await screen.findByRole("button", { name: /5 Nov 2026/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /7 Nov 2026/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /5 Nov 2026/ }));
    await waitFor(() =>
      expect(mocks.sessions).toHaveBeenCalledWith({
        data: { categoryId: 159, city: "Dhaka", examDate: "2026-11-05" },
      }),
    );
    expect(mocks.targetedHold).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("uses available-date cities when the site city catalogue errors", async () => {
    configureSiteMode();
    mocks.cities.mockResolvedValue({
      ok: false,
      needsSignIn: false,
      message: "City catalogue unavailable",
    });
    mocks.dates.mockResolvedValue({
      ok: true,
      data: [
        { startAt: "2026-12-01", city: "Dhaka", centerName: "Dhaka Center" },
        { startAt: "2026-12-02", city: "Rajshahi", centerName: "Rajshahi Center" },
      ],
    });

    renderWizard();
    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();

    const citySelect = await screen.findByLabelText("Test center city *");
    expect(citySelect).toHaveValue("");
    expect(await screen.findByRole("option", { name: "Dhaka" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Rajshahi" })).toBeInTheDocument();
    // The catalogue error is not surfaced in the UI.
    expect(screen.queryByText("The SVP city catalogue is unavailable.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry cities" })).not.toBeInTheDocument();
    expect(mocks.cities).toHaveBeenCalledTimes(1);
  });

  it("shows a disabled city dropdown beside a manual fallback only when no city data exists", async () => {
    configureTargetedMode();
    mocks.dates.mockResolvedValue({ ok: true, data: [] });

    renderWizard();
    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();

    expect(await screen.findByLabelText("Test center city")).toBeDisabled();
    expect(
      await screen.findByText("City (manual fallback)", undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter a known SVP test center city")).toBeEnabled();
    expect(screen.queryByRole("option", { name: "Dhaka" })).not.toBeInTheDocument();
  });

  it("shows the site-city loading state while the catalogue request is pending", async () => {
    configureSiteMode();
    let resolveCities!: (value: { ok: true; data: { city: string; countryId: number }[] }) => void;
    mocks.cities.mockResolvedValue(
      new Promise((resolve) => {
        resolveCities = resolve;
      }),
    );

    renderWizard();
    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((status) => /Loading available cities/i.test(status.textContent ?? "")),
      ).toBe(true),
    );

    resolveCities({ ok: true, data: [{ city: "Dhaka", countryId: 77 }] });
    expect(await screen.findByLabelText("Test center city *")).toHaveValue("Dhaka");
  });
});

describe("site-based booking flow", () => {
  it("holds a slot and creates the reservation with the prometric exam id and hold", async () => {
    mocks.overview.mockResolvedValue({
      ok: true,
      data: {
        permissions: {
          freeReservations: true,
          targeted: false,
          countryId: 4,
          countryName: "Bangladesh",
          permissionKeys: ["book_appointment"],
        },
        constraints: { rescheduleTimes: 1, bookingHoldSeconds: 600, cancellationLimitHours: 48 },
        flags: { rescheduleEnabled: true, creditsEnabled: true },
        credits: 0,
      },
    });
    mocks.setup.mockResolvedValue({
      ok: true,
      data: {
        permissions: {
          freeReservations: true,
          targeted: false,
          countryId: 4,
          countryName: "Bangladesh",
        },
        credits: 0,
        svpUserId: "969955",
      },
    });

    renderWizard();

    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();
    fireEvent.change(await screen.findByLabelText("Test center city *"), {
      target: { value: "Dhaka" },
    });
    await clickContinue();

    expect(await screen.findByText(/Step 2/)).toBeInTheDocument();
    await pickDate("1 Dec 2026");
    await clickContinue();

    await waitFor(() =>
      expect(mocks.hold).toHaveBeenCalledWith({
        data: { slotId: "slot-1", siteId: 9 },
      }),
    );
    expect(await screen.findByText(/Step 3/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Candidate name *"), {
      target: { value: "Noor Rahman" },
    });
    fireEvent.change(screen.getByLabelText("Passport *"), { target: { value: "AB123456" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create SVP booking" }));

    expect(await screen.findByText(/SVP reservation number: R-123/)).toBeInTheDocument();
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        data: {
          occupationId: 11,
          categoryId: 159,
          examSessionId: "555",
          holdId: "hold-1",
          languageCode: "en",
          methodology: "in_person",
          duration: 30,
          startAt: "2026-12-01T10:00:00",
          siteId: 9,
          siteCity: "Dhaka",
          countryId: 4,
        },
      }),
    );
  });
});

describe("load-balancer targeted booking", () => {
  it("holds all date tokens and books the session SVP assigns", async () => {
    mocks.overview.mockResolvedValue({
      ok: true,
      data: {
        permissions: {
          freeReservations: false,
          targeted: true,
          loadBalancer: true,
          countryId: 4,
          countryName: "Bangladesh",
          permissionKeys: [],
        },
        constraints: { rescheduleTimes: 1, bookingHoldSeconds: 20, cancellationLimitHours: 72 },
        flags: { rescheduleEnabled: true, creditsEnabled: true },
        credits: 0,
      },
    });
    mocks.setup.mockResolvedValue({
      ok: true,
      data: {
        permissions: {
          freeReservations: false,
          targeted: true,
          loadBalancer: true,
          countryId: 4,
          countryName: "Bangladesh",
        },
        credits: 0,
        svpUserId: "1337578",
      },
    });
    mocks.sessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "token-1",
          startAt: "2026-11-05",
          endAt: null,
          duration: 0,
          availableSeats: null,
          city: "Dhaka",
          centerName: null,
          siteId: null,
        },
        {
          id: "token-2",
          startAt: "2026-11-05",
          endAt: null,
          duration: 0,
          availableSeats: null,
          city: "Dhaka",
          centerName: null,
          siteId: null,
        },
        {
          ...session,
          id: "token-3",
          startAt: "2026-11-05",
          centerName: "Cumilla Technical Training Centre, Assessment and Skill Verification Campus",
          availableSeats: 8,
        },
      ],
    });
    mocks.targetedHold.mockResolvedValue({
      ok: true,
      data: { expiresAt: "2026-11-05T09:45:00.000Z", examSessionId: "assigned-1" },
    });
    mocks.sessionById.mockResolvedValue({
      ok: true,
      data: {
        id: "assigned-1",
        startAt: "2026-11-05 09:30:00",
        endAt: "2026-11-05 11:30:00",
        duration: 7200,
        availableSeats: null,
        city: "Dhaka",
        centerName: "Dhaka Technical Training Centre",
        siteId: null,
      },
    });

    renderWizard();
    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/Step 2/);
    await pickDate("5 Nov 2026");
    // The date click shows the test center directly instead of an SVP session list.
    expect(await screen.findByText("Test center")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: /Cumilla Technical Training Centre/ }),
    ).toHaveTextContent("8");
    expect(screen.queryByText(/SVP sessions for this date/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Session 1/)).not.toBeInTheDocument();
    // Load-balancer tokens are date-only: the first token is preselected, all are held.
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    await clickContinue();

    await waitFor(() =>
      expect(mocks.targetedHold).toHaveBeenCalledWith({
        data: { examSessionId: ["token-1", "token-2", "token-3"], categoryId: 159, countryId: 4 },
      }),
    );
    await waitFor(() =>
      expect(mocks.sessionById).toHaveBeenCalledWith({ data: { examSessionId: "assigned-1" } }),
    );
    expect(await screen.findByText(/Step 3/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Candidate name *"), {
      target: { value: "Md Farid" },
    });
    fireEvent.change(screen.getByLabelText("Passport *"), { target: { value: "AB123456" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Create SVP booking" }));

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith({
        data: {
          occupationId: 11,
          categoryId: 159,
          examSessionId: "assigned-1",
          holdId: null,
          languageCode: "en",
          methodology: "in_person",
          duration: 7200,
          startAt: "2026-11-05 09:30:00",
          siteId: null,
          siteCity: null,
          countryId: 4,
        },
      }),
    );
  });
});

describe("SVP availability selection", () => {
  it("loads SVP centers and continues when Takamol is unavailable, without requesting Takamol sessions", async () => {
    mocks.takamol.mockImplementation((request: { data: { endpoint: string } }) =>
      request.data.endpoint === "sessions"
        ? new Promise(() => {})
        : Promise.resolve({
            success: false,
            status: 502,
            message: "Takamol availability is temporarily unavailable. Try again later.",
          }),
    );
    renderWizard();
    await openDatesStep();
    await pickDate("5 Nov 2026");

    expect(await screen.findByText("Dhaka Center")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(
      screen.queryByText(/Takamol|Dates and sessions come live|Select an available date first/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh availability" })).not.toBeInTheDocument();
    expect(mocks.takamol).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ endpoint: "sessions" }) }),
    );
    await clickContinue();
    await waitFor(() =>
      expect(mocks.targetedHold).toHaveBeenCalledWith({
        data: { examSessionId: 501, categoryId: 159, countryId: 4 },
      }),
    );
  });

  it("selects the latest SVP session after refreshing instead of booking a removed session", async () => {
    renderWizard();
    await openDatesStep();
    await pickDate("5 Nov 2026");
    await screen.findByText("Dhaka Center");
    mocks.sessions.mockResolvedValue({
      ok: true,
      data: [{ ...session, id: 502, centerName: "Updated Dhaka Center" }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh sessions" }));
    expect(await screen.findByText("Updated Dhaka Center")).toBeInTheDocument();
    await clickContinue();
    await waitFor(() =>
      expect(mocks.targetedHold).toHaveBeenCalledWith({
        data: { examSessionId: 502, categoryId: 159, countryId: 4 },
      }),
    );
  });

  it("selects the latest site-based slot after refreshing", async () => {
    configureSiteMode();
    renderWizard();
    await openDatesStep();
    await pickDate("1 Dec 2026");
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    mocks.slots.mockResolvedValue({
      ok: true,
      data: [{ id: "slot-2", siteId: 9, startAt: "2026-12-01T11:00:00", duration: 30 }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh sessions" }));
    await screen.findByText(/11:00/);
    await clickContinue();
    await waitFor(() =>
      expect(mocks.hold).toHaveBeenCalledWith({
        data: { slotId: "slot-2", siteId: 9 },
      }),
    );
  });

  it("keeps Continue disabled while sessions load and when refresh returns no sessions", async () => {
    let resolveSessions!: (value: { ok: true; data: (typeof session)[] }) => void;
    mocks.sessions.mockReturnValue(
      new Promise((resolve) => {
        resolveSessions = resolve;
      }),
    );
    renderWizard();
    await openDatesStep();
    await pickDate("5 Nov 2026");
    expect(await screen.findByText("Loading the test center…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    resolveSessions({ ok: true, data: [session] });
    await screen.findByText("Dhaka Center");
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    mocks.sessions.mockResolvedValue({ ok: true, data: [] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh sessions" }));
    expect(
      await screen.findByText("No sessions available. Choose another date."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(mocks.targetedHold).not.toHaveBeenCalled();
  });

  it("shows an actionable SVP failure and allows refreshing to recover", async () => {
    mocks.sessions.mockResolvedValue({
      ok: false,
      needsSignIn: false,
      message: "Sessions could not be loaded.",
    });
    renderWizard();
    await openDatesStep();
    await pickDate("5 Nov 2026");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sessions could not be loaded.");
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    mocks.sessions.mockResolvedValue({ ok: true, data: [session] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh sessions" }));
    expect(await screen.findByText("Dhaka Center")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("booking and reschedule mode separation", () => {
  it("hides the booking stepper while rescheduling and returns to a clean Step 1 afterwards", async () => {
    mocks.reservations.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "987",
          status: "reserved",
          laborName: "Noor Rahman",
          occupationName: "Welder",
          occupationEnglishName: "Welder",
          city: "Dhaka",
          centerName: "Dhaka Center",
          startAt: "2026-11-05 09:30:00",
          methodology: null,
          canBeRescheduled: true,
        },
      ],
    });

    renderWizard();
    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();
    fireEvent.change(await screen.findByLabelText("Test center city"), {
      target: { value: "Dhaka" },
    });
    await clickContinue();
    await screen.findByText(/Step 2/);
    expect(screen.getByText("Occupation & center")).toBeInTheDocument();

    // Open a reschedule from the account bookings list mid-booking.
    fireEvent.click(await screen.findByRole("button", { name: /Reschedule/ }));
    expect(await screen.findByText("RESCHEDULEPANEL")).toBeInTheDocument();
    // The new-booking stepper and Step 2 stay hidden while rescheduling.
    expect(screen.queryByText("Occupation & center")).not.toBeInTheDocument();
    expect(screen.queryByText(/Step 2/)).not.toBeInTheDocument();

    // Closing the reschedule returns to a clean Step 1, not the stale Step 2.
    fireEvent.click(screen.getByRole("button", { name: "Close reschedule" }));
    expect(await screen.findByText(/Step 1/)).toBeInTheDocument();
    expect(screen.queryByText(/Step 2/)).not.toBeInTheDocument();
    expect(screen.queryByText("RESCHEDULEPANEL")).not.toBeInTheDocument();
  });
});

describe("SVP ticket download", () => {
  it("saves the PDF as Candidate_Occupation_SVP_Ticket.pdf", async () => {
    mocks.reservations.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "987",
          status: "reserved",
          laborName: "Noor Rahman",
          occupationName: "Welder",
          occupationEnglishName: "Welder",
          city: "Dhaka",
          centerName: "Dhaka Center",
          startAt: "2026-11-05 09:30:00",
          methodology: null,
        },
      ],
    });

    let downloadedName = "";
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloadedName = this.download;
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:svp-ticket"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });

    renderWizard();
    fireEvent.click(await screen.findByRole("button", { name: "Ticket PDF" }));

    await waitFor(() =>
      expect(mocks.ticket).toHaveBeenCalledWith({ data: { reservationId: "987" } }),
    );
    expect(downloadedName).toBe("Noor_Rahman_Welder_SVP_Ticket.pdf");
    clickSpy.mockRestore();
  });
});

describe("temporary seat hold", () => {
  it("does not move to confirmation when SVP rejects the seat hold", async () => {
    mocks.targetedHold.mockResolvedValue({
      ok: false,
      needsSignIn: false,
      message: "SVP could not hold this seat.",
    });

    renderWizard();
    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
    pickLanguage();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText(/Step 2/);
    await pickDate("5 Nov 2026");
    await clickContinue();

    await waitFor(() => expect(mocks.targetedHold).toHaveBeenCalled());
    expect(screen.queryByText(/Step 3/)).not.toBeInTheDocument();
  });
});

async function openConfirmation() {
  await screen.findByText(/Signed in to SVP as Noor Rahman/);
  fireEvent.focus(await screen.findByLabelText("Occupation *"));
  fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));
  pickLanguage();
  await clickContinue();
  await screen.findByText(/Step 2/);
  await pickDate("5 Nov 2026");
  await clickContinue();
  await screen.findByText(/Step 3/);
}

function submitConfirmedBooking() {
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Create SVP booking" }));
}

describe("automatic SVP candidate record flow", () => {
  it("fills name and passport from SVP while keeping agency optional", async () => {
    renderWizard();
    await openConfirmation();
    expect(screen.getByLabelText("Candidate name *")).toHaveValue("Noor Rahman");
    expect(screen.getByLabelText("Passport *")).toHaveValue("AB123456");
    expect(screen.getByLabelText("Agency")).toHaveValue("");
    expect(mocks.insert).not.toHaveBeenCalled();
    submitConfirmedBooking();
    expect(
      await screen.findByText("Local reservation record saved automatically."),
    ).toBeInTheDocument();
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ agency: null, reference_no: "R-123" }),
    );
  });

  it("applies the Takamol language automatically and ignores SVP category languages in the picker", async () => {
    const languageCode = "prometric_english_30_question_category_exam";
    const occupationWithoutLanguages = { ...occupation, languages: [] };
    mocks.occupations.mockResolvedValue({ ok: true, data: [occupationWithoutLanguages] });
    mocks.search.mockResolvedValue({ ok: true, data: [occupationWithoutLanguages] });
    mocks.occupationById.mockResolvedValue({ ok: true, data: occupationWithoutLanguages });
    mocks.overview.mockResolvedValue({
      ok: true,
      data: {
        permissions: {
          freeReservations: true,
          targeted: true,
          countryId: 4,
          countryName: "Bangladesh",
          permissionKeys: ["book_appointment"],
        },
        categories: [
          {
            id: 159,
            name: "Welding",
            arabicName: null,
            languages: [
              { code: languageCode, label: "English", questionCount: 30, nonTargeted: false },
            ],
          },
        ],
        constraints: { rescheduleTimes: 1, bookingHoldSeconds: 600, cancellationLimitHours: 48 },
        flags: { rescheduleEnabled: true, creditsEnabled: true },
        credits: 0,
      },
    });

    renderWizard();
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));

    const languageSelect = screen.getByLabelText("Exam language *") as HTMLSelectElement;
    await waitFor(() => expect(languageSelect).toHaveValue("en"));
    expect(Array.from(languageSelect.options).map((entry) => entry.value)).toEqual(["", "en"]);
    expect(languageSelect).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  it("requires missing provider passport without inventing it", async () => {
    mocks.status.mockResolvedValue({
      signedIn: true,
      userName: "Noor Rahman",
      userPassport: null,
      login: "noor@example.com",
      expiresAt: 1_900_000_000,
    });
    renderWizard();
    await openConfirmation();
    expect(screen.getByLabelText("Candidate name *")).toHaveValue("Noor Rahman");
    expect(screen.getByLabelText("Passport *")).toHaveValue("");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Create SVP booking" })).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("cleans a formatted passport and still blocks a short one", async () => {
    renderWizard();
    await openConfirmation();
    const input = screen.getByLabelText("Passport *") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "ab-123456" } });
    expect(input.value).toBe("AB123456");
    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Create SVP booking" })).toBeEnabled();

    fireEvent.change(input, { target: { value: "AB" } });
    expect(screen.getByRole("button", { name: "Create SVP booking" })).toBeDisabled();
    expect(screen.getByText(/Use 5–20 letters and numbers/)).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("never saves a local record when SVP rejects reservation creation", async () => {
    mocks.create.mockResolvedValue({
      ok: false,
      needsSignIn: false,
      message: "Reservation rejected",
    });
    renderWizard();
    await openConfirmation();
    submitConfirmedBooking();
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create SVP booking" })).toBeEnabled(),
    );
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(screen.queryByText("Reservation created")).not.toBeInTheDocument();
  });

  it("retries only the local save after a successful SVP booking", async () => {
    mocks.insert
      .mockRejectedValueOnce(new Error("Database unavailable"))
      .mockResolvedValue("recovered-row");
    renderWizard();
    await openConfirmation();
    submitConfirmedBooking();
    const retry = await screen.findByRole("button", { name: "Retry local save" });
    expect(screen.getByText(/Do not book again/)).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: "New booking" })
        .every((button) => (button as HTMLButtonElement).disabled),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Book another" })).toBeDisabled();
    fireEvent.click(retry);
    expect(
      await screen.findByText("Local reservation record saved automatically."),
    ).toBeInTheDocument();
    expect(
      screen
        .getAllByRole("button", { name: "New booking" })
        .every((button) => !(button as HTMLButtonElement).disabled),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Book another" })).toBeEnabled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(mocks.insert.mock.calls[1]?.[0]).toEqual(mocks.insert.mock.calls[0]?.[0]);
  });

  it("records pending-payment reservations without claiming they are confirmed", async () => {
    mocks.create.mockResolvedValue({
      ok: true,
      data: {
        reservationId: "R-124",
        paid: false,
        paymentRequired: true,
        credits: 0,
        message: "Payment pending",
      },
    });
    renderWizard();
    await openConfirmation();
    submitConfirmedBooking();
    await screen.findByText("Local reservation record saved automatically.");
    expect(mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({ reference_no: "R-124", status: "draft" }),
    );
    expect(screen.getByText(/not confirmed until payment/)).toBeInTheDocument();
  });

  it("opens the secure SVP payment in a new tab when payment is required", async () => {
    const tab = {
      closed: false,
      document: { write: vi.fn(), close: vi.fn() },
      location: { href: "" },
      close: vi.fn(),
    };
    vi.mocked(window.open).mockReturnValue(tab as unknown as Window);
    mocks.create.mockResolvedValue({
      ok: true,
      data: {
        reservationId: "R-900",
        paid: false,
        paymentRequired: true,
        credits: 0,
        message: "Payment pending",
      },
    });

    renderWizard();
    await openConfirmation();
    submitConfirmedBooking();

    await waitFor(() => expect(window.open).toHaveBeenCalled());
    expect(tab.document.write).toHaveBeenCalled();
    await waitFor(() => expect(tab.location.href).toBe("/svp-booking?payReservation=R-900"));
    expect(await screen.findByText(/Start the official SVP card payment/i)).toBeInTheDocument();
  });

  it("keeps the pre-submission snapshot and prevents concurrent local saves", async () => {
    let finishSave!: (id: string) => void;
    mocks.insert.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finishSave = resolve;
        }),
    );
    renderWizard();
    await openConfirmation();
    submitConfirmedBooking();
    await screen.findByText(/Saving the local reservation record automatically/);
    expect(screen.getByRole("button", { name: "Book another" })).toBeDisabled();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    finishSave("saved-row");
    await screen.findByText("Local reservation record saved automatically.");
  });
});

describe("SVP account activity", () => {
  it("shows real card payments and cancels a reservation through the DELETE route", async () => {
    mocks.payments.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "2596452",
          amount: 85,
          status: "paid",
          transactionStatus: "success",
          reservationId: "R-123",
          invoiceId: null,
          createdAt: "2026-10-20T10:00:00Z",
        },
      ],
    });
    mocks.notifications.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "n1",
          title: "Payment received",
          message: "Your card payment was confirmed.",
          createdAt: "2026-10-20",
          read: false,
        },
      ],
    });
    mocks.reservations.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "R-123",
          status: "reserved",
          laborName: "Noor Rahman",
          occupationName: "Welder",
          occupationEnglishName: "Welder",
          centerName: "Dhaka Center",
          city: "Dhaka",
          startAt: "2026-11-05 09:30:00",
          canBeRescheduled: true,
          certificate: null,
          examResult: null,
          finalResult: null,
        },
      ],
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    renderWizard();

    expect(await screen.findByText("Payments & notifications")).toBeInTheDocument();
    expect(screen.getByText("#2596452")).toBeInTheDocument();
    expect(screen.getByText("85 SAR")).toBeInTheDocument();
    expect(screen.getByText("Payment received")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(mocks.cancel).toHaveBeenCalledWith({ data: { reservationId: "R-123" } }),
    );
    expect(confirmSpy).toHaveBeenCalled();
  });
});

describe("Takamol occupation language system", () => {
  it("fills the language dropdown from the Takamol occupation language code", async () => {
    mocks.occupations.mockResolvedValue({
      ok: true,
      data: [{ ...occupation, languages: [] }],
    });
    mocks.occupationById.mockResolvedValue({
      ok: true,
      data: { ...occupation, languages: [] },
    });
    mocks.takamol.mockImplementation((request: { data: { endpoint: string } }) =>
      Promise.resolve(
        request.data.endpoint === "occupations"
          ? {
              success: true,
              data: {
                occupations: [{ id: 159, occupation_id: 11, language_code: "WLDBB" }],
              },
            }
          : { success: false, status: 200, message: "not loaded" },
      ),
    );

    renderWizard();
    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));

    const select = (await screen.findByLabelText("Exam language *")) as HTMLSelectElement;
    await waitFor(() => expect(select).toHaveValue("WLDBB"));
    // Only Takamol's language is shown and it is applied automatically.
    expect(Array.from(select.options).filter((option) => option.value)).toHaveLength(1);
    expect(select).toBeDisabled();
    expect(screen.queryByText(/applied automatically from Takamol/)).not.toBeInTheDocument();
  });

  it("sends SVP language fallbacks so a rejected code cannot block the booking", async () => {
    mocks.occupations.mockResolvedValue({
      ok: true,
      data: [
        {
          ...occupation,
          languages: [
            { code: "en", label: "English", questionCount: 30, nonTargeted: false },
            { code: "ar", label: "Arabic", questionCount: 30, nonTargeted: false },
          ],
        },
      ],
    });

    renderWizard();
    await openConfirmation();
    submitConfirmedBooking();

    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            languageCode: "en",
            fallbackLanguageCodes: ["ar"],
          }),
        }),
      ),
    );
  });
});

describe("manual language fallback", () => {
  it("allows a manual language code when neither Takamol nor SVP returns one", async () => {
    mocks.occupations.mockResolvedValue({
      ok: true,
      data: [{ ...occupation, languages: [] }],
    });
    mocks.occupationById.mockResolvedValue({
      ok: true,
      data: { ...occupation, languages: [] },
    });
    mocks.takamol.mockImplementation((request: { data: { endpoint: string } }) =>
      Promise.resolve(
        request.data.endpoint === "occupations"
          ? {
              success: true,
              data: { occupations: [{ id: 159, occupation_id: 11, language_code: "" }] },
            }
          : { success: false, status: 200, message: "not loaded" },
      ),
    );

    renderWizard();
    await screen.findByText(/Signed in to SVP as Noor Rahman/);
    fireEvent.focus(await screen.findByLabelText("Occupation *"));
    fireEvent.click(await screen.findByRole("button", { name: /Welder/ }));

    const input = await screen.findByPlaceholderText("Enter the SVP language code");
    fireEvent.change(input, { target: { value: "WLDBB" } });

    await waitFor(() => expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled());
  });
});

describe("SVP booking cost", () => {
  it("shows the ৳100 booking cost on the confirmation step", async () => {
    renderWizard();
    await openConfirmation();

    expect(screen.getByText("Booking cost")).toBeInTheDocument();
    expect(screen.getByText("৳100")).toBeInTheDocument();
  });

  it("blocks the booking when the wallet balance is below the fee", async () => {
    mocks.rpc.mockResolvedValue({ data: 50, error: null });
    renderWizard();
    await openConfirmation();

    expect(await screen.findByText(/ব্যালেন্স কম/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create SVP booking" })).toBeDisabled();
  });
});
