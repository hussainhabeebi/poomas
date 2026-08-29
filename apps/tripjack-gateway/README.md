# Poomas TripJack Gateway

Dedicated fixed-egress gateway for the TripJack API. Deploy this directory from
the `main` branch as a Coolify Dockerfile application.

## Required Coolify variables

- `POOMAS_GATEWAY_KEY` — independent random secret shared only with the Poomas Worker
- `TRIPJACK_UPSTREAM` — `https://apitest.tripjack.com` for UAT

The Cloudflare Worker owns `TRIPJACK_API_KEY` and sends it to the gateway on
each authenticated request. It does not need to be stored in Coolify.
`TRIPJACK_API_KEY` remains supported in Coolify only as an optional fallback
for direct self-hosted callers.

Optional controls are documented in `src/gateway.mjs`. Configure port `3000`,
domain `proxy.flypoomas.com`, and health path `/health` in Coolify.

TripJack must whitelist the public outbound IP of the Coolify host. The gateway
never returns either secret and logs no request or response bodies.
