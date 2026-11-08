import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const reader = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ticket-reader.client", () => ({ readAppointment: reader }));
vi.mock("@tanstack/react-start", () => ({ createClientOnlyFn: (fn: unknown) => fn }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: "/submit-job" }, status: "idle" }),
}));
vi.mock("@/components/app/AgentNotice", () => ({
  useMyUnpaid: () => false,
  UnpaidNotice: () => null,
}));
vi.mock("@/components/app/PassportHistory", () => ({
  PassportHistory: () => null,
  passportHistoryQ: () => ({ queryKey: ["history"], queryFn: async () => [] }),
}));
import { Route } from "@/routes/_authenticated/submit-job";
import { parseAppointmentText } from "@/lib/ticket-extraction";
const trade = "ff000000-0000-4000-8000-000000000020",
  center = "ff000000-0000-4000-8000-000000000021";
const sample = `Candidate Name: JOHN SAMPLE\nPassport Number: A1234567\nOccupation: Load and Unload Worker\nExam Date: 29 Nov 2026\nExam Time: 09:15 AM\nTest Center: Cumilla Technical Training Centre\nMobile Number: 01777777774`;
const clients: QueryClient[] = [];
beforeEach(() => {
  reader.mockReset();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  cleanup();
  clients.forEach((q) => q.clear());
  clients.length = 0;
});
function setup(catalog = true) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(qc);
  qc.setQueryData(
    ["occ"],
    catalog ? [{ id: trade, name: "Load and Unload Worker", active: true }] : [],
  );
  qc.setQueryData(
    ["ttc"],
    catalog
      ? [{ id: center, name: "Cumilla Technical Training Centre", active: true, sort_order: null }]
      : [],
  );
  const Page = Route.options.component!;
  render(
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>,
  );
  return qc;
}
function upload(name = "ticket.pdf") {
  const file = new File(["%PDF-1.7 TEST"], name, { type: "application/pdf" });
  fireEvent.change(screen.getByLabelText("Appointment PDF বা ছবি"), { target: { files: [file] } });
  return file;
}
it("fills printed identity, mobile and a non-preset time, and includes centres whose sort order is unset", async () => {
  reader.mockImplementation(async (file: File) => ({
    file,
    extraction: parseAppointmentText(sample),
  }));
  setup();
  upload();
  await waitFor(() => expect(screen.getByLabelText("Candidate Name")).toHaveValue("JOHN SAMPLE"));
  expect(screen.getByLabelText("Passport Number")).toHaveValue("A1234567");
  expect(screen.getByLabelText("Mobile Number")).toHaveValue("01777777774");
  expect(screen.getByLabelText("Exam Time")).toHaveValue("09:15");
  expect(screen.getByLabelText("TTC")).toHaveValue(center);
  expect(screen.getByLabelText("Candidate Name")).toBeEnabled();
  expect(screen.getByText("9:15 AM · সকাল")).toBeInTheDocument();
});
it("allows manual completion after OCR fails and does not expose raw engine errors", async () => {
  reader.mockRejectedValue(new Error("SECRET_ENGINE_URL /private/config"));
  setup();
  upload();
  await screen.findByText(
    "টিকিট স্বয়ংক্রিয়ভাবে পড়া যায়নি। নিচের তথ্য নিজে পূরণ করুন অথবা অন্য ফাইল দিন।",
  );
  expect(screen.getByLabelText("Candidate Name")).toBeEnabled();
  expect(screen.queryByText(/SECRET_ENGINE_URL/)).not.toBeInTheDocument();
});
it("finishes catalogue matching when reference lists arrive after extraction", async () => {
  reader.mockImplementation(async (file: File) => ({
    file,
    extraction: parseAppointmentText(sample),
  }));
  const qc = setup(false);
  upload();
  await waitFor(() => expect(screen.getByLabelText("Candidate Name")).toHaveValue("JOHN SAMPLE"));
  qc.setQueryData(["occ"], [{ id: trade, name: "Load and Unload Worker", active: true }]);
  qc.setQueryData(
    ["ttc"],
    [{ id: center, name: "Cumilla Technical Training Centre", active: true, sort_order: null }],
  );
  await waitFor(() => expect(screen.getByLabelText("TTC")).toHaveValue(center));
});
it("ignores an old file result after another file is selected", async () => {
  let finish!: (x: unknown) => void;
  reader
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockImplementationOnce(async (file: File) => ({
      file,
      extraction: parseAppointmentText(sample.replace("JOHN SAMPLE", "SECOND PERSON")),
    }));
  setup();
  const old = upload("old.pdf");
  await waitFor(() => expect(reader).toHaveBeenCalledTimes(1));
  upload("new.pdf");
  await waitFor(() => expect(screen.getByLabelText("Candidate Name")).toHaveValue("SECOND PERSON"));
  finish({ file: old, extraction: parseAppointmentText(sample) });
  await Promise.resolve();
  expect(screen.getByLabelText("Candidate Name")).toHaveValue("SECOND PERSON");
});
it("does not combine several candidates into an automatically completed form", async () => {
  reader.mockImplementation(async (file: File) => ({
    file,
    extraction: parseAppointmentText(sample + "\nPassport No: A7654321"),
  }));
  setup();
  upload();
  await screen.findByText(/টিকিটে একাধিক পরীক্ষার্থী আছে/);
  expect(screen.getByLabelText("Candidate Name")).toHaveValue("");
  expect(screen.getByLabelText("Candidate Name")).toBeEnabled();
});

it("keeps the form locked for an invalid file rather than treating it as a manual ticket", async () => {
  reader.mockRejectedValue(new Error("সঠিক PDF, JPG, PNG বা WEBP ফাইল দিন।"));
  setup();
  upload();
  await screen.findByText("সঠিক PDF, JPG, PNG বা WEBP ফাইল দিন।");
  expect(screen.getByLabelText("Candidate Name")).toBeDisabled();
});
