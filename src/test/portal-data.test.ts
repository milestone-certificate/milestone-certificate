import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
const api = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: api }));
import { portalQ } from "@/lib/data";
beforeEach(() => {
  vi.clearAllMocks();
  api.rpc.mockResolvedValue({
    data: { candidate: { id: "own" }, exams: [], payments: [], occ: {}, ttc: {}, instructions: "" },
    error: null,
  });
});
it("keys data by identity and uses only the own-customer projection without a caller-selected user ID", async () => {
  expect(portalQ("one").queryKey).not.toEqual(portalQ("two").queryKey);
  const result = await new QueryClient().fetchQuery(portalQ("one"));
  expect(api.rpc).toHaveBeenCalledWith("get_customer_portal");
  expect(api.from).not.toHaveBeenCalled();
  expect(result).not.toHaveProperty("agent");
});
it("reports outages instead of a successful empty portal", async () => {
  api.rpc.mockResolvedValue({ data: null, error: { message: "outage" } });
  await expect(new QueryClient().fetchQuery({ ...portalQ("one"), retry: false })).rejects.toThrow(
    "লোড করা",
  );
});
