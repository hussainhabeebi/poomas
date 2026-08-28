import type { SearchParams, HoldParams, BookParams, SupplierCredentials } from "../base.js";
import { SupplierError } from "../riya/client.js";

export class TripjackClient {
  private baseUrl: string;
  private apiKey:  string;
  private proxyKey: string;

  constructor(creds: SupplierCredentials) {
    this.baseUrl = ((creds.baseUrl as string) ?? process.env.TRIPJACK_API_BASE_URL ?? "").replace(/\/$/, "");
    this.apiKey  = (creds.apiKey   as string) ?? process.env.TRIPJACK_API_KEY      ?? "";
    this.proxyKey = (creds.proxyKey as string) ?? process.env.TRIPJACK_PROXY_KEY ?? "";
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    if (!this.baseUrl || (!this.apiKey && !this.proxyKey)) {
      throw new Error("TripJack is enabled but its gateway or API credentials are missing");
    }

    const res = await fetch(`${this.baseUrl}${path}`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.apiKey ? { "apikey": this.apiKey } : {}),
        ...(this.proxyKey ? { "X-Poomas-Gateway-Key": this.proxyKey } : {}),
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[tripjack] ${path} failed with HTTP ${res.status}`, text.slice(0, 1000));
      const safeMessage = res.status === 401 || res.status === 403
        ? "Authentication or proxy IP whitelist rejected"
        : res.status === 404
          ? "Proxy route or TripJack base URL was not found"
          : res.status === 429
            ? "Rate limit exceeded"
            : "Upstream request failed";
      throw new SupplierError("TRIPJACK", res.status, safeMessage);
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

