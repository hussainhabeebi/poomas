# FlyPoomas Hotel v3 — recovery race fix and pre-UAT readiness

Date: 23 October 2026 (Asia/Karachi).
Repository: `hussainhabeebi/poomas`; branch: `review/hotel-api-readiness`.
Implementation base: `f83dbfc98c2956fe35b5aca23096cfb5c39d4db1`.
The implementation is prepared for a review-branch commit and draft pull request.
No merge, deployment or production migration is authorized. External verification
commands and isolated preview instructions are in [hotel-external-preuat.md](hotel-external-preuat.md).

## Current conclusion

**Race fix: PASS in regression tests. Overall UAT readiness: BLOCKED.**
The previously failing hotel regression is retained and now passes. No new hotel
regressions were found. Real PostgreSQL migration/concurrency/restart verification
and rendered desktop/mobile browser QA remain blocked. The API suite still reports
four unchanged baseline flight failures. Supplier entitlement, infrastructure and
business approval must be verified before any authorized supplier UAT.

## Focused changes in this task

- `apps/api/src/routes/hotel-checkout.ts`: shared SQL snapshot predicates protect
  status claims, successful completions, error/cooldown writes and admin action
  claims. Late Book acknowledgements/errors can update only SUBMITTING attempts.
- `apps/api/src/lib/hotel-booking-state.ts`: conservative monotonic status policy
  preserves cancellation intent, pending confirmation and confirmed/terminal states.
- `apps/api/test/hotel-recovery-ordering.test.ts`: preserves the original regression
  and adds overlapping polls, actual mocked admin confirmation/cancellation actions,
  stale error writes, expired-lease recovery, fresh request contexts and out-of-order
  supplier snapshot cases. All 19 tests pass.
- `apps/api/test/hotel-booking-state.test.ts`: two additional tests ensure delayed
  Book acknowledgement/error cannot overwrite a separately reconciled confirmation.
- This report and `docs/hotel-recovery-race.diff`: current findings and an incremental
  code/test diff relative to the local pre-fix review state. The diff is NOT the
  complete branch-versus-main diff. Reverse-apply check passed without changing files.

No migration, schema, authentication middleware, flight router/search, gateway,
Cloudflare configuration, dependency versions, production settings or records were
changed by this focused fix.

## Atomic mechanism and ordering rules

`attemptStateGuard` compares the persisted attempt ID, tenant, state and both
one-time confirmation/cancellation timestamps. `attemptPollGuard` also compares the
monotonically increasing poll counter. These are SQL UPDATE WHERE predicates, not
in-memory locks. The database arbitrates claims across processes.

A poll atomically changes checks N to N+1 and reserves its lease. Only a completion
or error write matching the same state/action markers AND counter N+1 can publish.
An admin action changes state/markers, invalidating every earlier status response.
A replacement worker recovering an expired lease increments the counter again,
invalidating an old worker's late response or error. Stale snapshots cannot even
claim a lookup after an admin intent has changed the row.

Cancellation intent can progress to CANCELLED but not back to SUCCESS/ON_HOLD.
Pending confirmation cannot regress to ON_HOLD or a generic pending snapshot.
SUCCESS cannot regress to ON_HOLD/PENDING. Terminal failed/aborted/cancelled states
remain terminal. Ignored supplier snapshots preserve previously verified details;
polling schedules derive from the accepted local state, not stale supplier states.
No undocumented supplier ordering field is assumed.

Existing unique quote/provider/idempotency protections and one-time admin markers
are unchanged and never cleared. No uncertain Book/confirm/cancel is resubmitted.
Recovery performs Booking Details only. Real database locking and multi-process
restart behavior still require PostgreSQL verification; mocks are not proof of it.

## PASS / FAIL / BLOCKED results

| Check | Result | Scope / evidence |
|---|---|---|
| Original stale-response regression | PASS | Retained test now passes |
| Overlapping polls / confirmation / cancellation / late errors | PASS | 19 ordering tests, mocked provider and labelled database fixture |
| Late Book acknowledgement/error versus verified confirmation | PASS | Two added route regressions |
| Quote matching, auth/ownership, idempotency and admin permissions | PASS | Hotel route/mock regression coverage retained |
| Sensitive diagnostic redaction | PASS | Success/failure/non-JSON persistence fixtures; real historical logs unverified |
| No uncertain booking resubmission | PASS | Book-once, duplicate-key/quote and timeout tests |
| Migration 0013 structure | PASS — source only | Two additive tables, five indexes, tenant/user/quote FKs, nonnegative counter CHECK |
| Native PostgreSQL migration and real constraints | BLOCKED | No postgres/psql/initdb/container runtime or approved isolated DB supplied |
| Real parallel connections / process-restart recovery | BLOCKED | Simulated request-context/lease recovery passes; no real PG process test |
| Search/detail, room/meal selection and guest workflow | PASS — fixtures only | Single/multi-room occupancy, child ages, validation, price acceptance and recovery |
| My Trips owner-list access | PASS — mocked API | Cross-owner/tenant rejection and stored quote/room details |
| Rendered desktop/mobile and authenticated My Trips/admin UI | BLOCKED | Local preview not accessible to cloud browser; no physical-device tests |
| Hotel operations excluded from flight retries | PASS | Separate Hotel v3 client, one fetch per mutation; no flight retry wrapper |
| Riya/TripJack flight routing and gateway preservation | PASS | Protected source unchanged; supplier/gateway regressions pass |
| Full API suite | FAIL — baseline only | 151/155 pass; four pre-existing flight failures, no hotel failures |
| Web tests | PASS | 15/15: 11 passenger-date + 4 hotel React/jsdom |
| Supplier tests | PASS | 27/27 |
| Gateway tests | PASS | 9/9 |
| Hotel tests (included in API suite) | PASS | 47/47 |
| API/web TypeScript and optimized web build | PASS | Validation-only unreachable local API origin; artifact not for deployment |
| Migration rollback/restore rehearsal | BLOCKED | Procedure prepared, no PostgreSQL runtime to execute it |
| Live supplier access/configuration | BLOCKED | No live calls, entitlement/credentials/IP routing not verified |

The cloud browser's local preview attempt remains inaccessible. Its URL policy also
rejected reopening the existing browser error page (unsupported internal protocol);
no workaround or alternate browser surface was attempted. Run the rendered QA on a
developer computer or a separately approved, browser-reachable isolated preview.
The DOM tests do not establish real desktop/mobile layout, viewport or device behavior.

## Test execution

External preparation rerun: 47/47 hotel, 15/15 web and 36/36 supplier/gateway
tests pass; full API remains 151/155 with the same four flight failures. API/web
type checks and optimized web build pass. The two preview safety/fixture smoke
tests pass. The actual Next preview starts under the loopback network guard and
returns HTTP 200 for `/hotels`, fixture-backed `/hotels/search`, `/hotels/book`
and `/trips`; the SSR search contains the synthetic property. This is HTTP smoke
evidence, not rendered browser, viewport or real authentication QA. No public
preview was deployed. Native PostgreSQL harness execution stops with BLOCKED
because Docker is absent.

- `node --test` with the tsx loader and a network-denying preload: all API tests,
  **151/155 passed**. Separate hotel-only run: **47/47**.
- `pnpm --filter @poomas/web test`: **15/15**.
- `node --test packages/suppliers/test/*.test.cjs apps/tripjack-gateway/test/gateway.test.mjs`:
  **36/36**, comprising 27 supplier and 9 gateway tests.
- `pnpm --filter @poomas/api typecheck`, `pnpm --filter @poomas/web typecheck`: passed.
- Optimized web build: passed with `NEXT_PUBLIC_API_URL=http://127.0.0.1:9` and
  telemetry disabled. Never deploy this validation artifact.
- `git diff --check` and `git apply --reverse --check docs/hotel-recovery-race.diff`: passed.

The four baseline failures are in `apps/api/test/booking-confirmation.test.ts`:
1. `explicit rejected booking is not success`.
2. `confirm route distinguishes review, submission and persistence failures`
   (parent test also reported failed because its subtests fail).
3. `lost submit response is unknown and does not retry`.
4. `accepted booking survives local save failure`.
They were previously reproduced against the clean baseline. Flight code was not
changed to address them in this hotel task.

## Supplier configuration and launch safety

The official contract reference remains https://tripjack.com/page/api-doc (rendered
contract inspected on 23 October 2026). No live supplier validation was performed.

Flights and hotels share the saved Admin TripJack apiKey/environment at
`admin_settings:<tenant>:integration:tripjack`. Hotel credentials fall back to
`TRIPJACK_API_KEY`; requests use server-side `TRIPJACK_API_BASE_URL` and
`TRIPJACK_PROXY_KEY`. There is no dedicated hotel API-key field. The generic Admin
enabled toggle controls flight search, not the Hotel v3 mutation gate. Changing the
shared key can affect both products; quote account fingerprints reject mismatches.

The gateway must route UAT HMS requests to `https://apitest-hms.tripjack.com`, hotel
booker requests to `https://apitest-hotel-booker.tripjack.com`, and its existing
main-host nationality alias to `https://apitest.tripjack.com`. The actual deployed
values, credentials, hotel entitlement and fixed-IP allowlisting are not verified.
The Admin environment label alone does not select gateway upstreams.

Hotel Book/confirm/cancel directly use the separate Hotel v3 client and do NOT inherit
the general maxRetries=2 / flight search retry loop. Repeated status lookups are not
repeated Book requests. Flight Riya/TripJack routing/fallback code remains unchanged.

`HOTEL_BOOKING_MODE` remains unset/default-disabled in application configuration.
Only deliberately authorized isolated UAT can select HOLD_UAT or INSTANT_UAT;
this implementation blocks production hotel mutations. Actual deployed environment
configuration was not inspected. No environment
settings, secrets or release controls were changed. Signed-in checkout and
settlement policy remain provisional. No live supplier booking/cancellation occurred.

## Database migration requirement

The race fix uses existing state, checks and action timestamp columns. It requires
NO amendment to `0013_hotel_quotes_attempts.sql` and NO additional migration.
The original additive migration is still required before deploying the hotel tables:
`packages/db/drizzle/migrations/0013_hotel_quotes_attempts.sql`.
SHA-256: `ff67953ddf99381219f271c275dd95666286706071d699a0fbf0dbeaf05e4557`.
No migration was executed in this task, even locally, because PostgreSQL is unavailable.
Mocks were not substituted as database verification. No privileged package installation
was attempted.

### PostgreSQL execution and recovery requirements (NOT EXECUTED)

Use a fresh local disposable PostgreSQL database or an explicitly authorized UAT
clone with the preceding FlyPoomas schema. Never use production `DATABASE_URL`.
The current environment has no native PostgreSQL/container runtime; a previous package-manager
attempt was blocked by OS privilege restrictions. No elevated installation was
attempted for this verification. A developer
with a supported local PostgreSQL installation must perform these checks, or an
isolated test runtime must be supplied. Do not bypass OS restrictions.

1. Verify target host/database/user and take an isolated database snapshot or
   `pg_dump --format=custom` before migration. Record the snapshot/backup securely.
2. On the disposable database, first apply 0013 inside BEGIN, inspect it, then
   ROLLBACK; verify both new tables are absent and existing fixture rows unchanged.
3. Apply only 0013 atomically with approved PostgreSQL tooling, for example:

   `psql "$HOTEL_UAT_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f packages/db/drizzle/migrations/0013_hotel_quotes_attempts.sql`

4. Run these read-only verification queries on that isolated target:

```sql
SELECT current_database(), current_user, inet_server_addr(), inet_server_port();
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('hotel_quotes','hotel_attempts')
ORDER BY table_name, ordinal_position;
SELECT tablename, indexname, indexdef FROM pg_indexes
WHERE schemaname = 'public' AND tablename IN ('hotel_quotes','hotel_attempts')
ORDER BY tablename, indexname;
SELECT conrelid::regclass AS relation, conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN ('public.hotel_quotes'::regclass,'public.hotel_attempts'::regclass)
ORDER BY relation, conname;
```

5. With disposable fixtures only, exercise all three unique indexes using two
   concurrent connections; verify missing tenant/user/quote FKs and negative checks
   fail. Restart API/connections while an acknowledged/unknown attempt is stored;
   assert recovery loads it and no second supplier Book is sent. Mock the supplier.
6. Practise restoring the pre-migration backup into ANOTHER disposable database;
   compare existing rows/schema. Then verify migration reapplication fails safely
   and does not leave partial schema. Stop on any mismatch or SQL error.
7. For a later authorized release, fix/review the existing deployment runner:
   `.github/workflows/deploy.yml:55-66` replays all SQL files, tolerates failures
   and explicitly checks only the social-sign-in migration. It does not establish
   that hotel migration 0013 succeeded. Workflow was not modified here.
8. After any real supplier activity, recovery must preserve quotations, booking
   references, action/idempotency markers and audit evidence. Roll application code
   back while retaining additive tables; do not drop tables or restore an old DB
   snapshot that would discard attempts and permit duplicate supplier bookings.
   Unknown provider outcomes require reconciliation, not blind resubmission.


## Mandatory TripJack self-certification matrix — NOT EXECUTED

Counts are per-room arrays where applicable. Ages must be supplied for every
child using provider-approved test guests. Domestic/international are relative
to the supplier's certification definition; obtain approved destination IDs.

| Case | Official scenario | Market | Adults | Children | Rooms | Required evidence |
|---|---|---|---|---|---|---|
| 1 | Auto-cancel unconfirmed ON_HOLD | Domestic | 1 | 0 | 1 | Hold, deadline, verified auto-cancel |
| 2 | Instant booking | Domestic | 4 | 2 | 1 | Review, one Book, SUCCESS |
| 3 | Hold then confirm | Domestic | 2,3,2 | 2,1,1 | 3 | Exact occupancy, hold, authorized confirm, SUCCESS |
| 4 | Book within cancellation deadline then cancel | Domestic | 1,2,1,1,1 | 2,1,1,0,0 | 5 | Policy/deadline/penalty and final CANCELLED |
| 5 | Book outside cancellation deadline then cancel | International | 4 | 2 | 1 | Accepted penalty and final cancellation |
| 6 | Cancel hold without confirming | International | 2,3,2 | **2,1,2001 as printed; invalid** | 3 | TripJack must correct this value first |
| 7 | Instant booking | International | 1,2,1,1,1 | 2,1,1,0,0 | 5 | Exact room/child mapping and SUCCESS |
| 8 | Instant booking | International | 3,3 | 0,0 | 2 | Per-room leads and SUCCESS |
| 9 | Display cancellation rules/policies | Both | — | — | — | Screenshot and supplied slabs/timezone |
| 10 | Same PAN across rooms, Indian nationals | Both | 2,2 | 1,0 | 2 | Approved PAN fixture and accepted booking |
| 11 | Same PAN for every guest, Indian nationals | Both | 2 | 1 | 1 | Approved PAN fixture and accepted booking |
| 12 | Passport booking, non-Indian nationality, if applicable | Both | 2 | 1 | 1 | Supported nationality and passport fixture |
| 13 | Corporate PAN, Indian nationals, if applicable | Both | 2 | 1 | 1 | Approved corporate PAN/GST requirements |
| 14 | Cancel all certification bookings on completion | — | — | — | — | Authorized cleanup and final supplier statuses |

Additional matrix: invalid dates/leap years; occupancy/age mismatch; missing/invalid
credentials; sold-out option; expired search/quote; price/meal/currency/terms change;
cross-owner/tenant access; concurrent duplicates/same-provider-reference reviews;
process restart after submission; timeout and delayed success; lookup-not-found;
invalid/mismatched provider reference; 36-check/180-second bound; daily cancellation
pending checks; rejected hold; supplier HTTP-200 errors; inaccessible/failed gateway;
mobile search/room/guest input; refresh and My Trips recovery; sensitive-log inspection.


## Unresolved provider / business questions

1. Correct case 6 child count `2001`. Do not guess that it means one child.
2. Confirm precise Review reference/TTL behavior and whether repeat Review or Book
   can return a different booking ID. Current behavior fails safely on mismatched
   Book IDs and never resubmits. Booking Details supports the Review reference per docs.
3. Error 6515 is labelled SUPPLIER_TIMEOUT but its message says Option Sold Out.
   It is no longer treated as reliable sold-out evidence; a Book error stays UNKNOWN.
4. `ddt` is described inconsistently in the field table versus the hold flow.
   Confirm deadline timezone and exact hold-expiry semantics in authorized UAT.
5. Confirm supported same-day searches, maximum booking horizon/stay and actual
   nationality/currency entitlement. Do not invent a supplier horizon.
6. Confirm PAN rules per lead guest/per room, passport fields and reseller/GST
   passthrough data. GST-dependent rates remain blocked until verified.
7. Approve signed-in-only checkout, agency delegation, hold versus instant mode,
   settlement responsibility, customer payment collection, refunds and cancellations.
   No customer payment collection or live activation has been added.
8. Agree approved certification evidence handling: raw application logs must not
   store PII/credentials. Arrange approved secure test-only exports if TripJack needs
   richer certification payloads. Existing 90-day log-retention comments are not an
   enforced lifecycle; administrators must review old-log access and retention.


## Remaining gates before supplier UAT authorization

1. Run migration, indexes/FKs/uniqueness, atomic race cases and restart recovery on
   isolated native PostgreSQL; execute the prepared rollback/restore rehearsal.
2. Complete rendered desktop/mobile search, room selection, child/guest validation,
   price changes, booking status and authenticated My Trips/admin QA using mocks.
3. Verify Hotel v3 entitlement, approved UAT account/test guests/destinations, gateway
   hosts and outbound IP allowlisting; establish test wallet/financial consequences.
4. Resolve applicable provider documentation conflicts and GST/PAN/passport questions.
5. Approve signed-in checkout/agency ownership, hold versus instant, supplier-wallet
   funding, customer collection/refunds and cancellation/penalty responsibility.
6. Resolve or explicitly assess the four baseline flight failures before release.
7. Separately approve supplier UAT, migration execution and any later deployment.
   Do not push or merge to test: main's workflow deploys and attempts migrations.

Code, tests, migration source and isolated verification tooling are included for
review only. This branch may be committed and pushed for a draft PR; it must not be
merged or deployed until the remaining gates are reviewed and separately approved.
No production migration, settings change or live supplier operation was performed.
