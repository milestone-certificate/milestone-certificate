import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RspayDepositForm, RspayDepositRecords } from "@/components/app/RspayDeposits";

const api = vi.hoisted(() => ({
  availability: vi.fn(),
  start: vi.fn(),
  check: vi.fn(),
  records: vi.fn(),
  profiles: vi.fn(),
}));
vi.mock("@/lib/rspay.functions", () => ({
  getRspayAvailability: api.availability,
  startRspayDeposit: api.start,
  checkRspayDeposit: api.check,
}));
vi.mock("@/lib/data", () => ({
  rspayDepositsQ: (user: string, compact: boolean, page: number) => ({
    queryKey: ["rspay-records", user, compact, page],
    queryFn: api.records,
  }),
  walletPaymentProfilesQ: (user: string) => ({
    queryKey: ["profiles", user],
    queryFn: api.profiles,
  }),
}));
const id = "ff000000-0000-4000-8000-000000000001";
function mount(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    ...render(<QueryClientProvider client={client}>{element}</QueryClientProvider>),
    client,
  };
}
beforeEach(() => {
  window.history.replaceState({}, "", "/wallet");
  vi.clearAllMocks();
  api.availability.mockResolvedValue({ enabled: true });
  api.start.mockResolvedValue({ ok: false, message: "কিছুক্ষণ পরে চেষ্টা করুন।" });
  api.check.mockResolvedValue({
    id,
    amount: 500,
    method: "bkash",
    gateway_status: "PENDING",
    gateway_short_code: "CODE123",
    gateway_transaction_id: null,
  });
  api.records.mockResolvedValue([]);
  api.profiles.mockResolvedValue([]);
});
afterEach(cleanup);

it("offers the four documented methods and validates amount before starting checkout", async () => {
  mount(<RspayDepositForm userId="owner" />);
  const button = await screen.findByRole("button", { name: /পেমেন্ট করুন/ });
  await waitFor(() => expect(button).toBeEnabled());
  expect(screen.getAllByRole("radio").map((o) => (o as HTMLInputElement).value)).toEqual([
    "bkash",
    "nagad",
    "rocket",
    "upay",
  ]);
  fireEvent.change(screen.getByPlaceholderText("অন্য পরিমাণ লিখুন"), { target: { value: "0" } });
  fireEvent.click(button);
  expect(api.start).not.toHaveBeenCalled();
  expect(await screen.findByText(/সঠিক টাকার পরিমাণ/)).toBeInTheDocument();
});

it("keeps an intent ID across a retry so a lost response cannot create duplicate checkout links", async () => {
  mount(<RspayDepositForm userId="owner" />);
  const button = await screen.findByRole("button", { name: /পেমেন্ট করুন/ });
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.change(screen.getByPlaceholderText("অন্য পরিমাণ লিখুন"), {
    target: { value: "500.25" },
  });
  fireEvent.click(screen.getByRole("radio", { name: /UPAY/ }));
  fireEvent.click(button);
  await screen.findByText("কিছুক্ষণ পরে চেষ্টা করুন।");
  fireEvent.click(button);
  await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2));
  expect(api.start.mock.calls[0][0]).toEqual(api.start.mock.calls[1][0]);
  expect(api.start.mock.calls[0][0].data).toMatchObject({ amount: 500.25, method: "upay" });
});

it("does not treat a browser success query parameter as payment confirmation", async () => {
  window.history.replaceState({}, "", "/wallet?status=COMPLETED&amount=500");
  mount(<RspayDepositForm userId="owner" />);
  await screen.findByText("অনলাইন ডিপোজিট");
  expect(api.check).not.toHaveBeenCalled();
  expect(screen.queryByText("ব্যালেন্স যোগ হয়েছে")).not.toBeInTheDocument();
});

it("reads the real return status and refreshes wallet queries only when the database confirms completion", async () => {
  window.history.replaceState({}, "", `/wallet?payment=${id}&status=COMPLETED`);
  const { client } = mount(<RspayDepositForm userId="owner" />);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  await screen.findByText("পেমেন্ট অপেক্ষমাণ");
  expect(invalidate).not.toHaveBeenCalled();
  api.check.mockResolvedValue({
    id,
    amount: 500,
    method: "bkash",
    gateway_status: "COMPLETED",
    gateway_short_code: "CODE123",
    gateway_transaction_id: "TRX123",
  });
  fireEvent.click(screen.getByRole("button", { name: "অবস্থা দেখুন" }));
  await screen.findByText("ব্যালেন্স যোগ হয়েছে");
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["wallet-balance"] });
  expect(screen.getByText(/TRX123/)).toBeInTheDocument();
});

it("shows the deposit design but prevents checkout while online payments are disabled", async () => {
  api.availability.mockResolvedValue({ enabled: false });
  mount(<RspayDepositForm userId="owner" />);
  await waitFor(() => expect(api.availability).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: /পেমেন্ট করুন/ })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "500" }));
  fireEvent.submit(screen.getByRole("button", { name: /পেমেন্ট করুন/ }).closest("form")!);
  expect(api.start).not.toHaveBeenCalled();
});

it("shows customer, amount, method, code, transaction and status in the admin/owner record", async () => {
  api.records.mockResolvedValue([
    {
      id,
      user_id: "owner",
      amount: 500,
      method: "nagad",
      gateway_status: "COMPLETED",
      gateway_short_code: "CODE123",
      gateway_transaction_id: "TRX123",
      created_at: "2026-11-08T10:00:00Z",
    },
  ]);
  api.profiles.mockResolvedValue([
    { id: "owner", full_name: "Test Agent", email: "agent@example.com" },
  ]);
  mount(<RspayDepositRecords userId="staff" />);
  await screen.findByText("Test Agent");
  expect(screen.getByText(/৳500 · nagad/)).toBeInTheDocument();
  expect(screen.getByText(/CODE123 · TrxID: TRX123/)).toBeInTheDocument();
  expect(screen.getByText("ব্যালেন্স যোগ হয়েছে")).toBeInTheDocument();
});
