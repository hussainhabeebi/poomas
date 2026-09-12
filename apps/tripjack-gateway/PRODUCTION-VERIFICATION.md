# TripJack repair — deployment and acceptance gates

This repair targets `main`, which deploys the API and website through GitHub Actions.
The Coolify gateway is a separate deployment. A successful Cloudflare workflow does
not prove that the gateway has been updated.

## Observed before the repair

- Public COK → DXB, 2026-09-26, one adult search returned HTTP 200 in 23.5 seconds.
- Its passenger-keyed upstream price was INR 28,023.59; Poomas normalized it as zero.
- A connecting itinerary ended at its first stop instead of the final destination.
- The existing validation endpoint returned `valid:false, reason:expired` for the
  selected search ID, without distinguishing missing routes from genuine expiry.
- PR #35 was merged into a different branch, not production `main`.

## Deployment gates

1. Deploy this branch's gateway from `apps/tripjack-gateway` in Coolify. Preserve
   the existing gateway key, upstream environment and IP allowlisting.
2. Verify authenticated `/fms/v1/review` requests reach the upstream, not a gateway
   404. Do not paste API keys or traveller data into issue comments.
3. Merge the reviewed changes into `main` and check both API and web deployments.
4. Search COK → DXB for 2026-09-26, one adult. Verify positive prices, final
   destinations and baggage against the raw supplier results.
5. Open checkout and verify review returns a current total. Test retry on a
   timeout/404: it must NOT show a fabricated expired-fare screen or enable booking.
6. Test a price change: consent is required, and the server must reject an old
   amount before calling the supplier booking API.

## Remaining live verification

No real booking, hold, ticket or payment was created during development. The
review parser is covered by fixtures, but the gateway review must be checked
against an actual authorized upstream response before calling the flow verified.
The existing final `/air-book/v2` gateway mapping and supplier booking payload
must also be checked against this account's TripJack AIR API contract. Do not
substitute hotel documentation or treat HTTP 404 as proof of fare expiration.
Do not perform production booking tests without explicit authorization.

## Tests

Run `node --test apps/tripjack-gateway/test/gateway.test.mjs`.
Compile `packages/suppliers/test/tripjack.test.ts` with TypeScript to a temporary
CommonJS output directory and run the compiled file with `node --test`.
Run TypeScript checks for suppliers, API and web. These are not live supplier tests.
