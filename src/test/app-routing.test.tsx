import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { normalizeAppPath } from "@/lib/roles";
import { navigationForRoles } from "@/lib/navigation";
import { routeTree } from "@/routeTree.gen";

function createRouterAt(path: string) {
  return createRouter({
    routeTree,
    context: { queryClient: new QueryClient() },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
}

describe("App routing", () => {
  it("registers every page linked from every role menu", () => {
    const router = createRouterAt("/");
    for (const roles of [
      ["admin"],
      ["staff"],
      ["agent"],
      ["management"],
      ["service_provider"],
      ["management", "agent"],
    ]) {
      for (const link of navigationForRoles(roles)) {
        const matches = router.matchRoutes(link.to);
        expect(normalizeAppPath(matches.at(-1)?.pathname ?? "")).toBe(link.to);
        expect(matches).toHaveLength(link.to === "/result-check" ? 2 : 3);
      }
    }
  });
  it("matches the index route", () => {
    const router = createRouterAt("/");

    expect(router.matchRoutes("/").map((match) => match.routeId)).toContain("/");
  });

  it("uses the root not-found boundary for an unknown route", () => {
    const router = createRouterAt("/this-route-does-not-exist");
    const matches = router.matchRoutes("/this-route-does-not-exist");

    expect(matches.map((match) => match.routeId)).toEqual(["__root__"]);
    expect(routeTree.options.notFoundComponent).toBeDefined();
  });
});
