# FlyPoomas Partner API v1

Server-to-server API for partners such as LeadVyne.

## Authentication

Create a tenant API key in FlyPoomas Admin with the `search` scope. The raw
`pmsk_...` value is displayed only once. Store it only in the partner's
server-side secret manager.

Send either:

```http
Authorization: Bearer pmsk_...
```

or, for clients that cannot set bearer authentication:

```http
X-API-Key: pmsk_...
```

## Search flights

```http
POST https://api.flypoomas.com/api/partner/v1/search
Authorization: Bearer pmsk_...
Content-Type: application/json
```

```json
{
  "origin": "COK",
  "destination": "DXB",
  "departureDate": "2026-09-12",
  "adults": 1,
  "children": 0,
  "infants": 0,
  "cabinClass": "ECONOMY",
  "tripType": "ONEWAY",
  "currency": "AED"
}
```

A successful response contains `searchId`, `expiresAt`, and `offers`.
Each offer uses `offerId` instead of exposing the internal response envelope.
Raw supplier payloads and platform credential status are never returned.

Supplier failures are isolated. Working suppliers can still return offers while
`supplierErrors` identifies a failed supplier without exposing credentials.

## Errors

- `401 PARTNER_AUTHENTICATION_REQUIRED` - missing or malformed key
- `401 PARTNER_API_KEY_INVALID` - unknown, revoked, or inactive key
- `401 PARTNER_API_KEY_EXPIRED` - key expiry has passed
- `403 PARTNER_SCOPE_REQUIRED` - key does not include `search`
- `400` - invalid search payload
- `429` - tenant rate limit exceeded

## Current scope

This release implements partner authentication and flight search only. Checkout,
booking, webhook delivery, and signed portable offer tokens are separate phases.
