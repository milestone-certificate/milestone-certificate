# Customer portal privacy and appointment upload

Scope confirmed by the owner: “Public ID” means the existing customer/examinee portal, not a new work-submission role. Agent, reception, administrator and customer access remain separate.

## Customer-facing information

The customer portal, shared login/reset pages, page titles, favicon and loading states use a neutral identity. Agent contact details and the optional assistant panel have been removed from the customer page.

`get_customer_portal` derives identity from the authenticated session and returns only the customer's selected personal record, released/settled exam results, own receipts and related occupation/center names. Internal notes, OCR metadata, credentials, reviewers, agent IDs/names/contact details, organization settings and the general work directory are excluded. Customers cannot select the underlying internal tables directly. The old agent-contact endpoint returns no contact data, and work-history lookup requires an internal role.

Customer payment instructions have their own explicitly public setting in Settings → General. Internal settings are not reused as public instructions. Own photo access is allowed separately from staff and work-document access.

## Appointment upload repairs

The production OCR key was absent, the upload bucket did not exist, and both reference lists were empty. Additionally, the form locked out manual completion after OCR errors, allowed only four preset exam times, and matched centers using their first word.

- PDFs are read locally with PDF.js. Images and scanned PDFs use local English OCR. The engine, language, PDF fonts/CMaps and WASM files are served by this website; an AI key is not required for this form.
- Date/time values are normalized and all valid HH:mm start times are accepted. Reporting time is kept separate. Matching requires unambiguous occupation/center names, including when the catalog finishes loading after the file.
- Failed recognition of a valid document allows manual completion. Invalid signatures and oversized files remain blocked. New files cancel prior processing and cannot inherit late results; preview URLs and worker resources are released.
- The private `candidate-photos` bucket and role/path access rules support actual file uploads and signing. Customers can access only their own assigned photo, not work tickets or agent profiles. Agents cannot replace attached ticket files.
- The verified catalog migration inserts 98 occupations and 24 test centers from the existing Takamol connection, fetched 8 November 2026. Existing entries, edits and inactive records are preserved. Center rows without a sort order remain selectable.
- The administrator’s stored-ticket scan also uses the local reader. Verification updates the work, linked exam and review status in one database transaction, requires reasons for manual corrections, and rejects stale scans after a work changes.
- Internal work-note inserts now receive their author automatically; customer and unrelated-work inserts are denied.

## Validation

- 407 automated tests passed, including real PostgreSQL customer-privacy, workflow, storage-policy and wallet tests.
- 123 role/page browser checks at 320px, 390px and 1280px passed without runtime errors or page overflow.
- Real browser extraction succeeded for a text PDF (0.8s), PNG (1.8s) and scanned PDF (1.8s), using synthetic appointment documents. Name, passport, mobile, non-preset exam time and the correct center populated. These timings describe the test documents and environment.
- The customer browser view contains no company branding or agent contact panel. TypeScript, lint and the production Node build pass.

Poor images or missing printed fields require manual review; the system does not guess them. No booking, seat hold, SMS or real payment is created during this verification. Automatic RSPay deposits remain off.
