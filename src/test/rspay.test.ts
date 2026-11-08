// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
import {
  checkCallbackPrivacy,
  createRspayDeposit,
  hashCapability,
  processRspayCallback,
  safeCheckoutUrl,
  verifyRspayPayment,
} from "@/lib/rspay.server";
import { paymentAmount, rspayEventSchema } from "@/lib/rspay";

const id = "ff000000-0000-4000-8000-000000000001";
const event = {
  status: "COMPLETED",
  transaction_id: "REAL-TRX-123",
  short_code: "abc123",
  amount: 500,
  method: "bkash",
  user_identyfy_address: "test@example.com",
  checkout_items: { orderId: id },
};
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  vi.stubEnv("RSPAY_API_BASE_URL", "https://api.rspay.org/api");
  vi.stubEnv("RSPAY_SITE_URL", "https://portal.example");
  vi.stubEnv("RSPAY_API_KEY", "unit-test-key");
  vi.stubEnv("RSPAY_STATUS_URL_TEMPLATE", "");
  vi.stubGlobal("fetch", vi.fn());
  db.rpc.mockReset();
  db.from.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("payment input", () => {
  it.each([0, -1, Infinity, NaN, 0.001, 1_000_001])("rejects invalid money %s", (n) =>
    expect(paymentAmount.safeParse(n).success).toBe(false),
  );
  it("accepts exact paisa and rejects completed placeholder transaction IDs", () => {
    expect(paymentAmount.parse(500.25)).toBe(500.25);
    expect(rspayEventSchema.safeParse({ ...event, transaction_id: "INVALID" }).success).toBe(false);
  });
  it.each([
    "https://evil.test/payment/abc123",
    "http://pay.rspay.org/payment/abc123",
    "https://pay.rspay.org@evil.test/payment/abc123",
    "https://pay.rspay.org/payment/other",
    "https://pay.rspay.org/payment/abc123?next=evil",
  ])("rejects unsafe checkout %s", (url) => expect(() => safeCheckoutUrl(url, "abc123")).toThrow());
});

describe("create payment", () => {
  it("sends the documented contract with private callback capabilities and returns only a safe URL", async () => {
    db.rpc
      .mockResolvedValueOnce({ data: { id, created: true, status: "CREATING" }, error: null })
      .mockResolvedValue({ data: { ok: true }, error: null });
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        response({
          success: true,
          short_code: "abc123",
          payment_page_url: "https://pay.rspay.org/payment/abc123",
          request_data: { secret: "must-not-reach-client" },
        }),
      )
      .mockResolvedValueOnce(response({ success: true, amount: 500, method: "bkash" }));
    const result = await createRspayDeposit("user-id", "test@example.com", {
      amount: 500,
      method: "bkash",
      requestId: id,
    });
    expect(result).toEqual({ ok: true, id, url: "https://pay.rspay.org/payment/abc123" });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.rspay.org/api/gateway/create-link");
    expect(options?.redirect).toBe("error");
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      amount: 500,
      method: "bkash",
      domain: "portal.example",
      checkout_items: { orderId: id },
      user_identyfy_address: "test@example.com",
    });
    expect(body.call_back_url).toMatch(
      new RegExp(`/api/payments/rspay/${id}/[a-f0-9]{64}/success$`),
    );
    expect(body.pending_call_back).toBe(body.call_back_url.replace(/success$/, "pending"));
    expect(body.success_redirect_url).toBe(`https://portal.example/wallet?payment=${id}`);
    expect(JSON.stringify(result)).not.toContain("request_data");
  });
  it("does not repeat a merchant POST for a duplicate user intent", async () => {
    db.rpc.mockResolvedValue({
      data: { id, created: false, status: "PENDING", url: "https://pay.rspay.org/payment/abc123" },
      error: null,
    });
    await createRspayDeposit("user-id", "test@example.com", {
      amount: 500,
      method: "bkash",
      requestId: id,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("records link failure without exposing the vendor's echoed secrets", async () => {
    db.rpc
      .mockResolvedValueOnce({ data: { id, created: true, status: "CREATING" }, error: null })
      .mockResolvedValue({ error: null });
    vi.mocked(fetch).mockResolvedValue(
      response(
        { success: false, message: "Android devices offline", request_data: { secret: "hidden" } },
        400,
      ),
    );
    const result = await createRspayDeposit("user-id", "test@example.com", {
      amount: 500,
      method: "bkash",
      requestId: id,
    });
    expect(result.ok).toBe(false);
    expect(db.rpc).toHaveBeenLastCalledWith("wallet_rspay_link_failed", { _deposit_id: id });
    expect(JSON.stringify(result)).not.toContain("hidden");
  });
});

describe("independent provider verification", () => {
  it("confirms callback privacy against the real public checkout contract", async () => {
    vi.mocked(fetch).mockResolvedValue(
      response({ success: true, amount: "500.00", method: "bkash" }),
    );
    expect(await checkCallbackPrivacy("abc123", "a".repeat(64), 500, "bkash")).toBe(true);
  });
  it("refuses capability authentication if the public API discloses the callback URL", async () => {
    const token = "a".repeat(64);
    vi.mocked(fetch).mockResolvedValue(
      response({
        success: true,
        amount: 500,
        method: "bkash",
        request_data: { call_back_url: `https://portal.example/api/${token}/success` },
      }),
    );
    expect(await checkCallbackPrivacy("abc123", token, 500, "bkash")).toBe(false);
  });
  it("credits a callback authenticated by a confirmed private per-order capability", async () => {
    const token = "a".repeat(64);
    db.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { callback_hash: hashCapability(token), callback_private: true },
            error: null,
          }),
        }),
      }),
    });
    db.rpc.mockResolvedValue({ data: { ok: true, status: "COMPLETED" }, error: null });
    expect(await processRspayCallback(id, token, "success", event)).toBe(200);
    expect(db.rpc.mock.calls[0][1]._verified).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects a wrong private capability before any financial operation", async () => {
    db.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { callback_hash: hashCapability("b".repeat(64)), callback_private: true },
            error: null,
          }),
        }),
      }),
    });
    expect(await processRspayCallback(id, "a".repeat(64), "success", event)).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { success: true, amount: 500 },
    { success: true, data: { ...event, short_code: "different" } },
    { success: false, ...event },
  ])("fails closed on incomplete or mismatched responses", async (body) => {
    vi.mocked(fetch).mockResolvedValue(response(body));
    expect(await verifyRspayPayment("abc123")).toBeNull();
  });
  it("accepts only a complete provider payment record", async () => {
    vi.mocked(fetch).mockResolvedValue(response({ success: true, data: event }));
    expect(await verifyRspayPayment("abc123")).toEqual(event);
    expect(vi.mocked(fetch).mock.calls[0][1]).not.toHaveProperty("body");
  });
  it("never follows verification URLs to a different origin", async () => {
    vi.stubEnv("RSPAY_STATUS_URL_TEMPLATE", "https://evil.test/{short_code}");
    expect(await verifyRspayPayment("abc123")).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not credit an unsigned callback when provider verification is unavailable", async () => {
    const token = "a".repeat(64);
    db.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { callback_hash: hashCapability(token), callback_private: false },
            error: null,
          }),
        }),
      }),
    });
    db.rpc.mockResolvedValue({ data: { ok: true, status: "VERIFYING" }, error: null });
    vi.mocked(fetch).mockResolvedValue(response({ success: true, amount: 500 }));
    expect(await processRspayCallback(id, token, "success", event)).toBe(503);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.rpc.mock.calls[0][1]._verified).toBe(false);
  });
  it("rejects invalid callback tokens before contacting the provider", async () => {
    expect(await processRspayCallback(id, "bad", "success", event)).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
});
