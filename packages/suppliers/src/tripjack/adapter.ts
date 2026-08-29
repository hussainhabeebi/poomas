import type {
  SupplierAdapter, SearchParams, NormalizedFare, HoldParams, HoldResult,
  BookParams, BookResult, PNRStatusResult, CancelResult, SupplierCredentials, FareRule,
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
    const response = ((raw.data ?? raw.result ?? raw) as Record<string, unknown>);
    const status = response.status as { success?: boolean } | undefined;
    if (status?.success === false) {
      throw new Error("TripJack rejected the flight search request");
    }

    const searchResult = response.searchResult as { tripInfos?: Record<string, Record<string, unknown>[]> } | undefined;
    if (!searchResult?.tripInfos) {
      throw new Error("TripJack returned an unrecognized flight-search response");
    }

    const trips = searchResult.tripInfos["ONWARD"] ?? [];
    return trips.map(normalizeTripjackFare);
  }

  async getFareRules(fareId: string): Promise<FareRule[]> {
    const raw = await this.client.fareRules(fareId) as { fareRule?: Record<string, { fareRestrictions?: unknown[] }> };
    const rules = raw?.fareRule?.["DEFAULT"]?.fareRestrictions ?? [];
    return (rules as { policyInfo?: string; type?: string }[]).map((r) => ({
      category:    r.type ?? "General",
      description: r.policyInfo ?? "",
    }));
  }

  async hold(_params: HoldParams): Promise<HoldResult> {
    // Tripjack uses session-based booking — hold is implicit in the session
    throw new Error("Tripjack does not support explicit hold — proceed directly to book");
  }

  async book(params: BookParams): Promise<BookResult> {
    const raw = await this.client.book(params as HoldParams & BookParams) as Record<string, unknown>;
    return {
      success:       (raw.status as { success?: boolean })?.success ?? false,
      bookingRef:    raw.bookingId as string,
      pnr:           raw.pnrDetails as string,
      status:        "CONFIRMED",
      ticketNumbers: [],
      raw,
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

