import type { SearchParams, HoldParams, BookParams, SupplierCredentials } from "../base.js";
import { SupplierError } from "../riya/client.js";

export class TripjackClient {
  private baseUrl: string;
  private apiKey:  string;

  constructor(creds: SupplierCredentials) {
    this.baseUrl = (creds.baseUrl  as string) ?? process.env.TRIPJACK_API_BASE_URL ?? "";
    this.apiKey  = (creds.apiKey   as string) ?? process.env.TRIPJACK_API_KEY      ?? "";
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey":        this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new SupplierError("TRIPJACK", res.status, text);
    }

    return res.json() as Promise<T>;
  }

  async search(params: SearchParams) {
    return this.request("/air-search-all/v2", {
      searchQuery: {
        cabinClass:    params.cabinClass.charAt(0),  // Tripjack uses E/B/F
        paxInfo: {
          ADULT:  params.adults,
          CHILD:  params.children,
          INFANT: params.infants,
        },
        routeInfos: [
          {
            fromCityOrAirport: { code: params.origin },
            toCityOrAirport:   { code: params.destination },
            travelDate:        params.departureDate,
          },
        ],
        searchModifiers: { isDirectFlight: false },
      },
    });
  }

  async fareRules(fareId: string, sessionId?: string) {
    return this.request("/air-fare-detail/v2", { id: fareId, flowType: "SEARCH" });
  }

  async book(params: HoldParams & BookParams) {
    return this.request("/air-book/v2", {
      bookingId:  params.holdId,
      deliveryInfo: {
        emails:  [params.contactEmail],
        mobiles: [{ countryCode: "+91", number: params.contactPhone }],
      },
    });
  }

  async pnrStatus(pnr: string) {
    return this.request("/air-booking-detail/v2", { id: pnr, type: "PNR" });
  }

  async cancel(bookingRef: string) {
    return this.request("/air-cancel/v2", { bookingId: bookingRef });
  }
}
