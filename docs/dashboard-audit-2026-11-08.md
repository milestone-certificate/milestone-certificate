# MCI dashboard audit — 8 November 2026

Scope: mci-edu.xyz only, as confirmed by the owner. Agency reporting belongs to the administrator; MCI does not define a separate agency login role. The Laravel repository is outside this audit.

## Coverage

All menu destinations and the candidate detail route were opened using isolated browser fixtures at 320px, 390px and 1280px: **123 page checks**, with no remaining runtime errors, error boundaries or horizontal page overflow. The mobile “More” drawer was exercised for each dashboard role. Fixtures contain a candidate, exam and approved submission; browser writes and external booking/payment actions are disabled.

| Role             | Pages checked                                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin            | Dashboard, wallet, submissions, reception, candidates/detail, exams, results, reports, payments, settings, accounts, SVP history, messaging, center addresses, agency report, finance |
| Staff            | Dashboard, wallet, submissions, reception, candidates, exams, results, reports, payments, settings                                                                                    |
| Agent            | SVP booking, dashboard, wallet, submit work, own works, sub-agents, public result check, office, about, agent results                                                                 |
| Reception        | Reception, submissions                                                                                                                                                                |
| Service provider | Provider work list                                                                                                                                                                    |
| Customer         | Personal portal                                                                                                                                                                       |

Route tests also verify that every menu destination is registered. Permission tests cover mixed roles and alternate spellings of protected URLs.

## Repairs

- Fixed an additional issue found on the live site: the global navigation loader used different initial server/client loading states on authenticated routes. Its first hydration render is now deterministic; a real SSR browser check and hydration regression test pass.
- Added a mobile menu containing every permitted page and logout, with a visible role label. Compact admin shortcuts and wrapped date/reminder controls prevent horizontal overflow; candidate cards and the customer question input fit 320px screens.
- Reused the canonical settings query, fixing a dashboard crash after visiting Settings. The admin email editor now uses the current account and appears only for admins. User badges show the actual roles.
- Clear private query data and cancel outstanding queries when the authenticated identity changes. Remount private page state for the new user and ignore late deposit responses from an unmounted page.
- Failed session/account verification no longer becomes a successful cached check. A failed device claim does not store a new key. Transient background verification outages retry without forced logout. Device logout affects only that device.
- The personal portal rejects management-role accounts, scopes its cache to the customer and loads exams/payments for the selected candidate. Query errors remain distinguishable from an empty account.
- Restored missing submission defaults and workflow triggers. An agent submission receives its owner, reference and correct approval stage; approved work links once to candidate/exam records. Bangladesh exam date/time and reception edits stay synchronized. Result changes append immutable history without duplicate entries for unchanged results.
- Added approved-work provider reads and phone-matched customer reads. Result reads require publication and full fee settlement. Customer receipts always start pending; customers cannot approve their own receipts or submit receipts for another candidate. Reception has read access to exams/results and uses the server workflow for reception edits.
- Protected submission ownership, approval/result fields and parent review boundaries. SVP submission-result checks explicitly authorize staff, active providers on approved work, or active agents on their own approved work.
- Restored the public result response contract and customer agent-contact lookup.

The schema repair is in `supabase/migrations/20261108180000_dashboard_workflow_repair.sql` and is recorded in production migration history. Production contained no submissions, candidates or exams at application time; no existing business records were rewritten.

## Validation and limits

- Full regression suite: 370 passing cases, including 19 wallet and 9 workflow cases against disposable PostgreSQL. The additional device-local logout and SSR hydration regressions also pass (372 cases total).
- TypeScript and the production Node build pass. ESLint has no errors; nine existing Fast Refresh warnings remain.
- Production metadata confirms both submission triggers, exam history recording, immutable-history protection and customer policies.
- Staff/provider identities were tested with local fixtures, not newly created production accounts. Booking creation, seat holds, SMS/email sending and real card/mobile payments are outside this audit. Existing SVP/gateway contract tests run as part of the suite.
- RSPay master and deployment activation remain off. Existing payment settlement was regression-tested locally; this audit does not activate automatic deposits.
