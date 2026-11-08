// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), query: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { rpc: mocks.rpc } }));
vi.mock("@/lib/svp.functions", () => ({ querySvp: mocks.query }));
import { runSvpAutoResults } from "@/lib/svp-result-automation.server";
const claim = {
  examId: "ff000000-0000-4000-8000-000000000001",
  leaseToken: "ff000000-0000-4000-8000-000000000002",
  passport: "A1234567",
  occupationKey: "933301",
  examDate: "2026-11-09",
  snapshot: {
    candidate_id: "ff000000-0000-4000-8000-000000000003",
    passport: "A1234567",
    occupation_id: "trade",
    resolved_occupation_id: "trade",
    occupation_key: "933301",
    exam_date: "2026-11-09",
    exam_time: "09:00",
    auto_lease_token: "ff000000-0000-4000-8000-000000000002",
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  let claimed = false;
  mocks.rpc.mockImplementation((name: string) => ({
    abortSignal: () =>
      Promise.resolve({
        error: null,
        data:
          name === "claim_svp_auto_result_checks"
            ? claimed
              ? []
              : ((claimed = true), [claim])
            : { ok: true },
      }),
  }));
  mocks.query.mockResolvedValue({ status: "found", result: "PASS", examDate: "2026-11-09" });
});
describe("server automatic SVP results", () => {
  it("saves only the exact attempt, passes its lease and exposes no applicant data", async () => {
    const result = await runSvpAutoResults();
    expect(result).toMatchObject({ checked: 1, saved: 1, errors: 0 });
    expect(mocks.query).toHaveBeenCalledWith("A1234567", "933301", { tries: 1, timeoutMs: 8000 });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "apply_verified_svp_exam_result",
      expect.objectContaining({ _snapshot: claim.snapshot }),
    );
    expect(JSON.stringify(result)).not.toContain("A1234567");
  });
  it.each([
    [{ status: "found", result: "FAIL", examDate: "2026-11-04" }, "other_date"],
    [{ status: "found", result: "PENDING", examDate: "2026-11-09" }, "pending"],
    [{ status: "not_found" }, "not_found"],
    [{ status: "error", message: "offline" }, "provider_error"],
  ])("keeps non-final/mismatched/unavailable responses unsaved", async (response, outcome) => {
    mocks.query.mockResolvedValue(response);
    expect((await runSvpAutoResults()).saved).toBe(0);
    expect(mocks.rpc.mock.calls.some(([name]) => name === "apply_verified_svp_exam_result")).toBe(
      false,
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      "finish_svp_auto_result_check",
      expect.objectContaining({ _outcome: outcome }),
    );
  });
  it("finishes a failed lookup and records an error without exposing the upstream exception", async () => {
    mocks.query.mockRejectedValue(new Error("private provider failure"));
    expect(await runSvpAutoResults()).toMatchObject({ checked: 1, saved: 0, errors: 1 });
    expect(mocks.rpc).toHaveBeenCalledWith("record_svp_auto_result_run", {
      _checked: 1,
      _saved: 0,
      _errors: 1,
    });
  });
});
