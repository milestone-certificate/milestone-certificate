import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const builder = {
      middleware: () => builder,
      inputValidator: () => builder,
      handler: (handler: unknown) => handler,
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
import {
  createSvpBooking,
  rescheduleSvpBooking,
  rescheduleSvpSiteBooking,
} from "@/lib/svp-booking.functions";
const context = { userId: "test-user", supabase: {} };
const input = {
  occupationId: 11,
  categoryId: 159,
  examSessionId: 501,
  languageCode: "en",
  fallbackLanguageCodes: ["bn"],
};
const response = (payload: unknown, status = 200) => ({ ok: status < 400, status, payload });
const invoke = (fn: unknown, data: unknown) =>
  (fn as (args: unknown) => Promise<{ ok: boolean }>)({ context, data });
beforeEach(() => {
  mocks.request.mockReset();
});

describe("booking and reschedule mutation safety", () => {
  it.each([response({}, 422), response({ exam_session_id: 0 }), response({})])(
    "does not create a booking without an assigned seat",
    async (hold) => {
      mocks.request
        .mockResolvedValueOnce(response({ can_proceed: true }))
        .mockResolvedValueOnce(hold);
      expect((await invoke(createSvpBooking, input)).ok).toBe(false);
      expect(mocks.request).toHaveBeenCalledTimes(2);
    },
  );
  it("books the assigned seat and does not retry unrelated validation errors", async () => {
    mocks.request
      .mockResolvedValueOnce(response({ can_proceed: true }))
      .mockResolvedValueOnce(response({ exam_session_id: 777 }))
      .mockResolvedValueOnce(response({ message: "Seat unavailable" }, 422));
    expect((await invoke(createSvpBooking, input)).ok).toBe(false);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    expect(mocks.request.mock.calls[2][2].body.exam_session_id).toBe(777);
  });
  it("does not reschedule if a successful hold omits its session token", async () => {
    mocks.request.mockResolvedValue(response({}, 503));
    mocks.request.mockImplementation(async (_user, path) =>
      response({}, path.endsWith("temporary_seats") ? 200 : 503),
    );
    expect((await invoke(rescheduleSvpBooking, { ...input, reservationId: "987" })).ok).toBe(false);
    expect(mocks.request.mock.calls.some((call) => call[1].endsWith("/reschedule"))).toBe(false);
  });
  it.each([500, 503, 429])("does not repeat a site reschedule after HTTP %s", async (status) => {
    mocks.request.mockImplementation(async (_user, path) => {
      if (path.endsWith("slots_availabilities")) return response({ id: "hold-1" });
      return response({}, status);
    });
    expect(
      (
        await invoke(rescheduleSvpSiteBooking, {
          reservationId: "987",
          examId: "exam",
          slotId: "slot",
          siteId: 1,
          languageCode: "en",
          categoryId: 159,
        })
      ).ok,
    ).toBe(false);
    expect(mocks.request.mock.calls.filter((call) => call[1].endsWith("/reschedule"))).toHaveLength(
      1,
    );
  });
});
