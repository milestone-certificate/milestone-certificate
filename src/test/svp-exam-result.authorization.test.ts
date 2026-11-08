// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const admin = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = { middleware: () => b, inputValidator: () => b, handler: (f: unknown) => f };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
import { checkSvpExamResult, querySvp } from "@/lib/svp.functions";
const invoke = checkSvpExamResult as unknown as (
  a: unknown,
) => Promise<{ saved: boolean; message: string; result: { status: string } }>;
const fetcher = vi.fn();
const exam = {
  id: "exam",
  candidate_id: "person",
  occupation_id: "trade",
  exam_date: "2026-11-25",
  exam_time: "09:00",
  result: "PENDING",
};
function context(allowed = true) {
  const from = vi.fn((table: string) => {
    const data =
      table === "exams"
        ? exam
        : table === "candidates"
          ? { id: "person", passport_no: "A1234567", occupation_id: "trade" }
          : { svp_key: "933301" };
    const b = { select: () => b, eq: () => b, maybeSingle: async () => ({ data, error: null }) };
    return b;
  });
  return { userId: "staff", supabase: { rpc: async () => ({ data: allowed, error: null }), from } };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          exam_date: "2026-11-25",
          exam_result: "passed",
          applicant_name: "SAMPLE",
        }),
        { status: 200 },
      ),
  );
  admin.rpc.mockResolvedValue({ data: { ok: true, reason: "saved" }, error: null });
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it("denies non-staff before reading an exam or contacting SVP", async () => {
  const c = context(false);
  expect((await invoke({ context: c, data: { examId: "exam" } })).result.status).toBe("error");
  expect(c.supabase.from).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
  expect(admin.rpc).not.toHaveBeenCalled();
});
it("derives the passport and trade from the stored exam and passes an exact snapshot to the service RPC", async () => {
  expect((await invoke({ context: context(), data: { examId: "exam" } })).saved).toBe(true);
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get("passport_number")).toBe("A1234567");
  expect(url.searchParams.get("occupation_key")).toBe("933301");
  expect(admin.rpc).toHaveBeenCalledWith(
    "apply_verified_svp_exam_result",
    expect.objectContaining({
      _exam_id: "exam",
      _result: "PASS",
      _result_date: "2026-11-25",
      _snapshot: expect.objectContaining({
        passport: "A1234567",
        occupation_key: "933301",
        exam_date: "2026-11-25",
      }),
    }),
  );
});
it("never saves an older or missing-date result for a later retake", async () => {
  for (const day of ["2026-11-04", null]) {
    fetcher.mockImplementation(
      async () =>
        new Response(JSON.stringify({ exam_date: day, exam_result: "failed" }), { status: 200 }),
    );
    expect((await invoke({ context: context(), data: { examId: "exam" } })).saved).toBe(false);
  }
  expect(admin.rpc).not.toHaveBeenCalled();
});
it("reports a changed exam without claiming it was saved", async () => {
  admin.rpc.mockResolvedValue({ data: { ok: false, reason: "changed" }, error: null });
  const res = await invoke({ context: context(), data: { examId: "exam" } });
  expect(res.saved).toBe(false);
  expect(res.message).toContain("বদলেছে");
});
it("treats invalid upstream JSON and HTTP authorization failure as errors", async () => {
  for (const response of [
    new Response("not json", { status: 200 }),
    new Response("{}", { status: 401 }),
  ]) {
    fetcher.mockResolvedValueOnce(response);
    expect((await querySvp("A1234567", "933301")).status).toBe("error");
  }
});
