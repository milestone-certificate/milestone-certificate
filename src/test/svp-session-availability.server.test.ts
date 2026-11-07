import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), availability: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      inputValidator: () => builder,
      handler: (fn: unknown) => fn,
    };
    return builder;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/svp-session.server", () => ({
  requireSvpAllowedRole: vi.fn(),
  readStoredSvpSession: () => null,
  svpAuthedRequest: mocks.request,
  svpAuthedBinary: vi.fn(),
  SvpSessionMissingError: class extends Error {},
}));
vi.mock("@/lib/takamol-availability.server", () => ({
  fetchTakamolAvailability: mocks.availability,
}));
import { listSvpExamSessions } from "@/lib/svp-booking.functions";

const input = { categoryId: 159, city: "Cumilla", examDate: "2026-11-29" };
const invoke = () =>
  (listSvpExamSessions as unknown as (args: unknown) => Promise<{ ok: boolean; data: unknown[] }>)({
    data: input,
    context: { userId: "test-user", supabase: {} },
  });
const opaque = {
  id: "native-random-token",
  start_date_in_tc_time_zone: "2026-11-29",
  test_center: { city: "Cumilla" },
};

beforeEach(() => {
  mocks.request.mockReset();
  mocks.availability.mockReset();
  mocks.request.mockResolvedValue({ ok: true, payload: { exam_sessions: [opaque] } });
  mocks.availability.mockResolvedValue({
    success: false,
    status: 502,
    message: "gateway unavailable",
  });
});

describe("session details API integration", () => {
  it("returns a real resolved session token with center, time and seats in the existing session response", async () => {
    mocks.availability.mockResolvedValue({
      success: true,
      data: {
        sessions: [
          {
            encrypted_session_id: "resolved-bookable-token",
            resolved: true,
            exam_date: "2026-11-29",
            exam_time: "12:30 PM",
            center_name: "Cumilla Technical Training Centre",
            center_city: "Cumilla",
            available_seats: 23,
            category: { id: 159 },
            site_id: "62",
          },
        ],
      },
    });
    expect(await invoke()).toMatchObject({
      ok: true,
      data: [
        {
          id: "resolved-bookable-token",
          centerName: "Cumilla Technical Training Centre",
          startAt: "2026-11-29 12:30:00",
          availableSeats: 23,
          siteId: null,
        },
      ],
    });
    expect(mocks.availability).toHaveBeenCalledWith(
      { endpoint: "sessions", categoryId: "159", city: "Cumilla", examDate: "2026-11-29" },
      { timeoutMs: 5000, maxRetries: 0 },
    );
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0]![1]).toBe("/individual_labor_space/exam_sessions");
  });

  it("keeps the native flow available when the optional details lookup fails", async () => {
    expect(await invoke()).toMatchObject({
      ok: true,
      data: [{ id: "native-random-token", centerName: null }],
    });
  });

  it("skips the extra lookup when SVP already supplies full metadata", async () => {
    mocks.request.mockResolvedValue({
      ok: true,
      payload: {
        exam_sessions: [
          {
            ...opaque,
            start_at: "2026-11-29 10:00:00",
            available_seats: 21,
            test_center: { city: "Cumilla", name: "Cumilla Technical Training Centre" },
          },
        ],
      },
    });
    expect((await invoke()).ok).toBe(true);
    expect(mocks.availability).not.toHaveBeenCalled();
  });

  it("never fetches alternative availability after SVP rejects the native session request", async () => {
    mocks.request.mockResolvedValue({ ok: false, payload: { message: "Access denied" } });
    expect((await invoke()).ok).toBe(false);
    expect(mocks.availability).not.toHaveBeenCalled();
  });
});
