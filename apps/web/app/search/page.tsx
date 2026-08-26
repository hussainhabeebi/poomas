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

const CURRENCY_LOCALES: Record<string, string> = {
  INR: "en-IN", AED: "en-AE", USD: "en-US", GBP: "en-GB", EUR: "en-IE",
};

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
        origin: params.origin,
        destination: params.destination,
        departureDate: params.departureDate,
        returnDate: params.returnDate,
        adults: parseInt(params.adults ?? "1"),
        children: 0,
        infants: 0,
        cabinClass: params.cabinClass ?? "ECONOMY",
        tripType: params.tripType ?? "ONEWAY",
        ...(params.currency ? { currency: params.currency } : {}),
      }),
      cache: "no-store",
    });

    const raw = await res.text();
    let data: SearchResult | { error?: string } | null = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (!res.ok) {
      return {
        fares: [], isIndicative: false,
        apiError: (data && "error" in data ? data.error : undefined) ?? `${res.status} ${res.statusText}${raw ? ` — ${raw.slice(0, 180)}` : ""}`,
      };
    }
    return (data as SearchResult) ?? { fares: [], isIndicative: false, apiError: "Search API returned an empty response" };
  } catch (err) {
    return { fares: [], isIndicative: false, apiError: err instanceof Error ? err.message : "Search API unavailable" };
  }
}

export default async function SearchResultsPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  let sessionId: string | null = null;
  try { const s = await cookies(); sessionId = s.get("sid")?.value ?? null; } catch {}

  const result = await searchFlights(params, sessionId);
  const requestedCurrency = params.currency ?? null;
  const failingSuppliers = Object.keys(result.supplierErrors ?? {});
  const missingCredentialSuppliers = Object.entries(result.credentialAvailability ?? {})
    .filter(([, ok]) => !ok).map(([name]) => name);

  return (
    <main className="page-container" style={{ paddingTop: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: "clamp(18px,4vw,24px)", fontWeight: 800, margin: "0 0 4px" }}>{params.origin} → {params.destination}</h1>
        <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
          {params.departureDate} · {params.adults ?? 1} adult · {(params.cabinClass ?? "ECONOMY").replace("_", " ")}{requestedCurrency ? ` · ${requestedCurrency}` : ""}
        </p>
      </div>

      {result?.isIndicative && <div style={{ background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 10, padding: "12px 14px", marginBottom: 16, fontSize: 13 }}>⚠️ {result.disclaimer}</div>}

      {result.fares.length === 0 ? (
        <div style={{ textAlign: "center", padding: "70px 0", color: "#6b7280" }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>✈️</div>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#374151", margin: "0 0 8px" }}>{result.apiError || failingSuppliers.length > 0 ? "Live flight search unavailable" : "No flights found"}</p>
          <p style={{ margin: "0 0 12px" }}>{result.apiError ? "The flight API could not complete this search." : failingSuppliers.length > 0 ? `Supplier connection issue: ${failingSuppliers.join(", ")}` : "Try different dates or destinations."}</p>
          {result.apiError && <p style={{ margin: "0 auto 16px", maxWidth: 760, fontSize: 12, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 12px", wordBreak: "break-word" }}>{result.apiError}</p>}
          {missingCredentialSuppliers.length > 0 && <p style={{ margin: "0 0 24px", fontSize: 12, color: "#9ca3af" }}>Not configured: {missingCredentialSuppliers.join(", ")}</p>}
          <a href="/" className="fare-card-book-btn" style={{ maxWidth: 220, margin: "0 auto" }}>Search Again</a>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(result.fares as any[]).map((fare, i) => <FareCard key={`${fare.id ?? i}-${i}`} fare={fare} requestedCurrency={requestedCurrency} />)}
        </div>
      )}
    </main>
  );
}

function formatMoney(amount: number, currency: string): string {
  const code = (currency || "").toUpperCase();
  const locale = CURRENCY_LOCALES[code] ?? "en-US";
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: code || "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${code || ""} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim(); }
}

function FareCard({ fare, requestedCurrency }: { fare: any; requestedCurrency: string | null }) {
  const dep = new Date(fare.departureTime);
  const arr = new Date(fare.arrivalTime);
  const fmt = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const fareCurrency = String(fare.currency || requestedCurrency || "USD").toUpperCase();
  const price = Number(fare.displayPrice ?? fare.totalFare ?? 0);
  const currencyDiffers = Boolean(requestedCurrency && fareCurrency !== requestedCurrency);
  const isDuffel = fare.supplier === "DUFFEL";

  return (
    <div className="fare-card">
      <div className="fare-card-airline-col">
        <div className="fare-card-airline">{fare.airlineName}</div>
        <div className="fare-card-flight">{fare.flightNumber}</div>
      </div>
      <div className="fare-card-times-col">
        <div className="fare-card-times">{fmt(dep)} → {fmt(arr)}</div>
        <div className="fare-card-stops">{fare.stops === 0 ? "Nonstop" : `${fare.stops} stop${fare.stops > 1 ? "s" : ""}`} · {Math.floor(fare.duration / 60)}h {fare.duration % 60}m</div>
      </div>
      <div className="fare-card-info-col">
        <div style={{ fontSize: 12, color: fare.isRefundable ? "#059669" : "#9ca3af" }}>{fare.isRefundable ? "✓ Refundable" : "Non-refundable"}</div>
        {fare.baggage?.checked && <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>{fare.baggage.checked}</div>}
      </div>
      <div className="fare-card-price-col">
        <div className="fare-card-price">{formatMoney(price, fareCurrency)}</div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{fareCurrency}{currencyDiffers ? " · supplier currency" : ""}</div>
        {!fare.isBookable && <div style={{ fontSize: 11, color: "#9ca3af" }}>Indicative price</div>}
        {fare.isBookable && isDuffel && (
          <form action="/book" method="GET" style={{ marginTop: 8 }}>
            <input type="hidden" name="fareId" value={fare.id} />
            <input type="hidden" name="supplier" value={fare.supplier} />
            <button type="submit" className="fare-card-book-btn" style={{ width: "100%", border: 0, cursor: "pointer", WebkitTapHighlightColor: "transparent", touchAction: "manipulation" }}>Book Now</button>
          </form>
        )}
        {fare.isBookable && !isDuffel && <div style={{ marginTop: 8, fontSize: 12, color: "#9ca3af", fontWeight: 600 }}>Booking integration coming soon</div>}
      </div>
    </div>
  );
}
