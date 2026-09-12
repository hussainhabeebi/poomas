import type { SearchParams, HoldParams, BookParams, SupplierCredentials } from "../base.js";
import type { HotelSearchParams, HotelBookParams } from "./hotel-types.js";
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
          ? (path.includes("book") ? "Fare has expired — please search again and book quickly" : "TripJack route not found")
          : res.status === 429
            ? "Rate limit exceeded"
            : "Upstream request failed";
      throw new SupplierError("TRIPJACK", res.status, safeMessage);
    }

    return res.json() as Promise<T>;
  }

  // ── Flights ─────────────────────────────────────────────────────

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

  async validateFare(fareId: string) {
    return this.request("/air-fare-detail/v2", { id: fareId, flowType: "BOOK" });
  }

  async book(params: HoldParams & BookParams) {
    const travellerInfo = params.passengers.map((p) => ({
      ti:   p.gender === "F" ? "Ms" : "Mr",
      fN:   p.firstName,
      lN:   p.lastName,
      pt:   p.type,
      dob:  p.dob,
      pNum: p.passportNumber,
      eD:   p.passportExpiry,
      pid:  p.nationality ?? "IN",
    }));

    return this.request("/air-book/v2", {
      bookingId:  params.holdId,
      deliveryInfo: {
        emails:  [params.contactEmail],
        mobiles: [{ countryCode: "+91", number: params.contactPhone }],
      },
      travellerInfo,
    });
  }

  async pnrStatus(pnr: string) {
    return this.request("/air-booking-detail/v2", { id: pnr, type: "PNR" });
  }

  async cancel(bookingRef: string) {
    return this.request("/air-cancel/v2", { bookingId: bookingRef });
  }

  // ── Hotels ──────────────────────────────────────────────────────

  async hotelSearch(params: HotelSearchParams) {
    return this.request("/hotel-search/v1", {
      searchQuery: {
        checkinDate:  params.checkIn,
        checkoutDate: params.checkOut,
        roomInfo:     params.rooms.map((r) => ({
          numberOfAdults: r.adults,
          numberOfChild:  r.children,
          childAge:       r.childAges ?? [],
        })),
        searchCriteria: {
          city:        params.cityCode,
          nationality: params.nationality,
          currency:    params.currency,
        },
        searchPreferences: {
          ratings:       params.ratings ?? [],
          freeBreakfast: params.freeBreakfast ?? false,
          freeCancel:    params.freeCancel    ?? false,
        },
      },
    });
  }

  async hotelPreBook(optionId: string) {
    return this.request("/hotel-prebook/v1", { optionId, fieldType: "DETAIL" });
  }

  async hotelBook(params: HotelBookParams) {
    return this.request("/hotel-book/v1", {
      optionId: params.optionId,
      travellerInfo: params.guests.map((g) => ({
        ti:       g.title,
        fN:       g.firstName,
        lN:       g.lastName,
        pt:       g.type,
        age:      g.age,
        roomIndex: g.roomIndex,
      })),
      deliveryInfo: {
        emails:  [params.contactEmail],
        mobiles: [{ countryCode: "+91", number: params.contactPhone }],
      },
    });
  }

  async hotelBookingDetail(bookingId: string) {
    return this.request("/hotel-booking-detail/v1", { bookingId });
  }

  async hotelCancel(bookingId: string) {
    return this.request("/hotel-cancel/v1", { bookingId });
  }
}
