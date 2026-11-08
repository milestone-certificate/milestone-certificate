# RSPay activation and SVP automatic results

RSPay requires the exact server value `RSPAY_AUTO_DEPOSIT_ENABLED=true`, a valid provider configuration and the administrator's master/method switches. The value `enable` does not activate it. Redirects and callback URLs use the canonical `https://mci-edu.xyz` origin so a customer returns to the same login session.

The configured `https://api.rspay.org/api` public information endpoint and `https://pay.rspay.org` were reachable during this check. The previously supplied `.xyz` API/checkout hosts returned 503. The API key remains server-side. Existing callback privacy, exact order/amount/method matching and one-time wallet credit checks remain enforced. Activation does not bypass these checks.

A new provider payment link or payment was not created during validation. Live checkout creation and completed-payment settlement therefore remain unverified; local PostgreSQL tests cover callback authorization, pending/reject transitions, duplicate-credit prevention and method controls.

## SVP automatic results

Live official lookups returned a passed result and a failed result for 8 November 2026. A pending retake scheduled for 25 November returned a failed result from 4 November. The earlier form could apply that old result to the pending retake.

The result page now matches candidate, stored SVP occupation code and exact exam date. Saves run through `checkSvpExamResult`, which derives identity and occupation from the stored exam and queries SVP server-side. Its service-role-only `apply_verified_svp_exam_result` RPC rejects changed passports, occupations, dates, times, linked-work changes and already-completed attempts. A database trigger also rejects a mismatched-date auto-save from an already-open older browser tab.

The normal result-history trigger appends one history event and synchronizes the linked approved work, including its scheduled exam date. Repeated saves do not create duplicate history. Submission-level checks preserve declared results when SVP temporarily reports pending or returns another attempt's result.

Validation includes 398 default-suite tests and 38 local PostgreSQL workflow/payment tests, plus TypeScript, lint and a production Node build. Existing fast-refresh lint warnings are unchanged.
