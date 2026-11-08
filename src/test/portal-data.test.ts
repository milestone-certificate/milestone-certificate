import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
const fixture = vi.hoisted(() => ({
  candidate: { id: "candidate-one" },
  error: null as unknown,
  calls: [] as unknown[][],
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const response = {
        data: table === "candidates" ? fixture.candidate : [],
        error: fixture.error,
      };
      let one = table === "candidates";
      const b = {
        select: () => b,
        order: () => b,
        limit: () => b,
        eq: (...args: unknown[]) => {
          fixture.calls.push([table, ...args]);
          return b;
        },
        maybeSingle: () => {
          one = true;
          return b;
        },
        then: (resolve: (v: unknown) => void) =>
          Promise.resolve({
            ...response,
            data: one && table === "settings" ? null : response.data,
          }).then(resolve),
      };
      return b;
    },
    rpc: async () => ({ data: {}, error: null }),
  },
}));
import { portalQ } from "@/lib/data";
beforeEach(() => {
  fixture.candidate = { id: "candidate-one" };
  fixture.error = null;
  fixture.calls = [];
});
it("keys customer data by identity and filters exams/payments to the chosen candidate", async () => {
  const qc = new QueryClient();
  expect(portalQ("one").queryKey).not.toEqual(portalQ("two").queryKey);
  const result = await qc.fetchQuery(portalQ("one"));
  expect(fixture.calls).toContainEqual(["exams", "candidate_id", "candidate-one"]);
  expect(fixture.calls).toContainEqual(["payments", "candidate_id", "candidate-one"]);
  expect(result.agent).toBeNull();
});
it("does not report a database outage as an empty successful customer portal", async () => {
  fixture.error = { message: "outage" };
  await expect(new QueryClient().fetchQuery({ ...portalQ("one"), retry: false })).rejects.toThrow(
    "লোড করা",
  );
});
