import type { AuthChangeEvent } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";

/** A different signed-in identity must never inherit the previous user's RLS
 * data from the browser cache. Keep this callback synchronous: Supabase holds
 * its auth lock while notifying subscribers. */
export function createAuthCacheHandler(
  client: QueryClient,
  invalidateRoutes: () => void,
  resetDeviceCache: () => void,
) {
  let identity: string | null | undefined;
  return (event: AuthChangeEvent, session: { user: { id: string } } | null) => {
    const next = session?.user.id ?? null;
    const changed =
      (identity !== undefined && identity !== next) || (event === "SIGNED_IN" && identity !== next);
    identity = next;
    if (changed || event === "SIGNED_OUT") {
      client.clear();
      resetDeviceCache();
    }
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
      invalidateRoutes();
      if (!changed && event === "USER_UPDATED") void client.invalidateQueries();
    }
  };
}
