import { cookies } from "next/headers";

type SearchParams = {
  origin?: string; destination?: string; departureDate?: string;
  returnDate?: string; adults?: string; cabinClass?: string;
  tripType?: string; currency?: "INR" | "AED" | "USD";
};

type SearchResult = {
  fares: unknown[];
  isIndicative: boolean;
  disclaimer?: string;
  usedSuppliers?: string[];
  availableSuppliers?: string[];
  credentialAvailability?: Record<string, boolean>;
  supplierErrors?: Record<string, string>;
  apiError?: string;
};

const CURRENCY_SYMBOLS: Record<string, string> = { INR: "₹", AED: "د.إ", USD: "$" };

interface SearchPageProps { searchParams: Promise<SearchParams>; }

async function searchFlights(params: SearchParams, sessionId: string | null): Promise<SearchResult> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";

    const res = await fetch(`${apiUrl}/api/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tenant-slug": "poomas",
        ...(sessionId ? { "X-Session-ID": sessionId } : {}),
      },
      body: JSON.stringify({
        origin:        params.origin,
        destination:   params.destination,
        departureDate: params.departureDate,
        returnDate:    params.returnDate,
        adults:        parseInt(params.adults ?? "1"),
        children:      0,
        infants:       0,
        cabinClass:    params.cabinClass ?? "ECONOMY",
        tripType:      params.tripType ?? "ONEWAY",
        ...(params.currency ? { currency: params.currency } : {}),
      }),
      cache: "no-store",
    });

    const data = await res.json().catch(() => null) as SearchResult | { error?: string } | null;
    if (!res.ok) {
      return {
        fares: [],
        isIndicative: false,
        apiError: (data && "error" in data ? data.error : undefined) ?? `Search API returned ${res.status}`,
      };
    }
    return data as SearchResult;
  } catch (err) {
    return {
      fares: [],
      isIndicative: false,
      apiError: err instanceof Error ? err.message : "Search API unavailable",
    };
  }
}

export default async function SearchResultsPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  let sessionId: string | null = null;
  try { const s = await cookies(); sessionId = s.get("sid")?.value ?? null; } catch {}

  const result   = await searchFlights(params, sessionId);
  const currency = params.currency ?? "INR";
  const symbol   = CURRENCY_SYMBOLS[currency] ?? "₹";
  const failingSuppliers = Object.keys(result.supplierErrors ?? {});
  const missingCredentialSuppliers = Object.entries(result.credentialAvailability ?? {})
    .filter(([, ok]) => !ok)
    .map(([name]) => name);

  return (
    <main className="page-container" style={{ paddingTop: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: "clamp(18px,4vw,24px)", fontWeight: 800, margin: "0 0 4px" }}>
          {params.origin} → {params.destination}
        </h1>
        <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
          {params.departureDate} · {params.adults ?? 1} adult · {(params.cabinClass ?? "ECONOMY").replace("_", " ")}
        </p>
      </div>

      {result?.isIndicative && (
        <div style={{
          background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 8,
          padding: "12px 16px", marginBottom: 20, fontSize: 14,
        }}>
          ⚠️ {result.disclaimer}
        </div>
      )}

      {result.fares.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0", color: "#6b7280" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✈️</div>
          <p style={{ fontSize: 20, fontWeight: 600, color: "#374151", margin: "0 0 8px" }}>
            {result.apiError || failingSuppliers.length > 0 ? "Live flight search unavailable" : "No flights found"}
          </p>
          <p style={{ margin: "0 0 12px" }}>
            {result.apiError
              ? "The flight API could not complete this search."
              : failingSuppliers.length > 0
                ? `Supplier connection issue: ${failingSuppliers.join(", ")}`
                : "Try different dates or destinations."}
          </p>
          {missingCredentialSuppliers.length > 0 && (
            <p style={{ margin: "0 0 24px", fontSize: 12, color: "#9ca3af" }}>
              Not configured: {missingCredentialSuppliers.join(", ")}
            </p>
          )}
          <a href="/" style={{
            background: "var(--color-primary)", color: "white", textDecoration: "none",
            padding: "12px 24px", borderRadius: 8, fontWeight: 600, display: "inline-block",
          }}>
            Search Again
          </a>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(result.fares as any[]).map((fare, i) => (
            <FareCard key={i} fare={fare} currencySymbol={symbol} />
          ))}
        </div>
      )}
    </main>
  );
}

function FareCard({ fare, currencySymbol }: { fare: any; currencySymbol: string }) {
  const dep = new Date(fare.departureTime);
  const arr = new Date(fare.arrivalTime);
  const fmt = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });

  return (
    <div className="fare-card">
      <div className="fare-card-airline-col">
        <div className="fare-card-airline">{fare.airlineName}</div>
        <div className="fare-card-flight">{fare.flightNumber}</div>
      </div>
      <div className="fare-card-times-col">
        <div className="fare-card-times">
          {fmt(dep)} → {fmt(arr)}
        </div>
        <div className="fare-card-stops">
          {fare.stops === 0 ? "Nonstop" : `${fare.stops} stop${fare.stops > 1 ? "s" : ""}`}
          {" · "}{Math.floor(fare.duration / 60)}h {fare.duration % 60}m
        </div>
      </div>
      <div className="fare-card-info-col">
        <div style={{ fontSize: 12, color: fare.isRefundable ? "#059669" : "#9ca3af" }}>
          {fare.isRefundable ? "✓ Refundable" : "Non-refundable"}
        </div>
        {fare.baggage?.checked && (
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{fare.baggage.checked}</div>
        )}
      </div>
      <div className="fare-card-price-col">
        <div className="fare-card-price">
          {currencySymbol}{(fare.displayPrice ?? fare.totalFare).toLocaleString("en-IN")}
        </div>
        {!fare.isBookable && (
          <div style={{ fontSize: 11, color: "#9ca3af" }}>Indicative price</div>
        )}
        {fare.isBookable && (
          <a
            href={`/book?fareId=${fare.id}&supplier=${fare.supplier}`}
            className="fare-card-book-btn"
            style={{ marginTop: 8 }}
          >
            Book Now
          </a>
        )}
      </div>
    </div>
  );
}
