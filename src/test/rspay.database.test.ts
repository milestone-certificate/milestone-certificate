// @vitest-environment node
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Explicitly opt in to a disposable local database. Never run these against Supabase.
const url = process.env["RSPAY_TEST_DATABASE_URL"];
const run =
  !!url &&
  ["127.0.0.1", "localhost"].includes(new URL(url).hostname) &&
  new URL(url).pathname === "/rspay_test";
describe.runIf(run)("RSPay atomic wallet settlement (real PostgreSQL)", () => {
  const sql = postgres(url || "postgres://localhost/rspay_test", { max: 12, onnotice: () => {} });
  const owner = "ff000000-0000-4000-8000-000000000001";
  const staff = "ff000000-0000-4000-8000-000000000002";
  const admin = "ff000000-0000-4000-8000-000000000003";
  const hash = "a".repeat(64);
  beforeAll(async () => {
    const setup = postgres(url || "postgres://localhost/rspay_test", {
      max: 1,
      onnotice: () => {},
    });
    await setup.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS auth;
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE OR REPLACE FUNCTION public.is_staff(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 = '${staff}'::uuid $$;
      CREATE OR REPLACE FUNCTION public.has_role(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT $1 = '${admin}'::uuid AND $2 = 'admin' $$;
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
      INSERT INTO auth.users VALUES ('${owner}'),('${staff}'),('${admin}') ON CONFLICT DO NOTHING;`);
    for (const file of [
      "20261026120000_create_wallet_system.sql",
      "20261026120100_create_wallet_functions.sql",
      "20261026120300_wallet_request_deposit.sql",
      "20261108140000_rspay_wallet.sql",
      "20261108160000_rspay_gateway_controls.sql",
    ]) {
      await setup.unsafe(
        await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"),
      );
    }
    await setup.unsafe(
      "GRANT SELECT, INSERT ON public.wallet_deposits TO authenticated; GRANT SELECT ON public.wallet_accounts,public.wallet_transactions TO authenticated;",
    );
    await setup.end();
  });
  beforeEach(async () => {
    await sql.unsafe(
      "TRUNCATE public.wallet_rspay_orders, public.wallet_deposits, public.wallet_transactions, public.wallet_accounts CASCADE",
    );
    await sql.unsafe(
      "UPDATE public.rspay_gateway_settings SET enabled=true,bkash=true,nagad=true,rocket=true,upay=true; TRUNCATE public.rspay_gateway_audit",
    );
  });
  afterAll(async () => {
    await sql.end();
  });
  async function begin(request = randomUUID(), amount = 500, method = "bkash") {
    const [r] =
      await sql`SELECT public.wallet_rspay_begin(${owner},${request},${amount},${method},'test@example.com',${hash}) AS result`;
    return r.result as { id: string; created: boolean };
  }
  async function order(code = randomUUID()) {
    const d = await begin();
    await sql`SELECT public.wallet_rspay_bind(${d.id},${code},${`https://pay.rspay.org/payment/${code}`})`;
    return {
      id: d.id,
      event: {
        status: "COMPLETED",
        short_code: code,
        amount: 500,
        method: "bkash",
        transaction_id: randomUUID(),
        user_identyfy_address: "test@example.com",
        checkout_items: { orderId: d.id },
      },
    };
  }
  async function send(id: string, event: postgres.JSONValue, verified = true, secret = hash) {
    const [r] =
      await sql`SELECT public.wallet_rspay_event(${id},${secret},${sql.json(event)},${verified}) AS result`;
    return r.result as { ok: boolean; status?: string; reason?: string };
  }
  async function totals() {
    const [r] =
      await sql`SELECT (SELECT coalesce(sum(balance),0) FROM wallet_accounts)::float8 AS balance, (SELECT count(*) FROM wallet_transactions WHERE type='deposit')::int AS credits`;
    return r;
  }
  const control = (name: string, enabled: boolean, actor = admin) =>
    sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx`SELECT set_config('request.jwt.claim.sub',${actor},true)`;
      return tx`SELECT set_rspay_gateway_control(${name},${enabled}) AS result`;
    });
  it("allows only administrators to change gateway controls and read their settings", async () => {
    for (const actor of [owner, staff]) {
      await expect(control("enabled", false, actor)).rejects.toThrow(/Admin access required/);
      await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE authenticated");
        await tx`SELECT set_config('request.jwt.claim.sub',${actor},true)`;
        expect(await tx`SELECT * FROM rspay_gateway_settings`).toHaveLength(0);
        expect(await tx`SELECT * FROM rspay_gateway_audit`).toHaveLength(0);
      });
    }
    expect((await sql`SELECT count(*)::int AS count FROM rspay_gateway_audit`)[0].count).toBe(0);
  });
  it("changes one method atomically and writes an audit record only for a real change", async () => {
    await Promise.all([control("bkash", false), control("nagad", false)]);
    await control("bkash", false);
    const [s] = await sql`SELECT bkash,nagad,rocket,upay FROM rspay_gateway_settings`;
    expect(s).toEqual({ bkash: false, nagad: false, rocket: true, upay: true });
    const rows = await sql`SELECT control,old_value,new_value,changed_by FROM rspay_gateway_audit`;
    expect(rows).toHaveLength(2);
    expect(
      rows.every((r) => r.old_value === true && r.new_value === false && r.changed_by === admin),
    ).toBe(true);
  });
  it("rejects direct table writes even from an admin so normal changes retain an audit trail", async () => {
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE authenticated");
        await tx`SELECT set_config('request.jwt.claim.sub',${admin},true)`;
        await tx`UPDATE rspay_gateway_settings SET enabled=false WHERE id=1`;
      }),
    ).rejects.toThrow(/permission denied/);
  });
  it("blocks new orders when the master switch or selected method is off", async () => {
    await control("bkash", false);
    await expect(begin()).rejects.toThrow(/disabled/);
    expect((await begin(randomUUID(), 500, "nagad")).created).toBe(true);
    await control("enabled", false);
    await expect(begin(randomUUID(), 500, "nagad")).rejects.toThrow(/disabled/);
    expect((await sql`SELECT count(*)::int AS count FROM wallet_deposits`)[0].count).toBe(1);
    expect(await totals()).toEqual({ balance: 0, credits: 0 });
  });
  it("settles an existing paid order once even after gateway and method are disabled", async () => {
    const d = await order();
    await control("enabled", false);
    await control("bkash", false);
    expect((await send(d.id, d.event)).ok).toBe(true);
    expect((await send(d.id, d.event)).ok).toBe(true);
    expect(await totals()).toEqual({ balance: 500, credits: 1 });
  });
  it("credits once under simultaneous duplicate callbacks and ignores later failure/pending", async () => {
    const d = await order();
    const results = await Promise.all(Array.from({ length: 12 }, () => send(d.id, d.event)));
    expect(results.every((r) => r.ok)).toBe(true);
    await send(d.id, { ...d.event, status: "FAILED", transaction_id: "INVALID" });
    await send(d.id, { ...d.event, status: "PENDING", transaction_id: "PENDING_VERIFICATION" });
    expect(await totals()).toEqual({ balance: 500, credits: 1 });
    expect((await sql`SELECT status FROM wallet_deposits WHERE id=${d.id}`)[0].status).toBe(
      "approved",
    );
  });
  it("never credits an unverified webhook", async () => {
    const d = await order();
    expect((await send(d.id, d.event, false)).status).toBe("VERIFYING");
    expect(await totals()).toEqual({ balance: 0, credits: 0 });
  });
  it("rejects amount, owner identity, method, order and code mismatches", async () => {
    const d = await order();
    for (const patch of [
      { amount: 500.01 },
      { method: "nagad" },
      { user_identyfy_address: "attacker@example.com" },
      { checkout_items: { orderId: randomUUID() } },
      { short_code: "other" },
    ]) {
      expect((await send(d.id, { ...d.event, ...patch })).ok).toBe(false);
    }
    expect((await send(d.id, d.event, true, "b".repeat(64))).ok).toBe(false);
    expect(await totals()).toEqual({ balance: 0, credits: 0 });
  });
  it("prevents a transaction being reused by a second order, rolling back its credit", async () => {
    const first = await order(),
      second = await order();
    await send(first.id, first.event);
    expect(
      await send(second.id, { ...second.event, transaction_id: first.event.transaction_id }),
    ).toMatchObject({ ok: false, reason: "transaction_reused" });
    expect(await totals()).toEqual({ balance: 500, credits: 1 });
  });
  it("serializes distinct payments against the same wallet", async () => {
    const orders = await Promise.all(Array.from({ length: 6 }, () => order()));
    await Promise.all(orders.map((o) => send(o.id, o.event)));
    expect(await totals()).toEqual({ balance: 3000, credits: 6 });
  });
  it("keeps an early callback uncredited until the merchant's actual short code is bound", async () => {
    const d = await begin();
    const event = {
      status: "COMPLETED",
      short_code: "early-code",
      amount: 500,
      method: "bkash",
      transaction_id: "EARLY-TX",
      user_identyfy_address: "test@example.com",
      checkout_items: { orderId: d.id },
    };
    await send(d.id, event);
    expect((await totals()).credits).toBe(0);
    await sql`SELECT wallet_rspay_bind(${d.id},'early-code','https://pay.rspay.org/payment/early-code')`;
    await send(d.id, event);
    expect(await totals()).toEqual({ balance: 500, credits: 1 });
  });
  it("replays an authenticated early callback when checkout privacy is confirmed", async () => {
    const d = await begin();
    const event = {
      status: "COMPLETED",
      short_code: "early-private",
      amount: 500,
      method: "bkash",
      transaction_id: "EARLY-PRIVATE-TX",
      user_identyfy_address: "test@example.com",
      checkout_items: { orderId: d.id },
    };
    await send(d.id, event, false);
    // An out-of-order pending callback must not discard the queued completion.
    await send(
      d.id,
      { ...event, status: "PENDING", transaction_id: "PENDING_VERIFICATION" },
      false,
    );
    expect((await totals()).credits).toBe(0);
    await sql`SELECT wallet_rspay_bind(${d.id},'early-private','https://pay.rspay.org/payment/early-private',true)`;
    expect(await totals()).toEqual({ balance: 500, credits: 1 });
  });
  it("never resumes a checkout whose callback secret may be public", async () => {
    const key = randomUUID();
    const d = await begin(key);
    await sql`SELECT wallet_rspay_bind(${d.id},'unsafe-code','https://pay.rspay.org/payment/unsafe-code',false)`;
    const [r] =
      await sql`SELECT wallet_rspay_begin(${owner},${key},500,'bkash','test@example.com',${hash}) AS result`;
    expect(r.result.url).toBeNull();
  });
  it("settles a verified late completion once after a rejection", async () => {
    const d = await order();
    await send(d.id, { ...d.event, status: "FAILED", transaction_id: "INVALID" });
    await send(d.id, d.event);
    expect(await totals()).toEqual({ balance: 500, credits: 1 });
  });
  it("deduplicates checkout creation and rejects changing an existing request amount", async () => {
    const key = randomUUID();
    const a = await begin(key);
    expect(await begin(key)).toMatchObject({ id: a.id, created: false });
    await expect(begin(key, 600)).rejects.toThrow("Request already used");
  });
  it("denies browser execution of service RPCs and private order access", async () => {
    const d = await order();
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE authenticated");
        await tx`SELECT wallet_rspay_event(${d.id},${hash},${tx.json(d.event)},true)`;
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE authenticated");
        await tx`SELECT * FROM wallet_rspay_orders`;
      }),
    ).rejects.toThrow(/permission denied/);
  });
  it("blocks manual admin approval of gateway deposits without adding ledger entries", async () => {
    const d = await order();
    await expect(
      sql.begin(async (tx) => {
        await tx`SELECT set_config('request.jwt.claim.sub',${staff},true)`;
        await tx`SELECT wallet_review_deposit(${d.id},true,'manual')`;
      }),
    ).rejects.toThrow(/automatically/);
    expect(await totals()).toEqual({ balance: 0, credits: 0 });
  });
  it("preserves normal manual approval", async () => {
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('request.jwt.claim.sub',${owner},true)`;
      const [r] = await tx`SELECT wallet_request_deposit(200,'cash',null,null) AS result`;
      await tx`SELECT set_config('request.jwt.claim.sub',${staff},true)`;
      await tx`SELECT wallet_review_deposit(${r.result.id},true,'manual')`;
    });
    expect(await totals()).toEqual({ balance: 200, credits: 1 });
  });
  it("enforces own-record RLS and rejects client-inserted gateway metadata", async () => {
    await order();
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx`SELECT set_config('request.jwt.claim.sub',${owner},true)`;
      expect((await tx`SELECT * FROM wallet_deposits`).length).toBe(1);
    });
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE authenticated");
        await tx`SELECT set_config('request.jwt.claim.sub',${owner},true)`;
        await tx`INSERT INTO wallet_deposits(user_id,amount,method,provider) VALUES (${owner},500,'bkash','rspay')`;
      }),
    ).rejects.toThrow(/row-level security/);
  });
});
