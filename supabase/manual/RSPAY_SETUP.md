# RSPay automatic wallet deposits

Apply [`20261108140000_rspay_wallet.sql`](../migrations/20261108140000_rspay_wallet.sql)
and then [`20261108160000_rspay_gateway_controls.sql`](../migrations/20261108160000_rspay_gateway_controls.sql)
in the Supabase SQL Editor after the existing wallet migrations. They add private
gateway orders, deposit metadata, RLS restrictions and atomic settlement RPCs.
Existing manual deposits and wallet balances are preserved. No credentials are
included in the migration.

Administrators manage the gateway at **Dashboard → RSPay Gateway**. The master
switch starts **off**. bKash, Nagad, Rocket and Upay can each be switched on/off
independently; method preferences remain saved while the master is off. Changes
are atomic, admin-only and logged with the previous value, new value, actor and
time. Staff/agents cannot read these admin settings or change them directly.

The existing `RSPAY_AUTO_DEPOSIT_ENABLED` deployment flag remains a separate
activation lock. The dashboard cannot bypass it, missing credentials, or missing
wallet tables; the master switch stays disabled until the server is ready.
This change does not enable the deployment flag or send a payment request.
Disabled methods are disabled on the deposit page within its 15-second refresh
cycle and are rejected immediately by the server and order-creation RPC, even if
a caller submits a stale or crafted request. Switches affect **new checkouts**;
existing payment callbacks still settle exactly once after switching off.

Set these **server-only** deployment variables (see `.env.example`):

```
RSPAY_API_BASE_URL=https://api.rspay.org/api
RSPAY_API_KEY=<merchant key from secure deployment settings>
RSPAY_SITE_URL=https://svp-portal.up.railway.app
RSPAY_CHECKOUT_HOSTS=pay.rspay.org
RSPAY_AUTO_DEPOSIT_ENABLED=true
SUPABASE_SECRET_KEY=<Supabase server secret>
```

The merchant dashboard at `admin.rspay.org` uses the API base above. The supplied
`api.rspay.xyz` hostname was unreachable during implementation. The `.org` API
accepted the merchant key but refused link creation because the merchant's Android
SIM Gateway was offline. Keep that app connected before testing checkout. No real
payment or production wallet credit was performed during development.

An authenticated user opens **Wallet → Online deposit**, enters the amount and
chooses bKash, Nagad, Rocket or Upay. The server records a deposit, creates one
payment link per request ID, saves the returned `short_code`, and redirects to the
allowlisted provider checkout. All three return URLs open `/wallet?payment=<id>`.
That query parameter only selects a record; it cannot change a balance.

The request supplies three automatically generated POST callbacks:

```
/api/payments/rspay/<deposit UUID>/<256-bit private token>/success
/api/payments/rspay/<deposit UUID>/<256-bit private token>/pending
/api/payments/rspay/<deposit UUID>/<256-bit private token>/reject
```

**Webhook authentication:** the documentation supplies neither signatures nor an
authenticated payment-verification endpoint. Each order therefore gets a random,
secret callback capability; only its SHA-256 hash is stored. Callback URLs and the
merchant key never reach the browser. Do not log callback URLs or expose the
provider's `request_data` response. Restrict/redact these paths in any access logs.
Before returning a checkout URL the server reads RSPay's public
`GET /gateway/info/<short_code>` (the endpoint used by the official checkout).
It must return `success: true`, the exact `amount` and `method`, and must not
disclose the private token anywhere in its JSON. Otherwise checkout stays blocked
and its callbacks cannot auto-credit. This makes the provider keeping callback
URLs private an explicit requirement. Every production checkout must pass this
check before redirecting the user; do not bypass it to make checkout appear to work.

Callbacks must possess the correct private capability **and** match the recorded
code, amount, method, customer identity and checkout order UUID. The database locks
the order and wallet, updates the deposit and inserts a single ledger entry in one
transaction. Repeated/out-of-order callbacks never duplicate or remove a credit.
The same MFS transaction cannot settle two orders. Pending/rejected payments do
not add funds. Admin manual approval of a gateway order is blocked in the database.
An early authenticated callback is queued until the create-link response binds
its actual code and confirms privacy. Owners can read their records; staff/admin
can see all deposit records on the dashboard and paginated wallet history.

`RSPAY_STATUS_URL_TEMPLATE` is optional recovery support, **not a documented RSPay
status API**. If RSPay provides a read-only endpoint, configure its HTTPS URL on
the same API origin, using `{short_code}`. Its JSON must be `success: true` with a
full payment record, either at the root or inside `data`, containing the documented
`status`, `transaction_id`, `short_code`, `amount`, `method`,
`user_identyfy_address`, and `checkout_items.orderId`. Unknown/incomplete responses
never settle funds. The default info endpoint is not assumed to return paid
status; normal automatic settlement uses the private authenticated callbacks.

Deployment checks:

1. Apply the migration and configure server variables. Preserve the existing
   `SUPABASE_SERVICE_ROLE_KEY`/`SVP_CREDENTIAL_KEY` values used for SVP encryption.
2. Connect the RSPay Android gateway and create one unpaid checkout. Verify real
   amount/method, checkout hostname, private callback check and saved short code.
3. Complete an authorized small payment; confirm one ledger entry, correct wallet
   balance and admin record. Replay its real callback to confirm idempotency.
4. Test pending and rejection with the provider. A redirect alone never credits.

Local checks:

```
npx vitest run src/test/rspay.test.ts src/test/wallet.test.ts src/test/RspayDeposits.test.tsx
RSPAY_TEST_DATABASE_URL=postgres://postgres:<local-test-password>@127.0.0.1:55439/rspay_test npx vitest run src/test/rspay.database.test.ts
npx tsc --noEmit
NITRO_PRESET=node-server npm run build
```

The database test is opt-in and resets only an explicitly named **local** disposable
`rspay_test` database. It must never point at Supabase or another production DB.
