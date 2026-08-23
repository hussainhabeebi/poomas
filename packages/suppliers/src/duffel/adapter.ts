import type {
  SupplierAdapter, SearchParams, NormalizedFare, SupplierCredentials,
  HoldParams, HoldResult, BookParams, BookResult, CancelResult,
} from "../base.js";
import { DuffelClient } from "./client.js";
import { normalizeDuffelOffer, type DuffelOffer } from "./normalizer.js";

// Duffel adapter — full search + book lifecycle.
// Test key (duffel_test_...) uses the same base URL; Duffel routes it to sandbox.
export class DuffelAdapter implements SupplierAdapter {
  readonly name = "DUFFEL" as const;
  private client: DuffelClient;

  constructor(credentials: SupplierCredentials) {
    const apiKey  = (credentials.apiKey  as string) ?? "";
    const baseUrl = (credentials.baseUrl as string) ?? "https://api.duffel.com";
    this.client   = new DuffelClient(apiKey, baseUrl);
  }

  async search(params: SearchParams): Promise<NormalizedFare[]> {
    // Step 1: Create offer request
    const slices: unknown[] = [
      {
        origin:        params.origin,
        destination:   params.destination,
        departure_date: params.departureDate,
      },
    ];

    if (params.tripType === "ROUNDTRIP" && params.returnDate) {
      slices.push({
        origin:        params.destination,
        destination:   params.origin,
        departure_date: params.returnDate,
      });
    }

    const passengers: unknown[] = Array.from({ length: params.adults }, () => ({ type: "adult" }));
    if (params.children > 0) {
      passengers.push(...Array.from({ length: params.children }, () => ({ type: "child" })));
    }
    if (params.infants > 0) {
      passengers.push(...Array.from({ length: params.infants }, () => ({ type: "infant_without_seat" })));
    }

    const offerRequest = await this.client.post<{ id: string }>("/air/offer_requests", {
      data: {
        slices,
        passengers,
        cabin_class:   this.mapCabin(params.cabinClass),
        return_offers: false,
      },
    });

    // Step 2: Fetch offers for the request
    // GET /air/offers returns { data: [...] } — client.get<T> unwraps data, so T is the array
    const offers = await this.client.get<DuffelOffer[]>(
      "/air/offers",
      {
        offer_request_id: offerRequest.id,
        max_connections:  "2",
        limit:            "20",
        sort:             "total_amount",
      },
    );

    return (offers ?? []).map((o) => normalizeDuffelOffer(o, params.currency));
  }

  async hold(params: HoldParams): Promise<HoldResult> {
    // Duffel doesn't have a separate hold step — orders are confirmed immediately.
    // We return a synthetic hold result with the offerId as holdId.
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15-min window
    return {
      success:      true,
      holdId:       params.fareId,
      expiresAt,
      fareSnapshot: await this.getOffer(params.fareId),
    };
  }

  async book(params: BookParams): Promise<BookResult> {
    const passengers = params.passengers.map((p, i) => ({
      id:           `p${i}`,
      type:         p.type === "ADULT" ? "adult" : p.type === "CHILD" ? "child" : "infant_without_seat",
      given_name:   p.firstName,
      family_name:  p.lastName,
      born_on:      p.dob ?? "1990-01-01",
      gender:       (p.gender?.toLowerCase() ?? "m") === "m" ? "m" : "f",
      email:        params.contactEmail,
      phone_number: params.contactPhone,
      ...(p.passportNumber ? {
        identity_documents: [{
          type:            "passport",
          unique_identifier: p.passportNumber,
          expires_on:      p.passportExpiry ?? "2030-01-01",
          issuing_country_code: p.nationality ?? "IN",
        }],
      } : {}),
    }));

    const order = await this.client.post<{
      id: string; booking_reference: string; documents?: { unique_identifier: string }[];
    }>("/air/orders", {
      data: {
        selected_offers:   [params.fareId],
        passengers,
        payments: [{
          type:     "balance",
          currency: "INR",
          amount:   "0",          // Duffel deducts from account balance in test mode
        }],
      },
    });

    return {
      success:       true,
      bookingRef:    order.id,
      pnr:           order.booking_reference,
      status:        "CONFIRMED",
      ticketNumbers: (order.documents ?? []).map((d) => d.unique_identifier),
      raw:           order,
    };
  }

  async cancel(bookingRef: string): Promise<CancelResult> {
    const result = await this.client.post<{ refund_amount: string; refund_currency: string }>(
      `/air/order_cancellations`,
      { data: { order_id: bookingRef } },
    );

    return {
      success:      true,
      refundAmount: parseFloat(result.refund_amount ?? "0"),
      penalty:      0,
      status:       "CANCELLED",
    };
  }

  private async getOffer(offerId: string): Promise<NormalizedFare> {
    const offer = await this.client.get<DuffelOffer>(`/air/offers/${offerId}`);
    return normalizeDuffelOffer(offer, "INR");
  }

  private mapCabin(c: string): string {
    const m: Record<string, string> = {
      ECONOMY: "economy", PREMIUM_ECONOMY: "premium_economy",
      BUSINESS: "business_class", FIRST: "first_class",
    };
    return m[c] ?? "economy";
  }
}
