import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { takamolLookupSchema, type TakamolLookupResult } from "@/lib/takamol-availability.shared";
import { fetchTakamolAvailability } from "@/lib/takamol-availability.server";

export const lookupTakamolAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => takamolLookupSchema.parse(input))
  .handler(async ({ data, context }): Promise<TakamolLookupResult> => {
    try {
      const { data: roles, error } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", context.userId);
      if (error) {
        return {
          success: false,
          status: 503,
          message: "Authorized role lookup is not available on the server.",
        };
      }
      if (!roles?.some(({ role }) => role === "admin" || role === "staff" || role === "agent")) {
        return {
          success: false,
          status: 403,
          message: "Only authorized admin, staff, or agent users may use this lookup.",
        };
      }
    } catch {
      return {
        success: false,
        status: 503,
        message: "Authorized role lookup is not available on the server.",
      };
    }

    return fetchTakamolAvailability(data);
  });
