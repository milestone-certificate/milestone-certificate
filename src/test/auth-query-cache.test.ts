import { QueryClient } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { createAuthCacheHandler } from "@/lib/auth-query-cache";
it("clears private data and cancels old requests when identity changes", async () => {
  const qc = new QueryClient();
  const invalidate = vi.fn(),
    reset = vi.fn();
  const handler = createAuthCacheHandler(qc, invalidate, reset);
  handler("INITIAL_SESSION", { user: { id: "one" } });
  qc.setQueryData(["works"], ["PRIVATE"]);
  let finish!: (value: string) => void;
  const pending = qc
    .fetchQuery({
      queryKey: ["portal"],
      queryFn: () =>
        new Promise<string>((r) => {
          finish = r;
        }),
    })
    .catch(() => null);
  handler("SIGNED_IN", { user: { id: "two" } });
  expect(qc.getQueryData(["works"])).toBeUndefined();
  finish("OLD PRIVATE");
  await pending;
  expect(qc.getQueryData(["portal"])).toBeUndefined();
  expect(reset).toHaveBeenCalledOnce();
  expect(invalidate).toHaveBeenCalledOnce();
});
it("keeps same-user token refresh cache but clears on signout", () => {
  const qc = new QueryClient();
  const handler = createAuthCacheHandler(qc, vi.fn(), vi.fn());
  handler("INITIAL_SESSION", { user: { id: "one" } });
  qc.setQueryData(["works"], ["OWN"]);
  handler("TOKEN_REFRESHED", { user: { id: "one" } });
  expect(qc.getQueryData(["works"])).toEqual(["OWN"]);
  handler("SIGNED_OUT", null);
  expect(qc.getQueryData(["works"])).toBeUndefined();
});
