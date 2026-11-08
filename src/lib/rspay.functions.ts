import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { paymentAmount, rspayMethods } from "@/lib/rspay";

export const getRspayAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      if (process.env["RSPAY_AUTO_DEPOSIT_ENABLED"] !== "true") return { enabled: false };
      const { rspayConfig } = await import("@/lib/rspay.server");
      rspayConfig();
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin
        .from("wallet_rspay_orders")
        .select("deposit_id", { head: true })
        .limit(1);
      return { enabled: !error };
    } catch {
      return { enabled: false };
    }
  });

export const startRspayDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ requestId: z.string().uuid(), amount: paymentAmount, method: z.enum(rspayMethods) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    if (process.env["RSPAY_AUTO_DEPOSIT_ENABLED"] !== "true")
      return { ok: false as const, message: "পেমেন্ট সেবা এখন চালু নেই।" };
    const [roles, active] = await Promise.all([
      context.supabase.from("user_roles").select("role").eq("user_id", context.userId),
      context.supabase.rpc("is_active_account", { _user_id: context.userId }),
    ]);
    const names = (roles.data ?? []).map((r) => r.role);
    const manager = names.includes("admin") || names.includes("staff");
    if (
      roles.error ||
      (!manager && (!names.includes("agent") || active.error || active.data !== true))
    )
      return { ok: false as const, message: "এই অ্যাকাউন্টে ডিপোজিটের অনুমতি নেই।" };
    const { createRspayDeposit } = await import("@/lib/rspay.server");
    const { data: user } = await context.supabase.auth.getUser();
    if (!user.user) return { ok: false as const, message: "আবার লগইন করুন।" };
    try {
      return await createRspayDeposit(
        context.userId,
        user.user.email || user.user.phone || context.userId,
        data,
      );
    } catch {
      return { ok: false as const, message: "পেমেন্ট সেবা এখন চালু নেই।" };
    }
  });

export const checkRspayDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // The owner is enforced both before server verification and by the final RLS read.
    const { reconcileRspayDeposit } = await import("@/lib/rspay.server");
    await reconcileRspayDeposit(data.id, context.userId);
    const { data: deposit } = await context.supabase
      .from("wallet_deposits")
      .select("id, amount, method, gateway_status, gateway_short_code, gateway_transaction_id")
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("provider", "rspay")
      .maybeSingle();
    return deposit;
  });
