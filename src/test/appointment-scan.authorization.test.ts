// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = { middleware: () => b, inputValidator: () => b, handler: (fn: unknown) => fn };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
import { scanAppointment, verifyAppointment } from "@/lib/appointment-ocr.functions";
import { parseAppointmentText } from "@/lib/ticket-extraction";
const signed = vi.fn(),
  insert = vi.fn(),
  rpc = vi.fn();
const from = vi.fn((table: string) => {
  const b = {
    select: () => b,
    eq: () => b,
    maybeSingle: async () => ({
      data: {
        id: "work",
        ticket_path: "takamul/owner/ticket.pdf",
        passport_no: "A1234567",
        candidate_name: "JOHN SAMPLE",
        exam_at: "2026-11-23T03:00:00Z",
      },
      error: null,
    }),
    insert: (data: unknown) => {
      insert(data);
      return b;
    },
    single: async () => ({ data: { id: "scan", extracted: {} }, error: null }),
  };
  return b;
});
const context = {
  userId: "signed-admin",
  supabase: { rpc, from, storage: { from: () => ({ createSignedUrl: signed }) } },
};
const scan = scanAppointment as unknown as (args: unknown) => Promise<Record<string, unknown>>;
const verify = verifyAppointment as unknown as (args: unknown) => Promise<Record<string, unknown>>;
beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: true, error: null });
  signed.mockResolvedValue({ data: { signedUrl: "https://storage.test/private" }, error: null });
});
it("denies public or non-admin callers before any file access", async () => {
  rpc.mockResolvedValue({ data: false, error: null });
  await expect(scan({ context, data: { submissionId: "work" } })).rejects.toThrow("অ্যাডমিন");
  expect(from).not.toHaveBeenCalled();
  expect(signed).not.toHaveBeenCalled();
});
it("prepares a role-authorized private document without an AI service", async () => {
  const result = await scan({ context, data: { submissionId: "work" } });
  expect(result).toHaveProperty("document");
  expect(signed).toHaveBeenCalledWith("takamul/owner/ticket.pdf", 300);
  expect(insert).not.toHaveBeenCalled();
});
it("saves locally recognized data for review without prematurely changing the work", async () => {
  const extraction = parseAppointmentText(
    "Candidate Name: JOHN SAMPLE\nPassport No: A1234567\nExam Date: 23/11/2026\nExam Time: 09:00",
  );
  await scan({ context, data: { submissionId: "work", extraction } });
  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({
      submission_id: "work",
      created_by: "signed-admin",
      status: "needs_review",
    }),
  );
  expect(rpc).not.toHaveBeenCalledWith("verify_appointment_scan", expect.anything());
});
it("reports failure when the atomic verification does not succeed", async () => {
  rpc.mockImplementation(async (name: string) => ({ data: name === "has_role", error: null }));
  const result = await verify({
    context,
    data: {
      extractionId: "scan",
      examDate: "2026-11-23",
      examTime: "09:15",
      reportingTime: null,
      reason: "Ticket checked",
    },
  });
  expect(result).toHaveProperty("error");
});
