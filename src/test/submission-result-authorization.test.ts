// @vitest-environment node
import { expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    const b = { middleware: () => b, inputValidator: () => b, handler: (fn: unknown) => fn };
    return b;
  },
}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
import { checkSubmissionSvp } from "@/lib/svp.functions";
const invoke = checkSubmissionSvp as unknown as (
  args: unknown,
) => Promise<{ status: string; message: string }>;
function fixture(roles: string[], status = "approved", owner = "me", active = true) {
  const select = vi.fn();
  const context = {
    userId: "me",
    supabase: {
      rpc: async () => ({ data: active, error: null }),
      from: (table: string) => {
        select(table);
        const response = {
          data:
            table === "user_roles"
              ? roles.map((role) => ({ role }))
              : table === "job_submissions"
                ? { id: "work", status, submitted_by: owner, occupation_id: null }
                : null,
          error: null,
        };
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => response,
          then: (resolve: (v: unknown) => void) => Promise.resolve(response).then(resolve),
        };
        return builder;
      },
    },
  };
  return { args: { context, data: { id: "work" } }, select };
}
it("denies customers, reception-only accounts and inactive providers before looking up work", async () => {
  for (const [roles, active] of [
    [[], true],
    [["management"], true],
    [["service_provider"], false],
  ] as [string[], boolean][]) {
    const f = fixture(roles, "approved", "me", active);
    expect((await invoke(f.args)).message).toBe("অনুমতি নেই");
    expect(f.select).not.toHaveBeenCalledWith("job_submissions");
  }
});
it("allows agents to check only their own approved work", async () => {
  for (const [status, owner] of [
    ["pending_approval", "me"],
    ["approved", "another"],
  ])
    expect((await invoke(fixture(["agent"], status, owner).args)).message).toBe("অনুমতি নেই");
  expect((await invoke(fixture(["agent"]).args)).message).toBe("পেশা নির্বাচন করা নেই");
});
it("allows staff work access and limits providers to approved work", async () => {
  expect((await invoke(fixture(["staff"], "pending_approval", "another").args)).message).toBe(
    "পেশা নির্বাচন করা নেই",
  );
  expect((await invoke(fixture(["service_provider"], "pending_approval").args)).message).toBe(
    "অনুমতি নেই",
  );
  expect((await invoke(fixture(["service_provider"], "approved", "another").args)).message).toBe(
    "পেশা নির্বাচন করা নেই",
  );
});
