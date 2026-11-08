import { describe, expect, it } from "vitest";
import type { SvpExamSession } from "@/lib/svp-api.shared";
import { resolveSvpSessionAvailability } from "@/lib/svp-session-availability";

const request = { categoryId: 159, city: "Cumilla", examDate: "2026-11-29" };
const native = (id = "newly-encrypted-native-token"): SvpExamSession => ({
  id,
  startAt: "2026-11-29",
  endAt: null,
  duration: 0,
  availableSeats: null,
  city: "Cumilla",
  centerName: null,
  siteId: null,
});
const row = (overrides: Record<string, unknown> = {}) => ({
  encrypted_session_id: "resolved-provider-token",
  numeric_session_id: 2246098,
  resolved: true,
  exam_date: "2026-11-29",
  exam_time: "10:00 AM",
  center_name: "Cumilla Technical Training Centre",
  center_city: "Cumilla",
  available_seats: 21,
  category: { id: 159 },
  site_id: "62",
  ...overrides,
});

describe("resolved SVP availability", () => {
  it("keeps each provider token with its own full details when native ids are re-encrypted", () => {
    const sessions = [native("native-random-a"), native("native-random-b")];
    const result = resolveSvpSessionAvailability(
      sessions,
      {
        sessions: [
          row({
            encrypted_session_id: "provider-b",
            exam_time: "1:00 PM",
            center_name: "Noakhali Technical Training Centre",
            available_seats: 19,
          }),
          row({ encrypted_session_id: "provider-a" }),
        ],
      },
      request,
    );
    expect(result).toEqual([
      {
        ...native("provider-b"),
        startAt: "2026-11-29 13:00:00",
        centerName: "Noakhali Technical Training Centre",
        availableSeats: 19,
      },
      {
        ...native("provider-a"),
        startAt: "2026-11-29 10:00:00",
        centerName: "Cumilla Technical Training Centre",
        availableSeats: 21,
      },
    ]);
    expect(result.every((entry) => entry.siteId === null)).toBe(true);
  });

  it.each([
    { resolved: false },
    { exam_date: "2026-11-30" },
    { center_city: "Dhaka" },
    { category: { id: 50 } },
    { exam_time: "25:10" },
    { available_seats: null },
    { available_seats: "" },
    { center_name: null },
  ])("does not use unresolved, mismatched or incomplete availability: %j", (changes) => {
    const sessions = [native()];
    expect(resolveSvpSessionAvailability(sessions, { sessions: [row(changes)] }, request)).toEqual(
      sessions,
    );
  });

  it("rejects ambiguous duplicate provider identities", () => {
    const sessions = [native()];
    expect(
      resolveSvpSessionAvailability(
        sessions,
        { sessions: [row(), row({ center_name: "Other center" })] },
        request,
      ),
    ).toEqual(sessions);
  });

  it("preserves all native capacity tokens when the gateway still has unresolved rows", () => {
    const sessions = [native("native-first"), native("native-second")];
    expect(
      resolveSvpSessionAvailability(
        sessions,
        { sessions: [row(), row({ encrypted_session_id: "unresolved-token", resolved: false })] },
        request,
      ),
    ).toEqual(sessions);
  });

  it.each([1, 3, 8])(
    "uses the complete provider catalogue with %i rows even when the native count differs",
    (count) => {
      const sessions = [native("native-first"), native("native-second")];
      const rows = Array.from({ length: count }, (_, index) =>
        row({ encrypted_session_id: `provider-${index}`, available_seats: index + 1 }),
      );
      const result = resolveSvpSessionAvailability(sessions, { sessions: rows }, request);
      expect(result).toHaveLength(count);
      expect(result.map((entry) => entry.id)).toEqual(
        rows.map((entry) => entry.encrypted_session_id),
      );
      expect(
        result.every(
          (entry) =>
            entry.centerName === "Cumilla Technical Training Centre" &&
            entry.availableSeats !== null &&
            entry.siteId === null,
        ),
      ).toBe(true);
    },
  );

  it("does not mistake matching counts for a complete catalogue when one row is invalid", () => {
    const sessions = [native("native-first")];
    const result = resolveSvpSessionAvailability(
      sessions,
      { sessions: [row(), row({ encrypted_session_id: "wrong-day", exam_date: "2026-11-30" })] },
      request,
    );
    expect(result).toEqual(sessions);
  });

  it("handles noon, midnight and sold-out seats without changing the targeted booking path", () => {
    const result = resolveSvpSessionAvailability(
      [native("first"), native("second")],
      {
        sessions: [
          row({ encrypted_session_id: "noon", exam_time: "12:30 PM", available_seats: 0 }),
          row({ encrypted_session_id: "midnight", exam_time: "12:00 AM" }),
        ],
      },
      request,
    );
    expect(result.map((entry) => [entry.startAt, entry.availableSeats, entry.siteId])).toEqual([
      ["2026-11-29 12:30:00", 0, null],
      ["2026-11-29 00:00:00", 21, null],
    ]);
  });

  it("preserves native metadata and matches partially detailed native rows only by identity", () => {
    const known = {
      ...native("known"),
      centerName: "Official center",
      startAt: "2026-11-29 09:00:00",
      duration: 3600,
      siteId: 7,
    };
    const result = resolveSvpSessionAvailability(
      [known],
      { sessions: [row({ encrypted_session_id: "known" })] },
      request,
    );
    expect(result).toEqual([{ ...known, availableSeats: 21 }]);
    expect(resolveSvpSessionAvailability([known], { sessions: [row()] }, request)).toEqual([known]);
  });

  it("does not create availability when the native API reports no sessions", () => {
    expect(resolveSvpSessionAvailability([], { sessions: [row()] }, request)).toEqual([]);
  });
});
