import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { paymentAmount, rspayControlName, rspayMethods } from "@/lib/rspay";

export const getRspayAvailability = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    try {
      const { rspayGatewayAvailability } = await import("@/lib/rspay.server");
      return await rspayGatewayAvailability();
    } catch {
      return { enabled: false, methods: [] };
    }
  });

export const getAdminRspayRuntime = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const role = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (role.error || !role.data) throw new Error("Admin access required");
    const { rspayRuntimeState } = await import("@/lib/rspay.server");
    return rspayRuntimeState();
  });

export const setAdminRspayControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ control: rspayControlName, enabled: z.boolean() }).strict().parse(input),
  )
  .handler(async ({ context, data }) => {
    const role = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (role.error || !role.data)
      return { ok: false, message: "শুধু admin এই সেটিংস বদলাতে পারবেন।" };
    if (data.control === "enabled" && data.enabled) {
      const { rspayRuntimeState } = await import("@/lib/rspay.server");
      const runtime = await rspayRuntimeState();
      if (!runtime.serverEnabled || !runtime.configured || !runtime.storageReady)
        return { ok: false, message: "Server setup সম্পূর্ণ না হওয়ায় gateway চালু করা যাচ্ছে না।" };
    }
    const { error } = await context.supabase.rpc("set_rspay_gateway_control", {
      _control: data.control,
      _enabled: data.enabled,
    });
    return error
      ? { ok: false, message: "Gateway settings সংরক্ষণ হয়নি। আবার চেষ্টা করুন।" }
      : { ok: true, message: "Gateway settings সংরক্ষিত হয়েছে।" };
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
