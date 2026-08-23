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
    this.apiKey  = (credentials.apiKey  as string) || "";
    this.baseUrl = (credentials.baseUrl as string) || "https://serpapi.com";
  }

  async search(params: SearchParams): Promise<NormalizedFare[]> {
    if (!this.apiKey) throw new Error("SERP: apiKey not configured");

    const url = new URL(`${this.baseUrl}/search`);
    url.searchParams.set("engine",        "google_flights");
    url.searchParams.set("departure_id",  params.origin);
    url.searchParams.set("arrival_id",    params.destination);
    url.searchParams.set("outbound_date", params.departureDate);
    if (params.returnDate) url.searchParams.set("return_date", params.returnDate);
    url.searchParams.set("adults",        String(params.adults));
    url.searchParams.set("travel_class",  this.mapCabin(params.cabinClass));
    url.searchParams.set("currency",      params.currency);
    url.searchParams.set("api_key",       this.apiKey);
    url.searchParams.set("no_cache",      "false");

    const res = await fetch(url.toString());
    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText);
      throw new Error(`SERP ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = await res.json() as { best_flights?: unknown[]; other_flights?: unknown[] };
    const flights = [...(data.best_flights ?? []), ...(data.other_flights ?? [])];
    return flights.slice(0, 15).map((f) => this.normalizeSerpFare(f as Record<string, unknown>, params.currency));
  }

  private normalizeSerpFare(f: Record<string, unknown>, currency: string): NormalizedFare {
    const segments  = (f.flights as Record<string, unknown>[]) ?? [];
    const firstLeg  = segments[0] ?? {};
    const lastLeg   = segments[segments.length - 1] ?? firstLeg;
    const depAirport = firstLeg.departure_airport as Record<string, string> ?? {};
    const arrAirport = lastLeg.arrival_airport    as Record<string, string> ?? {};

    return {
      id:            `serp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      supplier:      "GOOGLE_SERP",
      isBookable:    false,
      airline:       firstLeg.airline_logo as string ?? firstLeg.airline as string ?? "",
      airlineName:   firstLeg.airline as string ?? "",
      flightNumber:  firstLeg.flight_number as string ?? "",
      origin:        depAirport.id ?? params.origin ?? "",
      destination:   arrAirport.id ?? "",
      // SerpAPI returns "2024-01-15 10:30" — add T to make it valid ISO 8601
      departureTime: (depAirport.time ?? "").replace(" ", "T"),
      arrivalTime:   (arrAirport.time ?? "").replace(" ", "T"),
      duration:      f.total_duration as number ?? 0,
      stops:         Math.max(0, segments.length - 1),
      stopDetails:   [],
      cabinClass:    "ECONOMY",
      baseFare:      f.price as number ?? 0,
      taxes:         0,
      totalFare:     f.price as number ?? 0,
      currency,
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
