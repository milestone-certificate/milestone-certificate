import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminRspayGateway } from "@/components/app/AdminRspayGateway";

const api = vi.hoisted(() => ({
  runtime: vi.fn(),
  save: vi.fn(),
  config: {
    id: 1,
    enabled: false,
    bkash: true,
    nagad: true,
    rocket: true,
    upay: true,
    updated_at: "2026-11-08T12:00:00Z",
    updated_by: null,
  },
}));
vi.mock("@/lib/rspay.functions", () => ({
  getAdminRspayRuntime: api.runtime,
  setAdminRspayControl: api.save,
}));
vi.mock("@/lib/data", () => ({
  rspayGatewaySettingsQ: (user: string) => ({
    queryKey: ["rspay-admin-settings", user],
    queryFn: async () => api.config,
  }),
  rspayGatewayAuditQ: (user: string) => ({
    queryKey: ["rspay-admin-audit", user],
    queryFn: async () => [],
  }),
}));
beforeEach(() => {
  api.config = {
    ...api.config,
    enabled: false,
    bkash: true,
    nagad: true,
    rocket: true,
    upay: true,
  };
  api.runtime
    .mockReset()
    .mockResolvedValue({ serverEnabled: true, configured: true, storageReady: true });
  api.save
    .mockReset()
    .mockImplementation(async ({ data }: { data: { control: string; enabled: boolean } }) => {
      api.config = { ...api.config, [data.control]: data.enabled };
      return { ok: true, message: "Gateway settings সংরক্ষিত হয়েছে।" };
    });
});
afterEach(cleanup);
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AdminRspayGateway userId="admin" />
    </QueryClientProvider>,
  );
  return client;
}
it("lets the administrator toggle the master and individual methods independently", async () => {
  mount();
  const master = await screen.findByRole("switch", { name: "RSPay gateway" });
  await waitFor(() => expect(master).toBeEnabled());
  fireEvent.click(master);
  await waitFor(() => expect(master).toBeChecked());
  const bkash = screen.getByRole("switch", { name: "bKash payment method" });
  await waitFor(() => expect(bkash).toBeEnabled());
  fireEvent.click(bkash);
  await waitFor(() => expect(bkash).not.toBeChecked());
  expect(screen.getByRole("switch", { name: "Nagad payment method" })).toBeChecked();
  expect(api.save).toHaveBeenLastCalledWith({ data: { control: "bkash", enabled: false } });
});
it("keeps activation locked while allowing method preparation when the server is disabled", async () => {
  api.runtime.mockResolvedValue({ serverEnabled: false, configured: true, storageReady: true });
  mount();
  const nagad = await screen.findByRole("switch", { name: "Nagad payment method" });
  await waitFor(() => expect(nagad).toBeEnabled());
  expect(screen.getByRole("switch", { name: "RSPay gateway" })).toBeDisabled();
  fireEvent.click(nagad);
  await waitFor(() => expect(nagad).not.toBeChecked());
});
it("does not display an unsaved setting after a failed change", async () => {
  api.save.mockResolvedValue({ ok: false, message: "সংরক্ষণ হয়নি।" });
  mount();
  const rocket = await screen.findByRole("switch", { name: "Rocket payment method" });
  await waitFor(() => expect(rocket).toBeEnabled());
  fireEvent.click(rocket);
  await screen.findByText("সংরক্ষণ হয়নি।");
  expect(rocket).toBeChecked();
});
