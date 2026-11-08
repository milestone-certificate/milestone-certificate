import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SvpReschedulePanel } from "@/components/app/SvpReschedulePanel";

const mocks = vi.hoisted(() => ({
  detail: vi.fn(),
  occupation: vi.fn(),
  dates: vi.fn(),
  sessions: vi.fn(),
  reschedule: vi.fn(),
  takamol: vi.fn(),
  sites: vi.fn(),
  slots: vi.fn(),
  siteReschedule: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/svp-booking.functions", () => ({
  getSvpReservationDetail: mocks.detail,
  getSvpOccupationById: mocks.occupation,
  listSvpRescheduleDates: mocks.dates,
  listSvpExamSessions: mocks.sessions,
  rescheduleSvpBooking: mocks.reschedule,
  listSvpPrometricSites: mocks.sites,
  listSvpPrometricSlots: mocks.slots,
  rescheduleSvpSiteBooking: mocks.siteReschedule,
}));

vi.mock("@/lib/takamol-availability.functions", () => ({
  lookupTakamolAvailability: mocks.takamol,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.toastError } }));

const detail = {
  id: "987",
  status: "reserved",
  laborName: "Noor Rahman",
  occupationName: "Welder",
  occupationEnglishName: "Welder",
  city: "Dhaka",
  centerName: "Dhaka Center",
  startAt: "2026-11-05 09:30:00",
  methodology: "in_person",
  canBeRescheduled: true,
  categoryId: 159,
  examSessionId: 501,
  duration: 3600,
  occupationId: 11,
  categoryName: "Welding",
  languages: [{ code: "en", label: "English", questionCount: 30 }],
  countryId: 4,
};

function takamolResponse(data: { endpoint: string; city?: string }) {
  switch (data.endpoint) {
    case "cities":
      return { success: true, data: { cities: ["Dhaka"] } };
    case "centers":
      return {
        success: true,
        data: { centers: [{ id: "center-a", name: "Site A", city: data.city ?? "Dhaka" }] },
      };
    case "dates":
      return { success: true, data: { dates: ["2026-12-01"] } };
    case "sessions":
      return {
        success: true,
        data: {
          sessions: [
            {
              id: "takamol-row-1",
              test_center_id: "center-a",
              center_name: "Site A",
              city: data.city ?? "Dhaka",
              exam_date: "2026-12-01",
              exam_time: "10:00 AM",
              status: "Available",
              available_seats: 4,
            },
          ],
        },
      };
    default:
      return { success: false, status: 400, message: "Unknown endpoint" };
  }
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detail.mockResolvedValue({ ok: true, data: detail });
  mocks.occupation.mockResolvedValue({
    ok: true,
    data: { id: 11, categoryId: 159, occupationKey: "933301", languages: [] },
  });
  mocks.dates.mockResolvedValue({
    ok: true,
    data: [{ startAt: "2026-12-01 11:00:00", city: "Dhaka", centerName: "Dhaka Center" }],
  });
  mocks.sessions.mockResolvedValue({
    ok: true,
    data: [
      {
        id: 777,
        startAt: "2026-12-01 11:00:00",
        endAt: null,
        duration: 3600,
        availableSeats: 4,
        city: "Dhaka",
        centerName: "Dhaka Center",
        siteId: null,
      },
    ],
  });
  mocks.reschedule.mockResolvedValue({
    ok: true,
    data: { message: "Appointment rescheduled with SVP." },
  });
  mocks.takamol.mockImplementation(({ data }: { data: { endpoint: string; city?: string } }) =>
    Promise.resolve(takamolResponse(data)),
  );
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
  mocks.siteReschedule.mockResolvedValue({
    ok: true,
    data: { message: "Appointment rescheduled with SVP." },
  });
});

function renderPanel(props?: {
  client?: QueryClient;
  canBeRescheduled?: boolean;
  isTargeted?: boolean;
  loadBalancer?: boolean;
  onReconnect?: () => void;
  rescheduleTimes?: number | null;
  onDone?: (
    result: { startAt: string; city: string | null; centerName: string | null } | null,
  ) => void;
}) {
  if (props?.canBeRescheduled === false) {
    mocks.detail.mockResolvedValue({ ok: true, data: { ...detail, canBeRescheduled: false } });
  }
  const client =
    props?.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SvpReschedulePanel
        reservationId="987"
        rescheduleTimes={props?.rescheduleTimes === undefined ? 1 : props.rescheduleTimes}
        isTargeted={props?.isTargeted ?? true}
        loadBalancer={props?.loadBalancer ?? false}
        onCancel={vi.fn()}
        onReconnect={props?.onReconnect}
        onDone={props?.onDone ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

async function openDates() {
  if (screen.queryByRole("dialog", { name: "খালি তারিখ" })) return;
  const field = await screen.findByRole("button", { name: "পরীক্ষার তারিখ" });
  await waitFor(() => expect(field).toBeEnabled());
  fireEvent.click(field);
}

async function pickRescheduleDate() {
  await openDates();
  fireEvent.click(await screen.findByRole("button", { name: /1 Dec 2026/ }));
}

async function changeMonth(value: string) {
  await openDates();
  fireEvent.change(await screen.findByLabelText("মাস"), { target: { value } });
}

describe("SVP reschedule panel", () => {
  it("shows the complete center name with its own time range and available seats", async () => {
    const centerName =
      "Cumilla Technical Training Centre, Assessment and Skill Verification Campus";
    mocks.sessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 777,
          startAt: "2026-12-01 11:00:00",
          endAt: "2026-12-01 12:00:00",
          duration: 3600,
          availableSeats: 4,
          centerName,
          city: "Dhaka",
          siteId: null,
        },
      ],
    });
    renderPanel();
    await pickRescheduleDate();
    const center = await screen.findByRole("button", { name: new RegExp(centerName) });
    expect(within(center).getByText(centerName)).toBeInTheDocument();
    expect(within(center).getByText("11:00 AM · সকাল – 12:00 PM · দুপুর")).toBeInTheDocument();
    expect(within(center).getByText("4")).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "খালি তারিখ" })).not.toBeInTheDocument();
    await waitFor(() => expect(center).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeEnabled();
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it("reschedules through the real SVP endpoint with the chosen session and language", async () => {
    renderPanel();

    expect(await screen.findByText(/বর্তমান সময়:/)).toBeInTheDocument();
    expect(await screen.findByText(/1 বার বাকি/)).toBeInTheDocument();

    fireEvent.change(await screen.findByLabelText("শহর"), {
      target: { value: "Dhaka" },
    });
    await pickRescheduleDate();
    fireEvent.click(await screen.findByRole("button", { name: /Dhaka Center/ }));
    fireEvent.click(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }));

    await waitFor(() =>
      expect(mocks.reschedule).toHaveBeenCalledWith({
        data: {
          reservationId: "987",
          examSessionId: 777,
          languageCode: "en",
          countryId: 4,
          categoryId: 159,
        },
      }),
    );
    expect(await screen.findByText("তারিখ বদল হয়েছে")).toBeInTheDocument();
  });

  it("holds every date token and passes the assigned-session inputs in load-balancer mode", async () => {
    mocks.sessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 777,
          startAt: "2026-12-01 11:00:00",
          endAt: null,
          duration: 3600,
          availableSeats: 4,
          city: "Dhaka",
          centerName: "Dhaka Center",
          siteId: null,
        },
        {
          id: 778,
          startAt: "2026-12-01 11:00:00",
          endAt: null,
          duration: 3600,
          availableSeats: 2,
          city: "Dhaka",
          centerName: "Dhaka Center",
          siteId: null,
        },
      ],
    });
    renderPanel({ loadBalancer: true });

    fireEvent.change(await screen.findByLabelText("শহর"), {
      target: { value: "Dhaka" },
    });
    await pickRescheduleDate();
    fireEvent.click((await screen.findAllByRole("button", { name: /Dhaka Center/ }))[0]!);
    fireEvent.click(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }));

    await waitFor(() =>
      expect(mocks.reschedule).toHaveBeenCalledWith({
        data: {
          reservationId: "987",
          examSessionId: 777,
          languageCode: "en",
          // The whole day's tokens are held so SVP can assign the real session.
          sessionIds: [777, 778],
          countryId: 4,
          categoryId: 159,
        },
      }),
    );
    expect(await screen.findByText("তারিখ বদল হয়েছে")).toBeInTheDocument();
  });

  it("blocks rescheduling when SVP marks the reservation as not reschedulable", async () => {
    renderPanel({ canBeRescheduled: false });

    expect(await screen.findByRole("button", { name: "এখন তারিখ বদলানো যাবে না" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }),
    ).not.toBeInTheDocument();
  });

  it("reports the appointment SVP stored even when it differs from the picked session", async () => {
    mocks.detail.mockResolvedValueOnce({ ok: true, data: detail }).mockResolvedValue({
      ok: true,
      data: { ...detail, startAt: "2026-12-01 15:00:00", centerName: "Mirpur Center" },
    });
    const onDone = vi.fn();
    renderPanel({ onDone });

    fireEvent.change(await screen.findByLabelText("শহর"), {
      target: { value: "Dhaka" },
    });
    await pickRescheduleDate();
    fireEvent.click(await screen.findByRole("button", { name: /Dhaka Center/ }));
    fireEvent.click(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }));

    // The hold assigned a 15:00 session, so the panel must not report the picked 11:00.
    expect(await screen.findByText(/3:00 PM · দুপুর/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ঠিক আছে" }));
    expect(onDone).toHaveBeenCalledWith({
      startAt: "2026-12-01 15:00:00",
      city: "Dhaka",
      centerName: "Mirpur Center",
    });
  });

  it("stops before the form when SVP reports no reschedules are left", async () => {
    renderPanel({ rescheduleTimes: 0 });

    expect(await screen.findByRole("button", { name: "এখন তারিখ বদলানো যাবে না" })).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("শহর")).not.toBeInTheDocument();
  });

  it("does not invent a reschedule count when SVP did not answer the constraints call", async () => {
    renderPanel({ rescheduleTimes: null });

    // Unknown quota must not read as "0 reschedule(s) left", and the form stays usable
    // because the server is the source of truth for the gate.
    expect(await screen.findByText(/বর্তমান সময়:/)).toBeInTheDocument();
    expect(screen.queryByText(/reschedule\(s\) left/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeInTheDocument();
  });

  it("asks the agent to reconnect when SVP reports an expired session", async () => {
    mocks.reschedule.mockResolvedValue({
      ok: false,
      needsSignIn: true,
      message: "The SVP session expired. Sign in again.",
    });
    const onReconnect = vi.fn();
    renderPanel({ onReconnect });

    fireEvent.change(await screen.findByLabelText("শহর"), {
      target: { value: "Dhaka" },
    });
    await pickRescheduleDate();
    fireEvent.click(await screen.findByRole("button", { name: /Dhaka Center/ }));
    fireEvent.click(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }));

    // The booking flow opens the login panel for an expired session; reschedule must too.
    await waitFor(() => expect(onReconnect).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("তারিখ বদল হয়েছে")).not.toBeInTheDocument();
  });
});

describe("SVP site-based reschedule", () => {
  it("uses SVP site dates and auto-selects a real slot even when Takamol rows do not match", async () => {
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
      data: [{ id: "real-svp-slot", siteId: 9, startAt: "2026-12-01T11:30:00", duration: 30 }],
    });
    renderPanel({ isTargeted: false });

    const citySelect = (await screen.findByLabelText("শহর")) as HTMLSelectElement;
    expect(citySelect).toHaveValue("Dhaka");
    expect(mocks.takamol).toHaveBeenCalledWith({ data: { endpoint: "cities", categoryId: "159" } });
    fireEvent.change(citySelect, { target: { value: "Dhaka" } });
    await changeMonth("2026-12");
    await waitFor(() =>
      expect(mocks.sites).toHaveBeenLastCalledWith({
        data: {
          prometricCode: "en",
          city: "Dhaka",
          countryId: 4,
          month: "2026-12",
        },
      }),
    );
    await pickRescheduleDate();

    const realSlot = await screen.findByRole("button", { name: /11:30/ });
    expect(realSlot).toBeEnabled();
    expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeEnabled();
    expect(screen.queryByText(/no matching site IDs/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/no row could be matched uniquely/i)).not.toBeInTheDocument();
  });

  it("keeps city retry and selection controls without exposing provider errors", async () => {
    mocks.takamol.mockImplementation(({ data }: { data: { endpoint: string; city?: string } }) =>
      Promise.resolve(
        data.endpoint === "cities"
          ? { success: false, status: 502, message: "Takamol city endpoint unavailable" }
          : takamolResponse(data),
      ),
    );
    renderPanel({ isTargeted: false });

    expect(await screen.findByRole("button", { name: "শহর আবার দেখুন" })).toBeInTheDocument();
    expect(
      screen.queryByText("Takamol city endpoint unavailable", { exact: false }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect((await screen.findByLabelText("শহর")) as HTMLSelectElement).toHaveValue("Dhaka");
    expect(await screen.findByRole("button", { name: "শহর আবার দেখুন" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Dhaka" })).toBeInTheDocument();
  });

  it("does not offer SVP reconnect for a Takamol authorization failure", async () => {
    const onReconnect = vi.fn();
    mocks.takamol.mockImplementation(({ data }: { data: { endpoint: string; city?: string } }) =>
      Promise.resolve(
        data.endpoint === "cities"
          ? { success: false, status: 403, message: "Takamol lookup is not authorized" }
          : takamolResponse(data),
      ),
    );
    renderPanel({ isTargeted: false, onReconnect });

    const citySelect = (await screen.findByLabelText("শহর")) as HTMLSelectElement;
    await waitFor(() => expect(citySelect).toHaveValue("Dhaka"));
    expect(await screen.findByRole("button", { name: "শহর আবার দেখুন" })).toBeInTheDocument();
    expect(
      screen.queryByText("Takamol lookup is not authorized", { exact: false }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Dhaka" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "সংযোগ করুন" })).not.toBeInTheDocument();
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it("keeps the current booking city as a fallback when Takamol returns an empty city list", async () => {
    mocks.takamol.mockImplementation(({ data }: { data: { endpoint: string; city?: string } }) =>
      Promise.resolve(
        data.endpoint === "cities"
          ? { success: true, data: { cities: [] } }
          : takamolResponse(data),
      ),
    );
    renderPanel({ isTargeted: false });

    const citySelect = (await screen.findByLabelText("শহর")) as HTMLSelectElement;
    await waitFor(() => expect(citySelect).toHaveValue("Dhaka"));
    expect(screen.queryByText(/Takamol returned no cities/)).not.toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Dhaka" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "শহর আবার দেখুন" })).toBeInTheDocument();
  });

  it("keeps the known reservation city and retry control without offering manual entry", async () => {
    mocks.takamol.mockResolvedValue({ success: false, status: 404, message: "Resource not found" });
    renderPanel({ isTargeted: false });
    expect(await screen.findByRole("button", { name: "শহর আবার দেখুন" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /অন্য শহর|manually/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("শহরের নাম")).not.toBeInTheDocument();
    expect(screen.getByLabelText("শহর")).toHaveValue("Dhaka");
    expect(mocks.siteReschedule).not.toHaveBeenCalled();
  });

  it("shows every center/session card directly after choosing a date, like booking", async () => {
    mocks.slots.mockResolvedValue({
      ok: true,
      data: [
        { id: "slot-1", siteId: 9, startAt: "2026-12-01T10:00:00", duration: 30 },
        { id: "slot-2", siteId: 9, startAt: "2026-12-01T14:00:00", duration: 30 },
      ],
    });
    renderPanel({ isTargeted: false });

    const citySelect = (await screen.findByLabelText("শহর")) as HTMLSelectElement;
    fireEvent.change(citySelect, { target: { value: "Dhaka" } });
    await changeMonth("2026-12");
    await pickRescheduleDate();

    expect(await screen.findByText("পরীক্ষাকেন্দ্র")).toBeInTheDocument();
    const morning = await screen.findByRole("button", { name: /Site A.*10:00/ });
    const afternoon = await screen.findByRole("button", { name: /Site A.*2:00 PM/ });
    expect(morning).toBeInTheDocument();
    expect(afternoon).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show only|Show all/ })).not.toBeInTheDocument();
    fireEvent.click(afternoon);
    expect(afternoon).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeEnabled();
    expect(mocks.siteReschedule).not.toHaveBeenCalled();
  });

  it("holds a slot and reschedules with the prometric exam id and site", async () => {
    renderPanel({ isTargeted: false });

    expect(await screen.findByRole("heading", { name: "তারিখ বদল" })).toBeInTheDocument();
    expect(screen.queryByText(/site-based flow/)).not.toBeInTheDocument();
    const citySelect = await screen.findByLabelText("শহর");
    await waitFor(() => expect((citySelect as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(citySelect, {
      target: { value: "Dhaka" },
    });
    await changeMonth("2026-12");
    await waitFor(() =>
      expect(mocks.sites).toHaveBeenLastCalledWith({
        data: {
          prometricCode: "en",
          city: "Dhaka",
          countryId: 4,
          month: "2026-12",
        },
      }),
    );
    await pickRescheduleDate();
    expect(await screen.findByRole("button", { name: /10:00/ })).toBeEnabled();
    const confirmButton = screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" });
    await waitFor(() => expect(confirmButton).toBeEnabled());
    fireEvent.click(confirmButton);

    await waitFor(() =>
      expect(mocks.siteReschedule).toHaveBeenCalledWith({
        data: {
          reservationId: "987",
          examId: "555",
          slotId: "slot-1",
          siteId: 9,
          siteCity: "Dhaka",
          languageCode: "en",
          duration: 30,
          startAt: "2026-12-01T10:00:00",
          categoryId: 159,
          countryId: 4,
        },
      }),
    );
    expect(await screen.findByText("তারিখ বদল হয়েছে")).toBeInTheDocument();
  });

  it("submits the selected SVP slot ID even when Takamol rows arrive in a different order", async () => {
    mocks.takamol.mockImplementation(({ data }: { data: { endpoint: string; city?: string } }) => {
      if (data.endpoint === "cities") {
        return Promise.resolve({ success: true, data: { cities: ["Dhaka"] } });
      }
      if (data.endpoint === "centers") {
        return Promise.resolve({
          success: true,
          data: {
            centers: [
              { id: "center-a", name: "Site A", city: "Dhaka" },
              { id: "center-b", name: "Site B", city: "Dhaka" },
            ],
          },
        });
      }
      if (data.endpoint === "dates") {
        return Promise.resolve({ success: true, data: { dates: ["2026-12-01"] } });
      }
      return Promise.resolve({
        success: true,
        data: {
          sessions: [
            {
              id: "tak-b",
              test_center_id: "center-b",
              city: "Dhaka",
              exam_date: "2026-12-01",
              exam_time: "11:00 AM",
              status: "Available",
              available_seats: 2,
            },
            {
              id: "tak-a",
              test_center_id: "center-a",
              city: "Dhaka",
              exam_date: "2026-12-01",
              exam_time: "10:00 AM",
              status: "Available",
              available_seats: 3,
            },
          ],
        },
      });
    });
    mocks.sites.mockResolvedValue({
      ok: true,
      data: {
        examId: "555",
        sites: [
          { siteId: 9, name: "Site A", city: "Dhaka", address: "A", dates: ["2026-12-01"] },
          { siteId: 10, name: "Site B", city: "Dhaka", address: "B", dates: ["2026-12-01"] },
        ],
      },
    });
    mocks.slots.mockResolvedValue({
      ok: true,
      data: [
        { id: "slot-a", siteId: 9, startAt: "2026-12-01T10:00:00", duration: 30 },
        { id: "slot-b", siteId: 10, startAt: "2026-12-01T11:00:00", duration: 45 },
      ],
    });
    renderPanel({ isTargeted: false });

    fireEvent.change(await screen.findByLabelText("শহর"), {
      target: { value: "Dhaka" },
    });
    await changeMonth("2026-12");
    await pickRescheduleDate();
    fireEvent.click(await screen.findByRole("button", { name: /11:00/ }));
    fireEvent.click(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }));

    await waitFor(() =>
      expect(mocks.siteReschedule).toHaveBeenCalledWith({
        data: expect.objectContaining({
          slotId: "slot-b",
          siteId: 10,
          startAt: "2026-12-01T11:00:00",
        }),
      }),
    );
  });
});

describe("reschedule error recovery and language preservation", () => {
  it("keeps a recoverable reservation panel without showing network errors", async () => {
    mocks.detail.mockRejectedValueOnce(new Error("Network unavailable"));
    renderPanel();
    expect(await screen.findByRole("button", { name: "আবার দেখুন" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "তারিখ বদল" })).toBeInTheDocument();
    expect(
      screen.queryByText(/Network unavailable|Reservation could not be loaded/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "বন্ধ করুন" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "আবার দেখুন" }));
    expect(await screen.findByLabelText("শহর")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.detail).toHaveBeenCalledTimes(2);
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it.each([{ languages: [] }, { languages: detail.languages }])(
    "keeps the current SVP language when omitted from catalogue %j",
    async ({ languages }) => {
      mocks.detail.mockResolvedValue({
        ok: true,
        data: { ...detail, languageCode: "LOABB", languages },
      });
      renderPanel();
      expect(await screen.findByLabelText("পরীক্ষার ভাষা")).toHaveValue("LOABB");
      expect(screen.getByRole("option", { name: "LOABB" })).toHaveValue("LOABB");
      fireEvent.change(screen.getByLabelText("শহর"), { target: { value: "Dhaka" } });
      await pickRescheduleDate();
      fireEvent.click(await screen.findByRole("button", { name: /Dhaka Center/ }));
      fireEvent.click(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }));
      await waitFor(() =>
        expect(mocks.reschedule).toHaveBeenCalledWith({
          data: expect.objectContaining({ languageCode: "LOABB" }),
        }),
      );
    },
  );
});

async function selectAvailableReschedule(isTargeted: boolean) {
  fireEvent.change(await screen.findByLabelText("শহর"), { target: { value: "Dhaka" } });
  if (!isTargeted) {
    await changeMonth("2026-12");
  }
  await pickRescheduleDate();
  if (isTargeted) {
    fireEvent.click(await screen.findByRole("button", { name: /Dhaka Center/ }));
  }
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeEnabled(),
  );
}

describe.each([true, false])("reschedule selection refresh (targeted=%s)", (isTargeted) => {
  it("disables Confirm when the selected session or slot is removed", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPanel({ client, isTargeted });
    await selectAvailableReschedule(isTargeted);
    const lookup = isTargeted ? mocks.sessions : mocks.slots;
    lookup.mockResolvedValue({ ok: true, data: [] });
    await act(async () => {
      await client.invalidateQueries({
        queryKey: [isTargeted ? "svp-reschedule-sessions" : "svp-reschedule-slots"],
      });
    });
    expect(await screen.findByText("এখন কোনো আসন নেই।")).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(mocks.reschedule).not.toHaveBeenCalled();
    expect(mocks.siteReschedule).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "disables Confirm after an availability failure (throws=%s)",
    async (throws) => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      renderPanel({ client, isTargeted });
      await selectAvailableReschedule(isTargeted);
      const lookup = isTargeted ? mocks.sessions : mocks.slots;
      if (throws) lookup.mockRejectedValue(new Error("Network unavailable"));
      else
        lookup.mockResolvedValue({
          ok: false,
          needsSignIn: false,
          message: "Availability unavailable",
        });
      await act(async () => {
        await client.invalidateQueries({
          queryKey: [isTargeted ? "svp-reschedule-sessions" : "svp-reschedule-slots"],
        });
      });
      expect(await screen.findByRole("button", { name: "আবার দেখুন" })).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Network unavailable|Availability unavailable/),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeDisabled();
      expect(mocks.reschedule).not.toHaveBeenCalled();
      expect(mocks.siteReschedule).not.toHaveBeenCalled();
    },
  );

  it("disables Confirm during a refetch and restores it when availability is confirmed", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPanel({ client, isTargeted });
    await selectAvailableReschedule(isTargeted);
    const lookup = isTargeted ? mocks.sessions : mocks.slots;
    const data = isTargeted
      ? [
          {
            id: 777,
            startAt: "2026-12-01 11:00:00",
            endAt: null,
            duration: 3600,
            availableSeats: 4,
            city: "Dhaka",
            centerName: "Dhaka Center",
            siteId: null,
          },
        ]
      : [{ id: "slot-1", siteId: 9, startAt: "2026-12-01T10:00:00", duration: 30 }];
    let resolve!: (result: unknown) => void;
    lookup.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    let refetch!: Promise<void>;
    act(() => {
      refetch = client.invalidateQueries({
        queryKey: [isTargeted ? "svp-reschedule-sessions" : "svp-reschedule-slots"],
      });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeDisabled(),
    );
    await act(async () => {
      resolve({ ok: true, data });
      await refetch;
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeEnabled(),
    );
    expect(mocks.reschedule).not.toHaveBeenCalled();
    expect(mocks.siteReschedule).not.toHaveBeenCalled();
  });
});

describe("refreshed reschedule data", () => {
  it("blocks a selected targeted session when its remaining seats reach zero", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPanel({ client });
    await selectAvailableReschedule(true);
    mocks.sessions.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 777,
          startAt: "2026-12-01 11:00:00",
          endAt: null,
          duration: 3600,
          availableSeats: 0,
          city: "Dhaka",
          centerName: "Dhaka Center",
          siteId: null,
        },
      ],
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["svp-reschedule-sessions"] });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeDisabled(),
    );
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it("submits refreshed site-slot details when the selected slot ID is unchanged", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderPanel({ client, isTargeted: false });
    await selectAvailableReschedule(false);
    mocks.slots.mockResolvedValue({
      ok: true,
      data: [{ id: "slot-1", siteId: 9, startAt: "2026-12-01T11:30:00", duration: 45 }],
    });
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["svp-reschedule-slots"] });
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }));
    await waitFor(() =>
      expect(mocks.siteReschedule).toHaveBeenCalledWith({
        data: expect.objectContaining({
          slotId: "slot-1",
          siteId: 9,
          startAt: "2026-12-01T11:30:00",
          duration: 45,
        }),
      }),
    );
  });
});

describe("quiet reschedule recovery", () => {
  it("offers reconnect without exposing an expired-session response", async () => {
    const onReconnect = vi.fn();
    mocks.detail.mockResolvedValue({
      ok: false,
      needsSignIn: true,
      message: "RAW_PROVIDER_TRACE expired token HTTP 401",
    });
    renderPanel({ onReconnect });
    const reconnect = await screen.findByRole("button", { name: "সংযোগ করুন" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/RAW_PROVIDER_TRACE|HTTP 401|expired token/)).not.toBeInTheDocument();
    fireEvent.click(reconnect);
    expect(onReconnect).toHaveBeenCalledOnce();
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it("recovers date loading through Retry without rendering provider diagnostics", async () => {
    mocks.dates.mockResolvedValueOnce({
      ok: false,
      needsSignIn: false,
      message: "RAW_PROVIDER_TRACE dates HTTP 502",
    });
    renderPanel();
    const retry = await screen.findByRole("button", { name: "তারিখ আবার দেখুন" });
    expect(screen.queryByText(/RAW_PROVIDER_TRACE|HTTP 502/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeDisabled();
    fireEvent.click(retry);
    await openDates();
    expect(await screen.findByRole("button", { name: /1 Dec 2026/ })).toBeInTheDocument();
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });

  it("keeps native site slots usable when optional center metadata fails quietly", async () => {
    mocks.takamol.mockImplementation(({ data }: { data: { endpoint: string; city?: string } }) =>
      Promise.resolve(
        data.endpoint === "cities"
          ? takamolResponse(data)
          : { success: false, status: 502, message: "RAW_PROVIDER_TRACE center metadata" },
      ),
    );
    renderPanel({ isTargeted: false });
    await selectAvailableReschedule(false);
    expect(await screen.findByRole("button", { name: "কেন্দ্র আবার দেখুন" })).toBeInTheDocument();
    expect(
      screen.queryByText(/RAW_PROVIDER_TRACE|Takamol centers|Takamol availability/),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeEnabled();
    expect(mocks.siteReschedule).not.toHaveBeenCalled();
  });

  it("keeps a rejected reschedule unconfirmed and allows reviewing the booking without an error toast", async () => {
    mocks.reschedule.mockResolvedValueOnce({
      ok: false,
      needsSignIn: false,
      message: "RAW_PROVIDER_TRACE reschedule failed HTTP 500",
    });
    renderPanel();
    await selectAvailableReschedule(true);
    fireEvent.click(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }));
    const review = await screen.findByRole("button", { name: "বুকিং দেখুন" });
    expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeDisabled();
    expect(screen.queryByText("তারিখ বদল হয়েছে")).not.toBeInTheDocument();
    expect(screen.queryByText(/RAW_PROVIDER_TRACE|HTTP 500/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mocks.toastError).not.toHaveBeenCalled();
    fireEvent.click(review);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeEnabled(),
    );
    expect(mocks.reschedule).toHaveBeenCalledOnce();
  });
});

describe("reschedule date regressions", () => {
  it("keeps dates with no city visible and loads sessions using the reservation city", async () => {
    mocks.dates.mockResolvedValue({
      ok: true,
      data: [{ startAt: "2026-12-01", city: null, centerName: null }],
    });
    renderPanel();
    await pickRescheduleDate();
    await waitFor(() =>
      expect(mocks.sessions).toHaveBeenCalledWith({
        data: { categoryId: 159, city: "Dhaka", examDate: "2026-12-01" },
      }),
    );
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });
  it("keeps the empty calendar and refresh action visible", async () => {
    mocks.dates.mockResolvedValue({ ok: true, data: [] });
    renderPanel();
    await openDates();
    expect(screen.getByText("এখন কোনো খালি তারিখ নেই।")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "তারিখ আবার দেখুন" })).toBeEnabled();
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });
  it("resolves a missing reservation category from its own SVP occupation", async () => {
    mocks.detail.mockResolvedValue({ ok: true, data: { ...detail, categoryId: null } });
    renderPanel();
    await waitFor(() =>
      expect(mocks.dates).toHaveBeenCalledWith({
        data: { reservationId: "987", categoryId: 159, countryId: 4 },
      }),
    );
  });
});

describe("available city and automatic language selection", () => {
  it("preserves the displayed reservation city when another city's same date comes first, and still allows a city change", async () => {
    mocks.detail.mockResolvedValue({ ok: true, data: { ...detail, city: "Rajshahi" } });
    mocks.dates.mockResolvedValue({
      ok: true,
      data: [
        { startAt: "2026-12-01", city: "Khulna", seats: 8 },
        { startAt: "2026-12-01", city: "Rajshahi", seats: 5 },
        { startAt: "2026-12-02", city: "Sylhet", seats: 0 },
      ],
    });
    renderPanel();
    const city = await screen.findByLabelText("শহর");
    await waitFor(() => expect(city).toHaveValue("Rajshahi"));
    await pickRescheduleDate();
    await waitFor(() =>
      expect(mocks.sessions).toHaveBeenLastCalledWith({
        data: { categoryId: 159, city: "Rajshahi", examDate: "2026-12-01" },
      }),
    );
    expect(city).toHaveValue("Rajshahi");
    expect(within(city).queryByRole("option", { name: "Sylhet" })).not.toBeInTheDocument();
    fireEvent.change(city, { target: { value: "Khulna" } });
    expect(screen.getByRole("button", { name: "পরীক্ষার তারিখ" })).toHaveTextContent("তারিখ বাছুন");
    await pickRescheduleDate();
    await waitFor(() =>
      expect(mocks.sessions).toHaveBeenLastCalledWith({
        data: { categoryId: 159, city: "Khulna", examDate: "2026-12-01" },
      }),
    );
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });
  it("uses Takamol's per-occupation language automatically and displays bn as Bengali", async () => {
    mocks.detail.mockResolvedValue({ ok: true, data: { ...detail, languageCode: "en" } });
    mocks.takamol.mockResolvedValue({
      success: true,
      data: { occupations: [{ occupation_id: 11, language_code: "bn" }] },
    });
    renderPanel();
    const language = await screen.findByLabelText("পরীক্ষার ভাষা");
    await waitFor(() => expect(language).toHaveValue("bn"));
    expect(language).toBeDisabled();
    expect(within(language).getByRole("option", { name: "বাংলা" })).toHaveValue("bn");
    expect(within(language).queryByRole("option", { name: "ইংরেজি" })).not.toBeInTheDocument();
    await pickRescheduleDate();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" }));
    await waitFor(() =>
      expect(mocks.reschedule).toHaveBeenCalledWith({
        data: expect.objectContaining({ languageCode: "bn" }),
      }),
    );
  });
  it("matches the Takamol language by official occupation key when catalogue ids differ", async () => {
    mocks.takamol.mockResolvedValue({
      success: true,
      data: {
        occupations: [{ occupation_id: 999, occupation_key: "933301", language_code: "bn" }],
      },
    });
    renderPanel();
    await waitFor(() => expect(screen.getByLabelText("পরীক্ষার ভাষা")).toHaveValue("bn"));
  });
  it("fetches full SVP language options when Takamol omits them and preserves the provider's preferred question code", async () => {
    mocks.occupation.mockResolvedValue({
      ok: true,
      data: {
        id: 11,
        categoryId: 159,
        languages: [
          { code: "BENG10", label: "Bengali", questionCount: 10, nonTargeted: false },
          { code: "BENG30", label: "Bengali", questionCount: 30, nonTargeted: false },
        ],
      },
    });
    mocks.detail.mockResolvedValue({
      ok: true,
      data: { ...detail, languageCode: "bn", languages: [] },
    });
    renderPanel();
    const language = await screen.findByLabelText("পরীক্ষার ভাষা");
    await waitFor(() => expect(language).toHaveValue("BENG30"));
    expect(within(language).getByRole("option", { name: "বাংলা" })).toHaveValue("BENG30");
    expect(language).toBeDisabled();
  });
  it("waits for automatic language metadata before enabling date selection and confirmation", async () => {
    let finish!: (result: unknown) => void;
    mocks.takamol.mockImplementation(({ data }: { data: { endpoint: string } }) =>
      data.endpoint === "occupations"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ success: false }),
    );
    renderPanel();
    const confirm = await screen.findByRole("button", { name: "তারিখ বদল নিশ্চিত করুন" });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole("button", { name: "পরীক্ষার তারিখ" })).toBeDisabled();
    await act(async () =>
      finish({
        success: true,
        data: { occupations: [{ occupation_id: 11, language_code: "bn" }] },
      }),
    );
    await waitFor(() => expect(screen.getByLabelText("পরীক্ষার ভাষা")).toHaveValue("bn"));
    expect(screen.getByRole("button", { name: "পরীক্ষার তারিখ" })).toHaveTextContent("তারিখ বাছুন");
    expect(confirm).toBeDisabled();
    expect(mocks.reschedule).not.toHaveBeenCalled();
  });
});

it("labels an automatic Takamol code using the complete SVP catalogue without exposing it as raw text", async () => {
  mocks.takamol.mockResolvedValue({
    success: true,
    data: { occupations: [{ occupation_id: 11, language_code: "LOABB" }] },
  });
  mocks.occupation.mockResolvedValue({
    ok: true,
    data: {
      id: 11,
      categoryId: 159,
      languages: [
        { code: "LOABB", label: "Bengali", questionCount: 0, nonTargeted: true },
        { code: "LOAEE", label: "English", questionCount: 15, nonTargeted: false },
      ],
    },
  });
  renderPanel();
  const language = await screen.findByLabelText("পরীক্ষার ভাষা");
  await waitFor(() => expect(language).toHaveAttribute("aria-busy", "false"));
  expect(language).toHaveValue("LOABB");
  expect(within(language).getByRole("option", { name: "বাংলা" })).toHaveValue("LOABB");
  expect(within(language).queryByRole("option", { name: "LOABB" })).not.toBeInTheDocument();
});
