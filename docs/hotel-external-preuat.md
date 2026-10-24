# External isolated pre-UAT verification

This is preparation, not authorization for supplier transactions, a production
migration, merge or deployment. Run in a separate checkout of the review branch.
Never load production environment files or credentials. Fixtures are synthetic;
they do not certify provider behavior, authentication or database concurrency.

## 1. Native PostgreSQL (external developer machine)

Prerequisites: Bash, Docker, PostgreSQL 16 image, Node 22, repository dependencies.
If the image is absent, obtain `postgres:16-alpine` through your approved container
registry process first. The script never installs tools or uses a supplied DSN.

```sh
bash -n scripts/hotel-preuat/postgres.sh
bash scripts/hotel-preuat/postgres.sh
```

The script starts a dedicated PostgreSQL container with **no network**, no published
port, no persistent volume and fixture-only credentials. It applies only `0013`
inside one transaction, using minimal synthetic `tenants`/`users` parent contracts.
It prints tables/columns/defaults, seven indexes including two PK indexes, five
foreign keys and the check constraint. It checks invalid FK/check rejection,
competing SQL sessions claiming one attempt, stale response rejection after a
persisted cancellation intent, database restart persistence, and transactional
DROP/ROLLBACK recovery. The container is removed on exit. No production target is
accepted. Commands are in `scripts/hotel-preuat/postgres.sh` and
`postgres-checks.sql`; retain terminal output as review evidence.

**Limit:** this proves native SQL constraints and the demonstrated CAS predicate,
not the entire application over Neon. Still run API-worker concurrency/restart
integration against an isolated Neon-compatible PostgreSQL adapter before UAT.
The route-level mocks cover interleaved cancel/confirm/polls and late submission
responses but do not count as PostgreSQL proof. Repeat those cases against that
adapter, with two independent workers, provider mock barriers, and exactly one
recorded mock Book call. Stop if the adapter cannot support atomic RETURNING,
unique constraints or transactions as used by the application.

For a full schema rehearsal, restore a **sanitized, approved schema-only** backup
into a separate isolated database and apply `0013` with
`psql -X -v ON_ERROR_STOP=1 --single-transaction -f ...`. Never run the current
fail-soft deployment migration loop as a verification procedure.

Production release requirements (not commands to run now): approved backup and
restore rehearsal; schema diff and migration-history check; one-time fail-fast
migration; no replay of previous migrations; deploy gated on success. Code rollback
must leave additive hotel tables and idempotency records intact. After any supplier
attempt, never drop tables or restore away attempt records: that can cause duplicate
bookings. Disable new hotel bookings, retain attempts, and reconcile by stored
provider reference. Only an unused disposable test database may be discarded.

## 2. Actual Next frontend, synthetic local API

No Worker, PostgreSQL, Cloudflare binding, TripJack SDK, gateway or supplier key is
started. Only the web app and `fixture-api.mjs` run. The launcher supplies an
allowlisted environment, rejects Next development `.env*` files, binds loopback,
and preloads a network guard in both processes and inherited Node children.
External fetch/HTTP/TCP/TLS connections are rejected. Local browser assets may
reference external URLs: use browser request blocking/offline allowlist for all
hosts except `127.0.0.1`/`localhost`; never enter real credentials or guest details.
Third-party fonts/images may be unavailable. Do not share or expose these ports.

```sh
# Install locked dependencies only through the normal approved developer process.
pnpm install --frozen-lockfile --ignore-scripts
node --test scripts/hotel-preuat/preview.test.mjs
node scripts/hotel-preuat/preview.mjs
```

Open `http://127.0.0.1:4001/fixture/login` to set the **synthetic local** customer
cookie and redirect to `http://127.0.0.1:3000/hotels`. This is not a real sign-in
or ownership test. Use a separate browser profile, not a production session.
Choose future dates; add rooms and child ages; search; open the property; select
an explicit combination; review; enter **invented test names/contact only**, and
accept the fixture quotation. Any Book action changes in-memory fixtures only.
The default scenario yields synthetic SUCCESS. Fixture state survives page refresh
but resets when the fixture process restarts; durable recovery is tested separately.

Set scenarios in another browser tab before returning to the checkout:

```text
http://127.0.0.1:4001/fixture/scenario?value=changed
http://127.0.0.1:4001/fixture/scenario?value=hold
http://127.0.0.1:4001/fixture/scenario?value=unknown
http://127.0.0.1:4001/fixture/scenario?value=soldout
http://127.0.0.1:4001/fixture/scenario?value=failure
http://127.0.0.1:4001/fixture/scenario?value=disabled
http://127.0.0.1:4001/fixture/scenario?value=success
```

Use a fresh search or Refresh quotation when changing scenarios. Check:

- Desktop 1440px; mobile 375px/390px; tablet 768px. Measure document/client width,
  inspect wrapped labels, touch targets, keyboard focus and zoom. Capture screenshots.
- Single room and multiple rooms with differing adult/child counts and ages.
  Empty/invalid child ages must prevent search; guest slots must match occupancy.
- Explicit room/meal choice, displayed total/taxes/currency, changed-price acceptance,
  expired quote, validation errors, loading/empty/sold-out/retry states.
- SUCCESS versus ON_HOLD/UNKNOWN wording; refresh restores quote/attempt without
  another Book action; My Trips shows the fixture hotel and links to its status.
- Remove the local fixture cookie: profile endpoints reject access (401). Test real
  owner versus other-owner/admin access separately using isolated backend sessions;
  the fixture does **not** reproduce production JWT/role authorization.
- Browser Back/Forward, retained search context and safe navigation after errors.

The mock API deliberately implements only required hotel/profile DTOs. Other site
features may show fixture 404s. Do not use this preview to claim flights, real auth,
provider schemas, payment behavior or production integration are certified.
Stop with Ctrl-C; delete the local fixture cookie. Do not deploy the fixture API.

## 3. Authorized supplier UAT gate

Reference the full **14-case** matrix and unresolved contract questions in
`hotel-readiness-uat.md`. Hosts are HMS `https://apitest-hms.tripjack.com`, booker
`https://apitest-hotel-booker.tripjack.com`, nationality main API
`https://apitest.tripjack.com`. Credentials use the server-side `apikey` header;
required references are `TRIPJACK_API_KEY`, `TRIPJACK_API_BASE_URL`,
`TRIPJACK_PROXY_KEY`, and the gateway's separate hotel upstream configuration.

Confirm Hotel v3 entitlement, whether the flight Admin key is also entitled for
hotels, correct UAT gateway aliases/upstreams and approved outbound fixed IPs.
Verify no production hosts/keys are inherited; booking is disabled by default.
Confirm test account/wallet funding and whether UAT creates any financial liability.
Authorize only a controlled UAT mode after all gates pass. Flight fallback and
retries must remain unchanged; hotel Book/confirm/cancel are never auto-retried.

Resolve the 5-second/180-second status-poll guidance versus transport timeout and
late-confirmation handling with TripJack; a local timeout is never proof of failure.
Resolve error 6515's timeout/sold-out contradiction, Review TTL/reference behavior,
`ddt` deadline semantics/timezone and malformed case-6 child count `2001`. Do not
invent corrected values or silently substitute prices, rooms or references.

Business approval remains required for signed-in checkout/agency delegation,
hold versus instant mode, supplier wallet funding, customer payment collection,
refund/cancellation deadlines and penalties, PAN/passport/GST sourcing, approved
test evidence handling and live launch. These are not technical defaults.

## Evidence status

| Gate | Status in this environment |
|---|---|
| Native PostgreSQL harness prepared | PASS; execution BLOCKED (no Docker/psql) |
| Fixture browser configuration prepared | PASS; 2/2 safety/fixture tests; Next HTTP smoke 200 on four pages |
| Actual desktop/mobile rendered QA | BLOCKED; external developer browser required |
| Real authentication/admin sessions against isolated API | BLOCKED; setup required |
| Hotel unit/route regression tests | See final command results |
| Supplier UAT / 14 certification cases | BLOCKED; authorized access and approvals |
| Production migration / deployment / live booking | Not authorized; not executed |

Latest gate review and proposed fail-fast release strategy: [hotel-external-gates-20261024.md](hotel-external-gates-20261024.md).
