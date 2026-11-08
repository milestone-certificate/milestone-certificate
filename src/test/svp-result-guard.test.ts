import { expect, it, vi } from "vitest";
import {
  matchingPendingSvpExams,
  svpResultDate,
  svpResultSaveIssue,
} from "@/lib/svp-result.shared";
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = { middleware: () => b, inputValidator: () => b, handler: (f: unknown) => f };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
import { svpUpdate } from "@/lib/svp.functions";
it("keeps the real older failed attempt from settling a later pending exam", () => {
  const result = { result: "FAIL" as const, examDate: "2026-11-04" };
  expect(svpResultSaveIssue(result, "2026-11-25")).toContain("অন্য পরীক্ষার");
  expect(
    svpUpdate(
      { status: "found", ...result, applicantName: null, occupation: null },
      "2026-11-25T03:00:00Z",
      "PENDING",
    ),
  ).toMatchObject({ svp_result: "NOT_FOUND", svp_old_result: "FAIL" });
});
it("requires the exact date and never downgrades a declared result on a pending reply", () => {
  expect(svpResultSaveIssue({ result: "PASS", examDate: "2026-11-08" }, "2026-11-08")).toBeNull();
  expect(
    svpResultSaveIssue({ result: "PASS", examDate: "2026-11-09" }, "2026-11-08"),
  ).not.toBeNull();
  expect(svpResultSaveIssue({ result: "PASS", examDate: null }, "2026-11-08")).not.toBeNull();
  expect(
    svpUpdate(
      { status: "found", result: "PENDING", examDate: null, applicantName: null, occupation: null },
      "2026-11-08T03:00:00Z",
      "PASS",
    ),
  ).toMatchObject({ svp_result: "PASS" });
});
it("matches the candidate, exact occupation code and attempt date together", () => {
  const candidate = { id: "person", occupation_id: "load" };
  const occupations = [
    { id: "load", svp_key: "933301" },
    { id: "driver", svp_key: "832201" },
  ];
  const exams = [
    {
      id: "wrong-trade",
      candidate_id: "person",
      occupation_id: "driver",
      exam_date: "2026-11-08",
      result: "PENDING",
    },
    {
      id: "retake",
      candidate_id: "person",
      occupation_id: "load",
      exam_date: "2026-11-25",
      result: "PENDING",
    },
    {
      id: "match",
      candidate_id: "person",
      occupation_id: "load",
      exam_date: "2026-11-08",
      result: "PENDING",
    },
    {
      id: "other",
      candidate_id: "other",
      occupation_id: "load",
      exam_date: "2026-11-08",
      result: "PENDING",
    },
  ];
  expect(
    matchingPendingSvpExams(exams, candidate, occupations, "933301", "2026-11-08").map((e) => e.id),
  ).toEqual(["match"]);
});
it("rejects malformed dates rather than silently rolling them into another day", () => {
  expect(svpResultDate("2026-02-31")).toBeNull();
  expect(svpResultDate("08/11/2026")).toBeNull();
  expect(svpResultDate("2026-11-08T10:00:00Z")).toBe("2026-11-08");
});
