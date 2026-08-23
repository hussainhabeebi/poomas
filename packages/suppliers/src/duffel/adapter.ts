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
    const slices: unknown[] = [
      {
        origin:         params.origin,
        destination:    params.destination,
        departure_date: params.departureDate,
      },
    ];

    if (params.tripType === "ROUNDTRIP" && params.returnDate) {
      slices.push({
        origin:         params.destination,
        destination:    params.origin,
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

    // Duffel's return_offers and supplier_timeout are QUERY parameters, not body fields.
    // Keeping return_offers=false lets us page/sort through /air/offers afterwards.
    const offerRequest = await this.client.post<{ id: string }>(
      "/air/offer_requests",
      {
        data: {
          slices,
          passengers,
          cabin_class: this.mapCabin(params.cabinClass),
        },
      },
      {
        return_offers: "false",
        supplier_timeout: "10000",
        view: "offers",
      },
    );

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
    // Duffel offers themselves are the holdable resource until their expires_at.
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return {
      success:      true,
      holdId:       params.fareId,
      expiresAt,
      fareSnapshot: await this.getOffer(params.fareId),
    };
  }

  async book(params: BookParams): Promise<BookResult> {
    const passengers = params.passengers.map((p) => ({
      type:         p.type === "ADULT" ? "adult" : p.type === "CHILD" ? "child" : "infant_without_seat",
      given_name:   p.firstName,
      family_name:  p.lastName,
      born_on:      p.dob,
      gender:       (p.gender?.toLowerCase() ?? "m") === "m" ? "m" : "f",
      email:        params.contactEmail,
      phone_number: params.contactPhone,
      ...(p.passportNumber ? {
        identity_documents: [{
          type:                    "passport",
          unique_identifier:       p.passportNumber,
          expires_on:              p.passportExpiry,
          issuing_country_code:    p.nationality ?? "IN",
        }],
      } : {}),
    }));

    // NOTE: payment amount/currency must be built from the selected offer before live ticketing.
    // Search is fully wired; order creation remains guarded against fake zero-value payments.
    const offer = await this.client.get<DuffelOffer>(`/air/offers/${params.fareId}`);
    const totalAmount = (offer as unknown as { total_amount?: string }).total_amount;
    const totalCurrency = (offer as unknown as { total_currency?: string }).total_currency;
    if (!totalAmount || !totalCurrency) {
      throw new Error("Duffel: selected offer is missing total amount/currency");
    }

    const order = await this.client.post<{
      id: string; booking_reference: string; documents?: { unique_identifier: string }[];
    }>("/air/orders", {
      data: {
        selected_offers: [params.fareId],
        passengers,
        payments: [{
          type:     "balance",
          currency: totalCurrency,
          amount:   totalAmount,
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
      "/air/order_cancellations",
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
      ECONOMY: "economy",
      PREMIUM_ECONOMY: "premium_economy",
      BUSINESS: "business",
      FIRST: "first",
    };
    return m[c] ?? "economy";
  }
}
