import type { SearchParams, HoldParams, BookParams, SupplierCredentials } from "../base.js";
import type { HotelSearchParams, HotelBookParams } from "./hotel-types.js";
import { SupplierError } from "../riya/client.js";
import { normalizeTripjackFare } from "./normalizer.js";

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
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[tripjack] ${path} failed with HTTP ${res.status}`);
      const safeMessage = res.status === 401 || res.status === 403
        ? "Authentication or proxy IP whitelist rejected"
        : res.status === 404
          ? "TripJack route unavailable; the gateway configuration needs checking"
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
        cabinClass:    params.cabinClass,
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
    const raw = await this.request<Record<string, any>>("/fms/v1/review", { priceIds: [fareId] });
    const result = raw.data ?? raw.result ?? raw;
    if (result.status?.success !== true || typeof result.bookingId !== "string" || !result.bookingId) {
      throw new SupplierError("TRIPJACK", 502, "Unable to verify this fare with the airline. Please retry the fare check.");
    }
    const amount = Number(result.totalPriceInfo?.totalFareDetail?.fC?.TF);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new SupplierError("TRIPJACK", 502, "Airline review did not return a valid total price");
    }
    const trip = result.tripInfos?.[0];
    if (!trip?.sI?.length) throw new SupplierError("TRIPJACK", 502, "Airline review did not return an itinerary");
    const fare = normalizeTripjackFare({ ...trip, id: fareId,
      totalPriceInfo: { fd: result.totalPriceInfo.totalFareDetail } });
    return { bookingId: result.bookingId as string, totalFare: amount, currency: "INR" as const, fare };
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
