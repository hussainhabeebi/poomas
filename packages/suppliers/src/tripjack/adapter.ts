import type {
  SupplierAdapter, SearchParams, NormalizedFare, HoldParams, HoldResult,
  BookParams, BookResult, PNRStatusResult, CancelResult, SupplierCredentials, FareRule, RevalidateResult,
} from "../base.js";
import { TripjackClient } from "./client.js";
import { normalizeTripjackFare } from "./normalizer.js";
import { TripjackReviewError } from "./review-error.js";

export class TripjackAdapter implements SupplierAdapter {
  readonly name = "TRIPJACK" as const;
  private client: TripjackClient;

  constructor(credentials: SupplierCredentials) {
    this.client = new TripjackClient(credentials);
  }

  async search(params: SearchParams): Promise<NormalizedFare[]> {
    const raw = await this.client.search(params) as Record<string, unknown>;
    // Some whitelisted proxies wrap the upstream JSON in `data` or `result`.
    const response = (raw.data ?? raw.result ?? raw) as Record<string, unknown>;
    const status = response.status as { success?: boolean; statusMessage?: string } | undefined;
    if (status?.success === false) {
      console.error("[tripjack-search] rejected:", JSON.stringify({ status, keys: Object.keys(response) }));
      throw Object.assign(
        new Error(`TripJack rejected the flight search request: ${status?.statusMessage ?? "unknown reason"}`),
        { code: "SEARCH_REJECTED", responseSnippet: safeSnippet(response) },
      );
    }

    const searchResult = response.searchResult as { tripInfos?: Record<string, unknown[]> } | undefined;
    if (!searchResult?.tripInfos) {
      console.error("[tripjack-search] unrecognized response structure:", JSON.stringify({ topKeys: Object.keys(response), hasSearchResult: !!response.searchResult }));
      throw Object.assign(
        new Error("TripJack returned an unrecognized flight-search response"),
        { code: "SEARCH_INVALID_RESPONSE", responseSnippet: safeSnippet(response) },
      );
    }

    // TripJack keys one-way results as "ONWARD" in v2, but some proxy/API versions
    // key by route string (e.g. "DEL-DXB") or another label. "ONWARD" may also be
    // present as an empty array [] rather than undefined, so ?? alone isn't enough —
    // check for a non-empty array explicitly before falling back.
    const onwardKey = searchResult.tripInfos["ONWARD"];
    const tripInfoKeys = Object.keys(searchResult.tripInfos);
    const trips: unknown[] =
      (Array.isArray(onwardKey) && onwardKey.length > 0 ? onwardKey : null) ??
      Object.values(searchResult.tripInfos).find((v) => Array.isArray(v) && v.length > 0) ??
      [];
    console.info(`[tripjack-search] tripInfos keys=${JSON.stringify(tripInfoKeys)} trips=${trips.length}`);
    // TripJack puts the bookable fare id and price inside totalPriceList, not
    // on the itinerary wrapper. Expand every price option so the client receives
    // the real id required by fare rules and checkout instead of an empty id.
    return trips.flatMap((trip) => {
      const row = trip as Record<string, unknown>;
      const prices = Array.isArray(row.totalPriceList) ? row.totalPriceList as Record<string, unknown>[] : [];
      if (!prices.length) return [normalizeTripjackFare(row)];
      return prices.map((price) => normalizeTripjackFare({
        ...row,
        ...price,
        id: price.id,
        totalPriceInfo: price,
      }));
    });
  }

  async getFareRules(fareId: string): Promise<FareRule[]> {
    const raw = await this.client.fareRules(fareId) as any;
    // v2 farerule returns tfr (timed fare rule) keyed by policy type
    const tfr = raw?.fareRules?.tfr ?? raw?.fareRule?.DEFAULT?.fareRestrictions;
    if (Array.isArray(tfr)) {
      return (tfr as { policyInfo?: string; type?: string }[]).map((r) => ({
        category:    r.type ?? "General",
        description: r.policyInfo ?? "",
      }));
    }
    // tfr is keyed by policy type (CANCELLATION, DATECHANGE, etc.)
    if (tfr && typeof tfr === "object") {
      return Object.entries(tfr).flatMap(([category, policies]) =>
        (Array.isArray(policies) ? policies : []).map((r: any) => ({
          category,
          description: r.policyInfo ?? String(r.amount ?? ""),
        })),
      );
    }
    return [];
  }

  async revalidate(fareId: string): Promise<RevalidateResult> {
    try {
      const { bookingId, result } = await this.client.validateFare(fareId);
      const response = (result as any)?.data ?? (result as any)?.result ?? result as Record<string, unknown>;
      const price = (response as any).totalPriceInfo as {
        fd?: { fC?: { BF?: number; TAF?: number; TF?: number }; ADULT?: { fC?: { BF?: number; TAF?: number; TF?: number } } };
      } | undefined;
      // TripJack v2: fd keyed by pax type (fd.ADULT.fC) or flat (fd.fC)
      const components = price?.fd?.fC ?? price?.fd?.ADULT?.fC;
      return {
        success: true,
        fareId,
        bookingId,
        baseFare: components?.BF,
        taxes: components?.TAF,
        totalFare: components?.TF,
        currency: String((response as any).currency ?? "INR"),
        raw: response,
      };
    } catch (err) {
      if (err instanceof TripjackReviewError) {
        throw new Error(err.message || "TripJack could not revalidate this fare");
      }
      throw err;
    }
  }

  async hold(_params: HoldParams): Promise<HoldResult> {
    // Tripjack uses session-based booking — hold is implicit in the session
    throw new Error("Tripjack does not support explicit hold — proceed directly to book");
  }

  async book(params: BookParams): Promise<BookResult> {
    const raw = await this.client.book(params as HoldParams & BookParams) as Record<string, unknown>;
    const response = (raw.data ?? raw.result ?? raw) as Record<string, unknown>;
    const order = (response.order ?? response) as Record<string, unknown>;
    const travellers = (response.travellerInfos ?? []) as Array<Record<string, unknown>>;
    const pnrMap = travellers[0]?.pnrDetails as Record<string, string> | undefined;
    const pnr = pnrMap ? Object.values(pnrMap)[0] ?? "" : String(response.pnrDetails ?? "");
    const bookingRef = String(order.bookingId ?? response.bookingId ?? params.holdId);
    const orderStatus = String(order.status ?? "").toUpperCase();
    return {
      success:       orderStatus === "SUCCESS" || orderStatus === "ON_HOLD" || !!(pnr || bookingRef !== params.holdId),
      bookingRef,
      pnr,
      status:        orderStatus === "SUCCESS" || orderStatus === "ON_HOLD" ? "CONFIRMED" : "FAILED",
      ticketNumbers: [],
      raw: response,
    };
  }

  async getPNRStatus(bookingId: string): Promise<PNRStatusResult> {
    const raw = await this.client.pnrStatus(bookingId) as Record<string, unknown>;
    // booking-details wraps response in order{}
    const order = (raw.order ?? raw) as Record<string, unknown>;
    const travellers = (raw.travellerInfos ?? []) as Array<Record<string, unknown>>;
    const pnrMap = travellers[0]?.pnrDetails as Record<string, string> | undefined;
    const pnr = pnrMap ? Object.values(pnrMap)[0] ?? "" : "";
    return {
      pnr,
      status:     String(order.status ?? ""),
      passengers: travellers.map((t) => ({
        name:         `${t.fN ?? ""} ${t.lN ?? ""}`.trim(),
        ticketNumber: Object.values((t.ticketNumberDetails as Record<string, string>) ?? {})[0] ?? "",
        status:       String(order.status ?? ""),
      })),
      itinerary: raw.tripInfos ?? raw.itemInfos,
    };
  }

  async cancel(bookingRef: string): Promise<CancelResult> {
    const raw = await this.client.cancel(bookingRef) as Record<string, unknown>;
    // submit-amendment returns amendmentId; success means amendment was accepted
    const success = !!(raw.amendmentId) || (raw.status as any)?.success === true;
    return {
      success,
      refundAmount: raw.refundableAmount as number ?? 0,
      penalty:      raw.amendmentCharges as number ?? 0,
      status:       raw.amendmentId ? "CANCELLATION_REQUESTED" : String((raw.status as any)?.statusMessage ?? ""),
    };
  }
}

function safeSnippet(value: unknown): string {
  try { return JSON.stringify(value).slice(0, 800); } catch { return ""; }
}
