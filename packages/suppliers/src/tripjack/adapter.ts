import type {
  SupplierAdapter, SearchParams, NormalizedFare, HoldParams, HoldResult,
  BookParams, BookResult, PNRStatusResult, CancelResult, SupplierCredentials, FareRule, RevalidateResult,
} from "../base.js";
import { TripjackClient } from "./client.js";
import { normalizeTripjackFare } from "./normalizer.js";

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
    const status = response.status as { success?: boolean } | undefined;
    if (status?.success === false) {
      throw new Error("TripJack rejected the flight search request");
    }

    const searchResult = response.searchResult as { tripInfos?: Record<string, unknown[]> } | undefined;
    if (!searchResult?.tripInfos) {
      throw new Error("TripJack returned an unrecognized flight-search response");
    }

    const trips = searchResult.tripInfos["ONWARD"] ?? [];
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
    const raw = await this.client.fareRules(fareId) as { fareRule?: Record<string, { fareRestrictions?: unknown[] }> };
    const rules = raw?.fareRule?.["DEFAULT"]?.fareRestrictions ?? [];
    return (rules as { policyInfo?: string; type?: string }[]).map((r) => ({
      category:    r.type ?? "General",
      description: r.policyInfo ?? "",
    }));
  }

  async revalidate(fareId: string): Promise<RevalidateResult> {
    const raw = await this.client.review(fareId) as Record<string, unknown>;
    const response = (raw.data ?? raw.result ?? raw) as Record<string, unknown>;
    const status = response.status as { success?: boolean; statusMessage?: string } | undefined;
    if (status?.success === false) {
      throw new Error(status.statusMessage || "TripJack could not revalidate this fare");
    }

    const bookingId = String(response.bookingId ?? "");
    if (!bookingId) throw new Error("TripJack review did not return a booking ID");

    const price = response.totalPriceInfo as {
      fd?: { fC?: { BF?: number; TAF?: number; TF?: number } };
    } | undefined;
    const components = price?.fd?.fC;

    return {
      success: true,
      fareId,
      bookingId,
      baseFare: components?.BF,
      taxes: components?.TAF,
      totalFare: components?.TF,
      currency: String(response.currency ?? "INR"),
      raw: response,
    };
  }

  async hold(_params: HoldParams): Promise<HoldResult> {
    // Tripjack uses session-based booking — hold is implicit in the session
    throw new Error("Tripjack does not support explicit hold — proceed directly to book");
  }

  async book(params: BookParams): Promise<BookResult> {
    const raw = await this.client.book(params as HoldParams & BookParams) as Record<string, unknown>;
    const response = (raw.data ?? raw.result ?? raw) as Record<string, unknown>;
    return {
      success:       (response.status as { success?: boolean })?.success ?? false,
      bookingRef:    String(response.bookingId ?? params.holdId),
      pnr:           String(response.pnrDetails ?? response.pnr ?? ""),
      status:        "CONFIRMED",
      ticketNumbers: [],
      raw: response,
    };
  }

  async getPNRStatus(pnr: string): Promise<PNRStatusResult> {
    const raw = await this.client.pnrStatus(pnr) as Record<string, unknown>;
    return {
      pnr,
      status:     raw.status as string,
      passengers: [],
      itinerary:  raw.itemInfos,
    };
  }

  async cancel(bookingRef: string): Promise<CancelResult> {
    const raw = await this.client.cancel(bookingRef) as Record<string, unknown>;
    return {
      success:      (raw.status as { success?: boolean })?.success ?? false,
      refundAmount: raw.refundAmount as number ?? 0,
      penalty:      raw.cancellationCharge as number ?? 0,
      status:       (raw.status as { statusMessage?: string })?.statusMessage ?? "",
    };
  }
}
