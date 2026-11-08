import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { readBoundedJson } from "@/lib/bounded-json";
import { rspayControlsSchema, rspayEventSchema, rspayMethods, type RspayEvent } from "@/lib/rspay";

export const hashCapability = (value: string) => createHash("sha256").update(value).digest("hex");

export async function readRspayGatewayControls() {
  const { data, error } = await supabaseAdmin
    .from("rspay_gateway_settings")
    .select("enabled,bkash,nagad,rocket,upay")
    .eq("id", 1)
    .maybeSingle();
  const parsed = rspayControlsSchema.safeParse(data);
  return !error && parsed.success ? parsed.data : null;
}

export async function rspayRuntimeState() {
  const serverEnabled = process.env["RSPAY_AUTO_DEPOSIT_ENABLED"] === "true";
  let configured = false;
  let storageReady = false;
  try {
    rspayConfig();
    configured = true;
  } catch {
    /* Server settings are private. */
  }
  try {
    const { error } = await supabaseAdmin
      .from("wallet_rspay_orders")
      .select("deposit_id", { head: true })
      .limit(1);
    storageReady = !error;
  } catch {
    /* Report readiness only, never raw credential errors. */
  }
  return { serverEnabled, configured, storageReady };
}

export async function rspayGatewayAvailability() {
  const controls = await readRspayGatewayControls();
  const methods = controls ? rspayMethods.filter((method) => controls[method]) : [];
  if (!controls?.enabled || !methods.length || process.env["RSPAY_AUTO_DEPOSIT_ENABLED"] !== "true")
    return { enabled: false, methods };
  const runtime = await rspayRuntimeState();
  return { enabled: runtime.serverEnabled && runtime.configured && runtime.storageReady, methods };
}

export function rspayConfig() {
  const api = new URL(process.env["RSPAY_API_BASE_URL"] || "https://api.rspay.org/api");
  const site = new URL(process.env["RSPAY_SITE_URL"] || "");
  const key = process.env["RSPAY_API_KEY"];
  // Never follow an upstream redirect with a merchant credential.
  if (
    !key ||
    api.protocol !== "https:" ||
    site.protocol !== "https:" ||
    api.username ||
    api.password ||
    site.username ||
    site.password
  ) {
    throw new Error("RSPay is not configured");
  }
  return { api: api.href.replace(/\/$/, ""), site: site.origin, key };
}

export function safeCheckoutUrl(value: string, shortCode: string): string {
  const url = new URL(value);
  const hosts = (process.env["RSPAY_CHECKOUT_HOSTS"] || "pay.rspay.org")
    .split(",")
    .map((h) => h.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    !hosts.includes(url.hostname) ||
    url.pathname !== `/payment/${shortCode}` ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid checkout URL");
  return url.href;
}

/** Callback URLs act as per-order shared secrets because this API documents no
 * signature. Before exposing a checkout, check the provider's public info API:
 * it must identify this amount/method and must not disclose the capability.
 * A provider that publishes callback URLs is not eligible for this auth mode.
 */
export async function checkCallbackPrivacy(
  code: string,
  token: string,
  amount: number,
  method: string,
): Promise<boolean> {
  const { api } = rspayConfig();
  try {
    const response = await fetch(`${api}/gateway/info/${encodeURIComponent(code)}`, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    const body = await readBoundedJson(response, 32_768);
    const parsed = z
      .object({ success: z.literal(true), amount: z.coerce.number(), method: z.string() })
      .safeParse(body);
    return (
      response.ok &&
      parsed.success &&
      parsed.data.amount === amount &&
      parsed.data.method === method &&
      !JSON.stringify(body).toLowerCase().includes(token.toLowerCase())
    );
  } catch {
    return false;
  }
}

/** This intentionally requires a full independent provider record. An error,
 * unknown response shape, callback-supplied claim or browser redirect cannot credit a wallet.
 * Optional recovery path when a provider returns its full payment record. The
 * primary documented integration authenticates callbacks with private capabilities.
 */
export async function verifyRspayPayment(shortCode: string): Promise<RspayEvent | null> {
  const { api } = rspayConfig();
  const template = process.env["RSPAY_STATUS_URL_TEMPLATE"];
  const url = template
    ? new URL(template.replace("{short_code}", encodeURIComponent(shortCode)))
    : new URL(`${api}/gateway/info/${encodeURIComponent(shortCode)}`);
  // Keep verification on the configured provider origin, never a webhook-supplied URL.
  if (
    url.protocol !== "https:" ||
    url.origin !== new URL(api).origin ||
    url.username ||
    url.password
  )
    return null;
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    const body = await readBoundedJson(response, 32_768);
    const envelope = z
      .object({ success: z.literal(true), data: z.unknown().optional() })
      .passthrough()
      .safeParse(body);
    if (!response.ok || !envelope.success) return null;
    const parsed = rspayEventSchema.safeParse(envelope.data.data ?? body);
    return parsed.success && parsed.data.short_code === shortCode ? parsed.data : null;
  } catch {
    return null;
  }
}

async function applyEvent(id: string, hash: string, event: RspayEvent, verified: boolean) {
  const { data, error } = await supabaseAdmin.rpc("wallet_rspay_event", {
    _deposit_id: id,
    _callback_hash: hash,
    _event: event,
    _verified: verified,
  });
  if (error) throw new Error("Payment update unavailable");
  return z
    .object({ ok: z.boolean(), status: z.string().optional(), reason: z.string().optional() })
    .parse(data);
}

export async function createRspayDeposit(
  userId: string,
  identity: string,
  input: { requestId: string; amount: number; method: string },
) {
  // Re-read controls for every request. A stale browser or a crafted POST
  // cannot create a checkout after the administrator disables its method.
  if (process.env["RSPAY_AUTO_DEPOSIT_ENABLED"] !== "true")
    return { ok: false as const, message: "পেমেন্ট সেবা এখন চালু নেই।" };
  const controls = await readRspayGatewayControls();
  if (
    !controls?.enabled ||
    !rspayMethods.some((method) => method === input.method && controls[method])
  )
    return { ok: false as const, message: "এই পেমেন্ট মাধ্যম এখন বন্ধ আছে।" };
  const config = rspayConfig();
  const token = randomBytes(32).toString("hex");
  const { data, error } = await supabaseAdmin.rpc("wallet_rspay_begin", {
    _user_id: userId,
    _request_id: input.requestId,
    _amount: input.amount,
    _method: input.method,
    _identity: identity,
    _callback_hash: hashCapability(token),
  });
  if (error)
    return { ok: false as const, message: "ডিপোজিট শুরু করা যাচ্ছে না। কিছুক্ষণ পরে চেষ্টা করুন।" };
  const order = z
    .object({
      id: z.string().uuid(),
      created: z.boolean(),
      url: z.string().nullable().optional(),
      status: z.string(),
    })
    .parse(data);
  if (!order.created) {
    return {
      ok: true as const,
      id: order.id,
      url: order.status === "PENDING" && order.url ? order.url : null,
    };
  }
  const returnUrl = `${config.site}/wallet?payment=${order.id}`;
  const callback = `${config.site}/api/payments/rspay/${order.id}/${token}`;
  let accepted = false;
  try {
    const response = await fetch(`${config.api}/gateway/create-link`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: input.amount,
        method: input.method,
        user_identyfy_address: identity,
        domain: new URL(config.site).hostname,
        success_redirect_url: returnUrl,
        fail_redirect_url: returnUrl,
        pending_redirect_url: returnUrl,
        call_back_url: `${callback}/success`,
        pending_call_back: `${callback}/pending`,
        reject_call_back: `${callback}/reject`,
        checkout_items: { orderId: order.id },
      }),
    });
    const body = await readBoundedJson(response, 32_768);
    const parsed = z
      .object({
        success: z.literal(true),
        short_code: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        payment_page_url: z.string(),
      })
      .safeParse(body);
    if (!response.ok || !parsed.success) {
      // Fixed, useful message; do not expose raw provider response or echoed callback URLs.
      const offline = z.object({ message: z.string() }).safeParse(body);
      if (offline.success && /devices|disconnected|offline/i.test(offline.data.message)) {
        return {
          ok: false as const,
          id: order.id,
          message: "পেমেন্ট সেবা এখন বন্ধ আছে। কিছুক্ষণ পরে চেষ্টা করুন।",
        };
      }
      return {
        ok: false as const,
        id: order.id,
        message: "পেমেন্ট লিংক তৈরি হয়নি। কিছুক্ষণ পরে চেষ্টা করুন।",
      };
    }
    accepted = true;
    const url = safeCheckoutUrl(parsed.data.payment_page_url, parsed.data.short_code);
    const callbackPrivate = await checkCallbackPrivacy(
      parsed.data.short_code,
      token,
      input.amount,
      input.method,
    );
    const bound = await supabaseAdmin.rpc("wallet_rspay_bind", {
      _deposit_id: order.id,
      _short_code: parsed.data.short_code,
      _url: url,
      _callback_private: callbackPrivate,
    });
    if (bound.error) throw new Error("Could not save checkout");
    if (!callbackPrivate) {
      await supabaseAdmin.rpc("wallet_rspay_link_failed", { _deposit_id: order.id });
      return {
        ok: false as const,
        id: order.id,
        message: "নিরাপদ পেমেন্ট শুরু করা যাচ্ছে না। পরে চেষ্টা করুন।",
      };
    }
    // Return only the safe checkout URL. Provider request_data contains callback capabilities.
    return { ok: true as const, id: order.id, url };
  } catch {
    return {
      ok: false as const,
      id: order.id,
      message: "পেমেন্ট শুরু করা যায়নি। ডিপোজিটের অবস্থা দেখুন।",
    };
  } finally {
    // Keep an accepted but unbound payment for investigation; do not retry its POST.
    if (!accepted) await supabaseAdmin.rpc("wallet_rspay_link_failed", { _deposit_id: order.id });
  }
}

export async function processRspayCallback(
  id: string,
  token: string,
  eventName: string,
  body: unknown,
): Promise<number> {
  if (!z.string().uuid().safeParse(id).success || !/^[a-f0-9]{64}$/.test(token)) return 404;
  const event = rspayEventSchema.safeParse(body);
  const expected = { success: "COMPLETED", pending: "PENDING", reject: "FAILED" }[eventName];
  if (!event.success || !expected || event.data.status !== expected) return 400;
  const { data: order, error } = await supabaseAdmin
    .from("wallet_rspay_orders")
    .select("callback_hash, callback_private")
    .eq("deposit_id", id)
    .maybeSingle();
  if (error) return 503;
  const hash = hashCapability(token);
  if (!order || !timingSafeEqual(Buffer.from(hash), Buffer.from(order.callback_hash))) return 404;
  // Possession of the private, 256-bit per-order capability authenticates this
  // notification. Never accept a bare short_code or a browser's status query.
  const stored = await applyEvent(id, hash, event.data, order.callback_private);
  if (!stored.ok) return 409;
  if (order.callback_private) return 200;
  const verified = await verifyRspayPayment(event.data.short_code);
  if (!verified) return 503; // Encourage provider retry; no wallet credit on unverifiable claims.
  const result = await applyEvent(id, hash, verified, true);
  return result.ok ? 200 : 409;
}

export async function reconcileRspayDeposit(id: string, userId: string) {
  const { data: order } = await supabaseAdmin
    .from("wallet_rspay_orders")
    .select("short_code, callback_hash, callback_private, deferred_event, status, updated_at")
    .eq("deposit_id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!order || order.status === "COMPLETED" || order.status === "LINK_FAILED" || !order.short_code)
    return;
  const deferred = rspayEventSchema.safeParse(order.deferred_event);
  if (order.callback_private && deferred.success) {
    await applyEvent(id, order.callback_hash, deferred.data, true);
    return;
  }
  const verified = await verifyRspayPayment(order.short_code);
  if (verified) await applyEvent(id, order.callback_hash, verified, true);
}
