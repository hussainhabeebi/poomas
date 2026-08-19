import type {
  SupplierAdapter, SearchParams, NormalizedFare, SupplierCredentials,
} from "../base.js";

// Google Flights SERP API — search only, never bookable.
// Used as last-resort fallback in Leadvyne WhatsApp flow.
// Always returns isBookable: false. Any conversion to booking goes via human agent.
export class SerpAdapter implements SupplierAdapter {
  readonly name = "GOOGLE_SERP" as const;
  private apiKey: string;
  private baseUrl: string;

  constructor(credentials: SupplierCredentials) {
    this.apiKey  = (credentials.apiKey  as string) ?? process.env.SERP_API_KEY      ?? "";
    this.baseUrl = (credentials.baseUrl as string) ?? process.env.SERP_API_BASE_URL ?? "https://serpapi.com";
  }

  async search(params: SearchParams): Promise<NormalizedFare[]> {
    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set("engine",          "google_flights");
    url.searchParams.set("departure_id",    params.origin);
    url.searchParams.set("arrival_id",      params.destination);
    url.searchParams.set("outbound_date",   params.departureDate);
    if (params.returnDate) url.searchParams.set("return_date", params.returnDate);
    url.searchParams.set("adults",          String(params.adults));
    url.searchParams.set("travel_class",    this.mapCabin(params.cabinClass));
    url.searchParams.set("currency",        params.currency);
    url.searchParams.set("api_key",         this.apiKey);
    url.searchParams.set("no_cache",        "false");  // Use SERP cache aggressively to save costs

    const res = await fetch(url.toString());
    if (!res.ok) return [];

    const data = await res.json() as { best_flights?: unknown[]; other_flights?: unknown[] };
    const flights = [...(data.best_flights ?? []), ...(data.other_flights ?? [])];
    return flights.slice(0, 10).map((f) => this.normalizeSerpFare(f as Record<string, unknown>));
  }

  private normalizeSerpFare(f: Record<string, unknown>): NormalizedFare {
    const legs = (f.flights as Record<string, unknown>[])?.[0] ?? {};
    return {
      id:            `serp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      supplier:      "GOOGLE_SERP",
      isBookable:    false,  // CRITICAL: SERP results are never directly bookable
      airline:       legs.airline as string ?? "",
      airlineName:   legs.airline as string ?? "",
      flightNumber:  legs.flight_number as string ?? "",
      origin:        (legs.departure_airport as Record<string, string>)?.id ?? "",
      destination:   (legs.arrival_airport   as Record<string, string>)?.id ?? "",
      departureTime: (legs.departure_airport as Record<string, string>)?.time ?? "",
      arrivalTime:   (legs.arrival_airport   as Record<string, string>)?.time ?? "",
      duration:      f.total_duration as number ?? 0,
      stops:         (f.flights as unknown[]).length - 1,
      stopDetails:   [],
      cabinClass:    "ECONOMY",
      baseFare:      f.price as number ?? 0,
      taxes:         0,
      totalFare:     f.price as number ?? 0,
      currency:      "INR",
      isRefundable:  false,
      baggage:       { cabin: "7 KG", checked: "Not included" },
      fareClass:     "",
      raw:           f,
    };
  }

  private mapCabin(cabin: string): string {
    const map: Record<string, string> = {
      ECONOMY:         "1",
      PREMIUM_ECONOMY: "2",
      BUSINESS:        "3",
      FIRST:           "4",
    };
    return map[cabin] ?? "1";
  }
}
