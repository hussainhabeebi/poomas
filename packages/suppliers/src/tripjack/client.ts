import type { SearchParams, HoldParams, BookParams, SupplierCredentials } from "../base.js";
import type { HotelSearchParams, HotelBookParams } from "./hotel-types.js";
import { SupplierError } from "../riya/client.js";
import { reviewFailure, TripjackReviewError } from "./review-error.js";

/** Convert YYYY-MM-DD to TripJack's required dd-MM-yyyy format. */
function toTripjackDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}-${m}-${y}`;
}

export class TripjackClient {
  private baseUrl: string;
  private apiKey:  string;
  private proxyKey: string;

  constructor(creds: SupplierCredentials) {
    this.baseUrl = ((creds.baseUrl as string) ?? process.env.TRIPJACK_API_BASE_URL ?? "").replace(/\/$/, "");
    this.apiKey  = (creds.apiKey   as string) ?? process.env.TRIPJACK_API_KEY      ?? "";
    this.proxyKey = (creds.proxyKey as string) ?? process.env.TRIPJACK_PROXY_KEY ?? "";
  }

  private async request<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
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
      signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (path === "/fms/v1/review") {
        let detail: unknown = null;
        try { detail = JSON.parse(text); } catch { /* Route/proxy HTML is not fare expiry. */ }
        throw reviewFailure(res.status, detail, crypto.randomUUID());
      }
      if (path === "/air-book/v2") {
        console.error(`[tripjack] ${path} failed with HTTP ${res.status}`, text.slice(0, 500));
        let bookDetail: unknown = null;
        try { bookDetail = JSON.parse(text); } catch {}
        const statusMsg = String((bookDetail as any)?.status?.statusMessage ?? "").toLowerCase();
        if (/expir|no longer available|booking session/i.test(statusMsg)) {
          throw new SupplierError("TRIPJACK", 409, "Booking session expired");
        }
      } else console.error(`[tripjack] ${path} failed with HTTP ${res.status}`, text.slice(0, 1000));
      const safeMessage = res.status === 401 || res.status === 403
        ? "Authentication or proxy IP whitelist rejected"
        : res.status === 404
          ? "TripJack route is unavailable"
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
    return this.request("/fms/v2/farerule", { id: fareId, flowType: "SEARCH" });
  }

  async validateFare(fareId: string) {
    const requestId = crypto.randomUUID();
    try {
      const raw = await this.request<any>("/fms/v1/review", { priceIds: [fareId] }, AbortSignal.timeout(15000));
      const result = raw?.data ?? raw?.result ?? raw;
      if (raw?.status?.success === false || result?.status?.success === false || result?.errors?.length) {
        throw reviewFailure(200, raw?.status?.success === false ? raw : result, requestId);
      }
      const bookingId = result?.bookingId;
      if (typeof bookingId !== "string" || !bookingId.trim()) {
        throw new TripjackReviewError("REVIEW_INVALID_RESPONSE", 502, requestId);
      }
      return { bookingId, result };
    } catch (err) {
      if (err instanceof TripjackReviewError) throw err;
      const code = err instanceof Error && /TimeoutError|AbortError/.test(err.name) ? "REVIEW_TIMEOUT" : "REVIEW_UNAVAILABLE";
      console.error("[tripjack-review]", JSON.stringify({ requestId, code }));
      throw new TripjackReviewError(code, 503, requestId);
    }
  }

  async book(params: HoldParams & BookParams) {
    const phone = params.contactPhone.replace(/\D/g, "");
    // TripJack contacts format: E.164 string e.g. "+919500112233"
    const contact = phone.length > 10 ? `+${phone}` : `+91${phone.slice(-10)}`;

    const travellerInfo = params.passengers.map((p) => ({
      // TripJack titles: Adult → Mr/Ms, Child/Infant → Master/Ms
      ti:  p.type !== "ADULT" ? (p.gender === "F" ? "Ms" : "Master") : (p.gender === "F" ? "Ms" : "Mr"),
      fN:  p.firstName,
      lN:  p.lastName,
      // TripJack requires full words: ADULT, CHILD, INFANT
      pt:  p.type,
      ...(p.dob            ? { dob: p.dob }                              : {}),
      ...(p.passportNumber ? { pNum: p.passportNumber }                  : {}),
      ...(p.passportExpiry ? { eD: p.passportExpiry }                    : {}),
      ...(p.nationality    ? { pNat: p.nationality }                     : {}),
    }));

    return this.request("/oms/v1/air/book", {
      bookingId: params.holdId,
      ...(params.paymentAmount != null ? { paymentInfos: [{ amount: params.paymentAmount }] } : {}),
      deliveryInfo: {
        emails:   [params.contactEmail],
        contacts: [contact],
      },
      travellerInfo,
    }, AbortSignal.timeout(45000));
  }

  async pnrStatus(bookingId: string) {
    return this.request("/oms/v1/booking-details", { bookingId });
  }

  async cancel(bookingRef: string) {
    return this.request("/oms/v1/air/amendment/submit-amendment", {
      bookingId: bookingRef,
      type:      "CANCELLATION",
      remarks:   "Customer requested cancellation",
    });
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
