# Hotel release safeguards and external verification

PR #127. Review-only implementation; never merge or deploy until gates below pass.
No production secrets/bindings, supplier settings or flight routing are changed.

## Implemented release gate

All API/web/admin/portal jobs now `need: migrate-db` (YAML uses `needs`). SQL errors
are no longer swallowed. `scripts/migrations/hotel-release.sh` uses pipefail,
ON_ERROR_STOP and one transaction. Its generator acquires an advisory transaction
lock, verifies recorded legacy file checksums, applies only 0013 once, verifies
columns/defaults/FKs/indexes and records its checksum atomically. Repeat execution
with a matching ledger validates and no-ops; partial/untracked schema or drift fails.
New unknown migration files fail pending runner review. No legacy seed is replayed.

**Important deployment prerequisite:** this code intentionally refuses a database
without an approved ledger. An authorized administrator must inspect existing
production schema/history and approve a verified baseline before any release.
Expected ledger contract is `public.poomas_schema_migrations(name text PRIMARY KEY,
sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`. Creating or
baselining that ledger is NOT automated and has NOT been performed. Never mark
legacy files applied based on this document alone. Existing flight operations stay
unchanged; future deployments are deliberately blocked until this release gate is
satisfied. No live hotel flags are enabled.

The native failure harness runs the exact SQL generator in network-isolated PG16:
`bash scripts/hotel-preuat/migration-failure.sh`. It demonstrates missing-baseline
rejection, injected division-by-zero rollback of both DDL and migration history,
success and repeat preservation of an UNKNOWN attempt/idempotency key. Synthetic
baseline entries inside this disposable harness are not production approval.
Native execution is BLOCKED in the current workspace: Docker/psql are unavailable.
Four local structural/shell tests pass, including a stubbed psql exit 23 propagation;
these are not PostgreSQL proof.

## Manual workflows — no deploy steps

- `.github/workflows/hotel-postgres-verification.yml`: native PG16 constraints,
  concurrency/restart harness plus migration-failure harness. Optional deliberate
  job failure skips the dependent non-deployment sentinel and checks it was skipped.
  The overall simulated-failure run is expected to be red. Run both input values.
- `.github/workflows/hotel-browser-verification.yml`: actual Next frontend, isolated
  fixture API, Chromium at 375/390/768/1440px, room/guest/price/refresh/My Trips
  assertions, overflow checks, screenshots/traces. Node and browser supplier egress
  are blocked. Browser tooling is pinned and installed only in runner temp; no
  application dependencies or production credentials are added. Artifacts contain
  synthetic data only and expire after seven days. No public preview is deployed.

Both are workflow_dispatch only, contents:read, exact review-branch guards and
persist-credentials:false. No production/TripJack secrets, cloud deploy tokens,
checkout of arbitrary refs or pull_request_target. Local Playwright/browser binaries
were NOT installed and browser tests were NOT executed here.

GitHub shows historical successful Actions runs, but connector access cannot inspect
Actions runner/allowlist policies, register workflows on the default branch or
perform workflow_dispatch. Terminal push authentication is unavailable. Newly added
manual workflow files may require registration on the repository's default branch
before GitHub exposes Run workflow. **Do not merge the hotel PR to register them.**
An authorized repository administrator must approve the runner and register just
the non-deploying workflow definitions (or approve a dedicated isolated test repo),
then select review/hotel-api-readiness for execution. No workflow run was claimed.
Do not rerun an existing production deployment as a substitute.

## Actual Neon-compatible application adapter

`packages/db/test/hotel-neon-adapter.ts` imports the unchanged real `createDb`,
Drizzle schema and Neon HTTP driver. It does not mock fetch responses or replace
persistence. It sends concurrent insert claims from independent child processes,
checks CAS rejection after cancellation intent, and starts a fresh process to verify
an old key cannot create another attempt. Version must be PostgreSQL16. It retains
synthetic records and refuses a subsequent nonempty database; no cleanup deletes
booking or idempotency rows. No supplier SDK or endpoint is invoked.

This is **prepared, not executed**: no approved isolated Neon URL is available.
It tests actual adapter SQL and worker-process behavior, not full authenticated
Hono-to-supplier crash recovery; retain the route regressions and add full isolated
route/process fault tests before supplier UAT clearance.

Administrator prerequisites for optional job:

1. Create/approve an isolated disposable Neon PG16 database `hotel_preuat` and
   restricted user `hotel_preuat`, wholly separate from production. Approve cost.
2. Provision only synthetic parent tenant/user `fixture`, the approved 0013 schema
   and no hotel rows. Do not use customer data or the production DATABASE_URL.
3. Configure protected GitHub environment `hotel-uat-verification` with required
   reviewer/branch restriction; add encrypted `HOTEL_TEST_NEON_URL`, exact endpoint
   variable `HOTEL_TEST_NEON_HOST`, and approval variable
   `HOTEL_TEST_NEON_APPROVED=isolated-hotel-preuat`. These are NEW TEST settings,
   not requests to change production secrets. Host/user/database are checked by test.
4. Dispatch the PostgreSQL workflow with run_neon_adapter=true only after approval.
   Supply fresh isolated state for reruns, rather than deleting saved attempts.
5. Review real logs and SQL evidence before changing BLOCKED to PASS. Application
   ownership/security tests using real isolated sessions remain a separate gate.

## Sanitized per-case Hotel certification export — design only

Current Admin supplier logs offer generic JSON and exchange ZIP/file exports, with
hotel filtering in some paths. There is no trusted Hotel v3 certification-case
association/manifest. Generic exports may include old database messages or raw R2
files captured before redaction; exportFile returns historical response bytes.
They cannot be certified as a sanitized per-case Hotel export. Do not send old raw
ZIPs to TripJack or assume changing new-log persistence sanitized old objects.
Existing flight exports are unchanged by this PR.

Proposed separate endpoint/UI (not implemented):

- Authenticated admin only, live tenant/role/staff-section checks plus explicit UAT
  evidence-export permission. No API-key/service/customer token fallback. Restrict
  to UAT-approved case IDs 1–14, tenant, build SHA and reviewed run manifest.
- Trusted case-to-run/quote/attempt/correlation association created by authorized
  staff; never infer a case from an arbitrary booking ID or accept arbitrary R2 keys.
  Define additive audit/run schema in a separate reviewed migration if approved.
- Re-read every historical item through allowlist redaction **at export**, with
  fail-closed handling of malformed/unknown payloads. Export operation, sanitized
  status/code, latency, timestamps, build, expected/actual results and controlled
  pseudonymous references. No API/proxy/gateway keys, cookies, auth headers, guest
  names/contact/PAN/passport/payment instruments or raw free-text supplier errors.
- Manifest lists included/missing steps, states and reviewer sign-off. Sanitize JSON
  and filenames, bound item count/date range/size, enforce no-store, log export
  actor/case/tenant/time/count/checksum to audit without contents. Short retention,
  encrypted restricted storage and explicit human approval before provider sharing.
- If TripJack requires raw test identities or credentials, seek written secure
  test-only evidence requirements; never weaken application logs or silently add
  them to an export. Resolve provider acceptance of sanitized evidence first.
- Tests: unauthenticated/customer/wrong-tenant/staff denial; manifest injection;
  historical raw secret/PII removal; malformed payload rejection; case boundaries;
  bounded size; audit/no-store behavior. No report claims a new export exists.

## Remaining access and approvals

Approved Docker/PG16 runner; workflow registration and dispatch permissions; protected
isolated Neon environment and test-only secret; browser artifact review; native SQL
and actual adapter execution; real isolated auth/recovery faults; migration ledger
baseline approval; deployment gate run evidence; Hotel v3 UAT entitlement, separate
HMS/booker routing and IP allowlisting; test-wallet liability, hold/instant/payment
policy; provider deadline/timeout/PAN/GST and malformed certification-case questions;
secure evidence specification and separate supplier-transaction authorization.

No new supplier calls, booking/cancellation, production migration, secret changes,
merge, deployment or hotel enablement was performed.

## Administrator dispatch commands (NOT executed)

After workflow registration/runner approval, use GitHub Actions UI or authorized gh:

```sh
gh workflow run hotel-postgres-verification.yml -R hussainhabeebi/poomas --ref review/hotel-api-readiness -f simulate_failure=false -f run_neon_adapter=false
gh workflow run hotel-postgres-verification.yml -R hussainhabeebi/poomas --ref review/hotel-api-readiness -f simulate_failure=true -f run_neon_adapter=false
gh workflow run hotel-browser-verification.yml -R hussainhabeebi/poomas --ref review/hotel-api-readiness
# Only after protected environment + disposable Neon target approval:
gh workflow run hotel-postgres-verification.yml -R hussainhabeebi/poomas --ref review/hotel-api-readiness -f simulate_failure=false -f run_neon_adapter=true
```

Actual local results: 4/4 release-structure/generator/stub tests; 2/2 fixture safety
tests; 47/47 hotel regressions; DB/API TypeScript and standalone strict Neon-test
TypeScript pass. Workflows parse as YAML; shell/Python/JS syntax and whitespace
checks pass. Native PostgreSQL, actual Neon execution and Playwright remain BLOCKED,
not PASS. No full production build was rerun: application source and dependencies
are unchanged, and existing PR build evidence remains as previously reported.
