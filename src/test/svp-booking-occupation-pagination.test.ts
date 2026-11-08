// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = { middleware: () => b, inputValidator: () => b, handler: (f: unknown) => f };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/lib/svp-session.server", () => ({
  requireSvpAllowedRole: vi.fn(),
  svpAuthedRequest: request,
  readStoredSvpSession: () => null,
  svpAuthedBinary: vi.fn(),
  SvpSessionMissingError: class extends Error {},
}));
import { listSvpBookingOccupations, searchSvpOccupations } from "@/lib/svp-booking.functions";
const invoke = (fn: unknown, data = {}) =>
  (fn as (args: unknown) => Promise<{ ok: boolean; data: { id: number }[] }>)({
    context: { userId: "user", supabase: {} },
    data,
  });
const pageResponse = (page: number) => ({
  ok: true,
  payload: {
    occupations: Array.from({ length: page === 6 ? 47 : 50 }, (_, i) => {
      const id = (page - 1) * 50 + i + 1;
      return { id, name: `Trade ${id}`, occupation_key: String(100000 + id), category_id: 1 };
    }),
    pagination: { current: page, next: page === 6 ? null : page + 1, pages: 6, count: 297 },
  },
});
beforeEach(() => {
  request.mockReset();
});
it("loads beyond four pages when SVP only accepts a 50-row page", async () => {
  request.mockImplementation(async (_user, _path, options) =>
    options.query.per_page === 50
      ? pageResponse(options.query.page)
      : { ok: false, status: 422, payload: {} },
  );
  const result = await invoke(listSvpBookingOccupations);
  expect(result.ok).toBe(true);
  expect(result.data).toHaveLength(297);
  expect(result.data.some((r) => r.id === 297)).toBe(true);
});
it("finds occupations on later pages when SVP's name filter returns no matches", async () => {
  request.mockImplementation(async (_user, _path, options) =>
    options.query.name || options.query.search
      ? { ok: true, payload: { occupations: [] } }
      : pageResponse(options.query.page),
  );
  const result = await invoke(searchSvpOccupations, { query: "Trade 297" });
  expect(result.ok).toBe(true);
  expect(result.data).toEqual([expect.objectContaining({ id: 297 })]);
});
