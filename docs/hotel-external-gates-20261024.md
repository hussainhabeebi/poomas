# External verification gate review — 24 October 2026

Repository: hussainhabeebi/poomas. Draft PR #127. Reviewed implementation:
`2338a4e0ef06144dae11fb2b23ac93b8e6fdf715`. No production or supplier operations
are authorized by this document. The PR must remain draft/unmerged.

## Available access and evidence

| Gate | Result | Evidence / exact dependency |
|---|---|---|
| Native PostgreSQL migration, constraints, parallel claims and restart | BLOCKED | No docker, psql or postgres executable; postgres.sh exits before doing anything. No approved HOTEL_UAT_DATABASE_URL or HOTEL_TEST_DATABASE_URL is available. |
| Actual application database adapter, independent workers | BLOCKED | packages/db/src/client.ts uses drizzle-orm/neon-http and @neondatabase/serverless. A native TCP PostgreSQL server alone is insufficient; supply an isolated Neon HTTP-compatible endpoint/adapter, not mocked persistence. |
| Browser screenshots at 375/390/768/1440 | BLOCKED | Available browser is cloud Chrome, with no attached developer browser or browser-reachable isolated preview. Previous local access was unavailable. No public preview is authorized. No screenshots or exact-width browser checks are claimed. |
| UAT credentials and authorization | BLOCKED | No TRIPJACK_API_KEY, TRIPJACK_API_BASE_URL or TRIPJACK_PROXY_KEY is present in this process; no local API .env/.dev.vars. This does NOT prove remotely deployed secrets are missing. No authorized secret-store/gateway access supplied. |
| Hotel client retry isolation | PASS, source and mocks | Separate Hotel v3 request method sends once, without flight retry/router wrappers; Book/confirm timeout 60s, Details/Review default 30s. Flights/gateway unchanged. |
| Production booking disabled | PASS, source only | HOTEL_BOOKING_MODE unset is disabled; production environment blocks Book/confirm/cancel. Actual deployed configuration was not queried. |
| Production migration/deployment fail-closed gate | FAIL, current workflow | .github/workflows/deploy.yml catches migration errors and replays all SQL. Only deploy-api needs migrate-db; web/admin/portal can deploy independently. A failed hotel migration cannot currently guarantee deployment is blocked. |

The temporary /tmp network-denying preload from the previous session was absent.
The first hotel command therefore failed to start (ERR_MODULE_NOT_FOUND), not a
hotel assertion failure. A committed, reproducible preload is now provided at
`scripts/hotel-preuat/deny-supplier-network.mjs`; rerun results are recorded on PR.

## Required isolated infrastructure

1. A developer/CI runner with approved Docker and PostgreSQL 16 image. Run
   `bash scripts/hotel-preuat/postgres.sh`. This uses no production DSN, network,
   host volume or published DB port. Retain unredacted output only for synthetic data.
2. For the **actual** application adapter, provision/authorize a disposable Neon
   test branch or supported local Neon HTTP proxy backed by isolated PostgreSQL.
   Verify host/database identity out of band. Do not change createDb to a mock or
   different production adapter merely to obtain a passing test. Approve fixtures
   for tenant/user and real auth sessions. Run two independent API processes with
   no supplier egress and a barrier-controlled mock provider. Verify one Book call
   for same-key/same-quote/same-reference concurrency; fail-on-different-payload;
   crash after send; lookup-only restart; late lookup/confirm/cancel writes; FK,
   index and counter constraints; and migration failure rollback. Report endpoint
   adapter/version and real SQL evidence; do not count route fixtures as proof.
3. A developer browser on the same machine as the local preview. Run
   `node scripts/hotel-preuat/preview.mjs`, use the synthetic login URL and the
   scenario matrix in hotel-external-preuat.md. Use 375/390/768/1440px responsive
   mode and record actual widths/screenshots. Real mobile-device opening remains
   separate. No public hosting, real account, real card or supplier connection.

## Repeatable local commands

From repository root, with locked dependencies installed:

```sh
node --test scripts/hotel-preuat/preview.test.mjs
node --import ./scripts/hotel-preuat/deny-supplier-network.mjs \
  --import ./node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/loader.mjs \
  --test apps/api/test/hotel*.test.ts
bash scripts/hotel-preuat/postgres.sh
node scripts/hotel-preuat/preview.mjs
```

The tsx path reflects the current lockfile, not an instruction to install another
version. PostgreSQL execution must remain BLOCKED when its prerequisites are absent.

## Fail-fast one-time migration strategy — proposed, NOT installed or run

Do not merge this PR into the existing auto-deploy workflow until a separately
reviewed release gate is implemented. Preserve existing flight routing/bindings.

- Approve the exact target, current schema/history, schema-only diff and encrypted
  backup/PITR restore rehearsal. Verify 0013 checksum
  `ff67953ddf99381219f271c275dd95666286706071d699a0fbf0dbeaf05e4557`.
- Use an approved migration ledger with unique migration identifier + checksum.
  Existing production ledger/baseline is not verified. If absent, stop for an
  explicit baseline/ledger approval; never assume earlier migrations are pending.
- In **one PostgreSQL session and transaction**, set ON_ERROR_STOP, take a
  transaction advisory lock for the hotel migration, and inspect the ledger and
  catalog. If matching ledger entry and exact schema exist, verify and no-op.
  If no ledger entry and both tables are absent, apply only 0013, validate all
  columns/defaults/FKs/indexes/check constraints, insert the matching ledger entry,
  then COMMIT. If tables exist without tracking, checksum differs, dependencies
  differ or any SQL/verification fails: ROLLBACK and nonzero exit. No IF NOT EXISTS
  masking a partial schema; no replay loop; no warning-and-continue.
- Use `psql -X -v ON_ERROR_STOP=1 --single-transaction -f APPROVED_WRAPPER.sql`.
  The wrapper must contain the lock, verified ledger/catalog checks, `\i` of 0013
  only for the approved fresh case, and ledger insert. Its final SQL depends on
  the inspected production ledger, so no runnable production wrapper is guessed.
- Every dependent deployment must have `needs: migrate-db` and default success
  gating, including API, web, admin and portal if deployed together. No always(),
  continue-on-error or swallowed SQL exit status. Manual environment approval must
  precede production migration. Test forced SQL failure in an isolated workflow:
  migration fails, transaction leaves no partial schema/history and **all deploy
  jobs are skipped**. Current workflow does not meet this requirement.
- Disable hotel mutations throughout. After deployment verify schema, ownership,
  default-disabled routes and existing flight smoke checks before any UAT release.

Recovery after failure: before any commit, the transaction rolls back. After a
successful additive migration, roll back application code while retaining tables,
quotes, attempts, provider IDs and one-time markers. Never restore away a submitted
or uncertain attempt or drop populated hotel tables. Reconcile by Booking Details;
never repeat Book. A backup restore must be rehearsed on another isolated database
and preserve all booking/idempotency records before it is considered for production.

## Controlled connectivity preparation — not executed

Obtain written permission for Search/Pricing/Review only, the entitled Hotel v3
UAT account, fixed outbound IP allowlisting, secure server-side secrets and approved
test destination/hotel IDs. Admin's TripJack key/environment are shared configuration
inputs for flights and hotels, but hotel entitlement is independent and unverified.
Do not change the flight key/environment just to test hotels.

Gateway variables: TRIPJACK_HMS_UPSTREAM=https://apitest-hms.tripjack.com;
TRIPJACK_HOTEL_BOOKER_UPSTREAM=https://apitest-hotel-booker.tripjack.com;
main nationality upstream https://apitest.tripjack.com via /tj-main alias.
Worker references TRIPJACK_API_KEY, TRIPJACK_API_BASE_URL (gateway),
TRIPJACK_PROXY_KEY; gateway uses POOMAS_GATEWAY_KEY. Verify exact routing and actual
outbound IP through an authorized administrator; never expose keys or log headers.

With Book/confirm/cancel denied at the isolated gateway and HOTEL_BOOKING_MODE
unset/DISABLED: resolve destination/nationality, Search (Listing), Detail (Pricing),
then authenticated Review into isolated DB only. Preserve correlationId, selected
optionId/reviewHash and returned bookingId. Check HTTP-200 error envelopes, currency,
rooms, taxes/terms and sanitized correlation/latency. Evidence includes operation,
status/error code, timestamp and account/environment confirmation, never raw guest
or credential payloads. Review yields a quotation, not a booking or payment.
Stop on production hostname, invalid credentials, wrong account, unexpected write,
price/rate substitution or any operation outside this allowlist.

## Controlled certification execution instructions — ALL BLOCKED / not run

First pass database/browser/connectivity gates, resolve documentation questions,
and obtain separate written permission for bookings, holds, wallet debits and
cancellations. Use the exact occupancies and market definitions from the 14-case
matrix in hotel-readiness-uat.md. Each case starts with a new valid search, explicit
room/rate selection and Review; record the approved quote/reference securely. Book
only once using that Review bookingId and stored authoritative price. Instant mode
includes paymentInfos; hold omits it. Poll Details (5-second guidance, up to 180s);
timeout/unknown means reconcile only. Never treat acknowledgement as confirmation.

| Case | Execution and required evidence |
|---|---|
| 1 | Domestic hold; do not confirm. Observe authorized automatic expiry/cancellation using documented deadline and Details. |
| 2 | Domestic instant, adults+children; verify room mapping, amount/currency and SUCCESS/confirmation. |
| 3 | Domestic three-room hold then staff confirm once; verify per-room occupancy and SUCCESS. |
| 4 | Domestic five-room booking; review current cancellation penalty, approve and cancel within deadline once; reconcile final status. |
| 5 | International instant; explicitly approve applicable outside-deadline penalty before cancellation; record final result. |
| 6 | International three-room hold cancellation; BLOCKED additionally until TripJack corrects printed child count 2001. |
| 7 | International five-room instant; verify each room's adults/children and one confirmation. |
| 8 | International two-room instant, three adults per room; verify complete supplier option and confirmation. |
| 9 | Display actual supplier cancellation rules, amounts/currency and IST deadlines; screenshot, do not fabricate missing policy. |
| 10 | Indian nationals: approved synthetic same PAN across two rooms; verify provider acceptance and privacy-safe evidence. |
| 11 | Indian nationals: same approved synthetic PAN for all guests in one room; verify applicable requirements. |
| 12 | Non-Indian nationality: approved passport fixture only if required; verify entitlement/compliance and confirmation. |
| 13 | Corporate PAN/GST only after contract/data-sourcing approval; currently GST-dependent rates are blocked. |
| 14 | Authorized cleanup of every certification booking; enumerate references, cancel only as approved, reconcile cancellation/penalties; never delete local attempts. |

Store case ID, build SHA, sanitized test fixture, room/age mapping, quote snapshot,
provider reference in restricted evidence, timings, expected/actual status, duplicate
call count and reviewer approval. Mocks are engineering evidence, not the final
TripJack certification report. No certification case has supplier PASS evidence yet.

Unresolved provider questions: case-6 malformed children; 6515 timeout versus soldout;
Review validity and repeated-review reference behavior; `ddt` meaning/IST deadlines;
transport timeout versus polling window and late confirmations; same-day/horizon;
PAN/passport/GST requirements. Business approvals: signed-in/agency ownership,
hold/instant, supplier wallet funding and UAT liability, customer payment collection,
settlement, cancellation fees/refunds and evidence handling. Production activation
requires a separate explicit approval after certification.

## Actual rerun evidence in this review

- Hotel regression tests: PASS 47/47 with the committed network-denying preload.
- Full API: 151/155; the same four baseline failures in booking-confirmation.test.ts:
  explicit rejected booking is not success; parent confirm-route distinctions;
  lost submit response is unknown and does not retry; accepted booking survives
  local save failure. No hotel assertion failed.
- Web: PASS 15/15. Supplier/gateway: PASS 36/36. Preview safety/fixture: PASS 2/2.
- Guarded Next HTTP smoke: /hotels, fixture-backed /hotels/search, /hotels/book
  and /trips all return 200; SSR search includes the synthetic fixture property.
  No rendered browser interaction, real Google/customer login or viewport test.
- bash postgres.sh: BLOCKED before execution (Docker absent); no migration applied.
- No application sources changed in this follow-up. TypeScript/build results remain
  the previously verified PR results; they were not rerun for documentation/preload
  changes. JavaScript syntax and git diff whitespace checks passed.

Do not submit these mock results as completed TripJack certification. The approved
certification report must contain supplier-UAT evidence and explicit authorization.
