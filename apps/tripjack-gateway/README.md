# Poomas TripJack Gateway

Dedicated fixed-egress gateway for the TripJack API. Deploy this directory from
the `tripjack-gateway` branch as a Coolify Dockerfile application.

## Required Coolify variables

- `TRIPJACK_API_KEY` — TripJack partner key (runtime secret)
- `POOMAS_GATEWAY_KEY` — independent random secret shared only with the Poomas Worker
- `TRIPJACK_UPSTREAM` — `https://apitest.tripjack.com` for UAT

Optional controls are documented in `src/gateway.mjs`. Configure port `3000`,
domain `proxy.flypoomas.com`, and health path `/health` in Coolify.

TripJack must whitelist the public outbound IP of the Coolify host. The gateway
never returns either secret and logs no request or response bodies.

