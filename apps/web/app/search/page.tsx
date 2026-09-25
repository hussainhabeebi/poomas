import { cookies } from "next/headers";
import SearchResultControls, { ChangeDatesAction } from "./SearchResultControls";

type SearchParams = {
  origin?: string; destination?: string; departureDate?: string;
  returnDate?: string; adults?: string; children?: string; infants?: string;
  cabinClass?: string; tripType?: string; currency?: "INR" | "AED" | "USD"; all?: string;
  sort?: "price" | "duration" | "departure" | "best"; stops?: string;
  refundable?: string; baggage?: string; airlines?: string; depBand?: string;
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
  searchId?: string;
};

const CURRENCY_LOCALES: Record<string, string> = {
  INR: "en-IN", AED: "en-AE", USD: "en-US", GBP: "en-GB", EUR: "en-IE",
};

// Display labels for the nearby-airport options already offered by the filters.
const AIRPORT_CITIES: Record<string, string> = {
  COK: "Kochi", CCJ: "Kozhikode", CNN: "Kannur", TRV: "Thiruvananthapuram",
  DXB: "Dubai", DWC: "Dubai Al Maktoum", SHJ: "Sharjah", AUH: "Abu Dhabi",
};

function displaySearchDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? "";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

interface SearchPageProps { searchParams: Promise<SearchParams>; }

// Admin-set INR→AED rate (INR per 1 AED); null when AED payment isn't offered.
async function fetchAedRate(): Promise<number | null> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";
    // No caching: a rate saved in Admin must apply to the very next search.
    const res = await fetch(`${apiUrl}/api/search/fx`, { headers: { "x-tenant-slug": "poomas" }, cache: "no-store" });
    const data = await res.json() as { rates?: { AED?: number | null } };
    const rate = Number(data.rates?.AED);
    return Number.isFinite(rate) && rate > 0 ? rate : null;
  } catch { return null; }
}

// Price in the currency the customer chose (rounded up like the payment API).
function inChosenCurrency(price: number, fareCurrency: string, chosen: string | null, aedRate: number | null) {
  if (chosen === "AED" && fareCurrency === "INR" && aedRate) return { amount: Math.ceil((price / aedRate) * 100 - 1e-9) / 100, currency: "AED", converted: true };
  return { amount: price, currency: fareCurrency, converted: false };
}

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
        children: parseInt(params.children ?? "0"),
        infants: parseInt(params.infants ?? "0"),
        cabinClass: params.cabinClass ?? "ECONOMY",
        tripType: params.tripType ?? "ONEWAY",
        ...(params.currency ? { currency: params.currency } : {}),
      }),
      cache: "no-store",
      // Must outlast the API's 28s TripJack search budget.
      signal: AbortSignal.timeout(40_000),
    });

    const raw = await res.text();
    let data: SearchResult | { error?: string } | null = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}
    if (!res.ok) {
      return {
        fares: [], isIndicative: false,
        searchId: data && "searchId" in data ? (data as SearchResult).searchId : undefined,
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

  const [result, aedRate] = await Promise.all([searchFlights(params, sessionId), fetchAedRate()]);
  const requestedCurrency = params.currency ?? null;
  const failingSuppliers = Object.keys(result.supplierErrors ?? {});
  const missingCredentialSuppliers = Object.entries(result.credentialAvailability ?? {})
    .filter(([, ok]) => !ok).map(([name]) => name);
  const allFares = result.fares as any[];
  const filteredFares = filterAndSortFares(allFares, params);
  const displayFares = params.all === "1" || params.sort
    ? filteredFares
    : recommendedFares(filteredFares);
  const allQuery = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null) as [string, string][]);
  allQuery.set("all", "1");

  const sortParam = params.sort ?? "best";

  const sortTabs: { key: string; label: string }[] = [
    { key: "best",      label: "Best" },
    { key: "price",     label: "Cheapest" },
    { key: "duration",  label: "Fastest" },
    { key: "departure", label: "Earliest" },
  ];

  const adults  = Math.min(9, Math.max(1, parseInt(params.adults  ?? "1") || 1));
  const children = parseInt(params.children ?? "0") || 0;
  const infants  = parseInt(params.infants  ?? "0") || 0;
  const tripContext = [displaySearchDate(params.departureDate), `${adults} adult${adults > 1 ? "s" : ""}`, (params.cabinClass ?? "ECONOMY").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()), requestedCurrency].filter(Boolean);

  return (
    <main className="page-container flight-results-page">
      {/* Route-neutral travel banner; all journey details come from search state. */}
      <div className="search-page-header">
        <div className="search-page-summary">
          <h1>
            {params.origin} → {params.destination}
          </h1>
          <p className="results-meta">
            {tripContext.join(" · ")}
          </p>
          <a href="/" className="search-page-modify-link"><span aria-hidden="true">✎</span> Modify search</a>
        </div>
      </div>

      <div className="search-results-layout">
        {/* Filter sidebar */}
        <SearchResultControls
          origin={params.origin ?? ""}
          destination={params.destination ?? ""}
          departureDate={params.departureDate ?? new Date().toISOString().slice(0, 10)}
          fares={allFares}
        />

        {/* Results column */}
        <div className="search-results-column">
          {requestedCurrency === "AED" && !aedRate && filteredFares.length > 0 && (
            <div style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E3A8A", borderRadius: 10, padding: "10px 14px", marginBottom: 14, fontSize: 13 }}>
              AED prices aren't available right now, so fares are shown in Indian rupees (INR).
            </div>
          )}

          {result?.isIndicative && (
            <div style={{ background: "#FEF3C7", border: "1px solid #F59E0B", borderRadius: 10, padding: "12px 14px", marginBottom: 14, fontSize: 13 }}>
              ⚠️ {result.disclaimer}
            </div>
          )}

          {/* Sort tabs */}
          <div className="sort-tabs" role="tablist" aria-label="Sort results">
              {sortTabs.map(({ key, label }) => {
                const href = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null) as [string, string][]);
                href.set("sort", key);
                href.set("all", "1");
                return (
                  <a
                    key={key}
                    role="tab"
                    aria-selected={sortParam === key}
                    className={`sort-tab${sortParam === key ? " active" : ""}`}
                    href={`/search?${href.toString()}`}
                  >
                    {label}
                  </a>
                );
              })}
              <span className="results-count-badge">{filteredFares.length} flight{filteredFares.length === 1 ? "" : "s"}</span>
          </div>

          {filteredFares.length === 0 ? (
            <div className="no-results">
              <img className="no-results-illustration" src="/search/empty-flight.svg" alt="" aria-hidden="true" width="420" height="150" />
              <h2>No flights available right now</h2>
              <p>{result.apiError || failingSuppliers.length > 0 ? "We're having trouble searching flights for this route. Please try again or choose different dates." : "Try different dates or a nearby airport."}</p>
              <div className="no-results-trip-card" aria-label="Searched journey">
                <div className="no-results-route">
                  <div className="no-results-airport"><strong>{AIRPORT_CITIES[params.origin ?? ""] ?? params.origin ?? "—"} ({params.origin ?? "—"})</strong><span>Origin airport</span></div>
                  <span className="no-results-route-icon" aria-hidden="true">✈ ──→</span>
                  <div className="no-results-airport"><strong>{AIRPORT_CITIES[params.destination ?? ""] ?? params.destination ?? "—"} ({params.destination ?? "—"})</strong><span>Destination airport</span></div>
                </div>
                <div className="no-results-trip-meta">{tripContext.map((item, i) => <span key={i}>{item}</span>)}</div>
              </div>
              <div className="no-results-actions">
                <a href="/" className="fare-card-book-btn no-results-action">Search again</a>
                <ChangeDatesAction />
                <a href="/#flight-search" className="no-results-secondary">Modify search</a>
              </div>
              {(result.apiError || failingSuppliers.length > 0) && result.searchId && (
                <p className="no-results-reference">Reference: {result.searchId.slice(0, 8)}</p>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {params.all !== "1" && (
                <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 700, marginBottom: 2 }}>Recommended for you</div>
              )}
              {displayFares.map((fare, i) => (
                <FareCard
                  key={`${fare.id ?? i}-${i}`}
                  fare={fare}
                  requestedCurrency={requestedCurrency}
                  aedRate={aedRate}
                  searchId={result.searchId}
                  adults={adults}
                  children={children}
                  infants={infants}
                />
              ))}
              {params.all !== "1" && filteredFares.length > displayFares.length && (
                <a
                  href={`/search?${allQuery.toString()}`}
                  style={{ textAlign: "center", padding: 14, border: "1.5px solid #e2e8f0", borderRadius: 14, color: "#0f172a", textDecoration: "none", fontWeight: 800, background: "#fff", fontSize: 14 }}
                >
                  View all {filteredFares.length} flights →
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function filterAndSortFares(fares: any[], params: SearchParams): any[] {
  const airlineFilter = (params.airlines ?? "").split(",").filter(Boolean);
  const filtered = fares.filter((fare) => {
    if (params.stops === "0" && Number(fare.stops ?? 0) !== 0) return false;
    if (params.stops === "1" && Number(fare.stops ?? 0) > 1) return false;
    if (params.refundable === "1" && !fare.isRefundable) return false;
    if (params.baggage === "1" && !fare.baggage?.checked) return false;
    if (airlineFilter.length > 0 && !airlineFilter.includes(fare.airlineName)) return false;
    if (params.depBand) {
      const dep = new Date(fare.departureTime);
      const hour = dep.getHours();
      const [start, end] = params.depBand.split("–").map(Number);
      if (hour < start || hour >= end) return false;
    }
    return true;
  });

  if (params.sort === "price") {
    return [...filtered].sort((a, b) => Number(a.displayPrice ?? a.totalFare ?? Infinity) - Number(b.displayPrice ?? b.totalFare ?? Infinity));
  }
  if (params.sort === "duration") {
    return [...filtered].sort((a, b) => Number(a.duration ?? Infinity) - Number(b.duration ?? Infinity));
  }
  if (params.sort === "departure") {
    return [...filtered].sort((a, b) => new Date(a.departureTime).getTime() - new Date(b.departureTime).getTime());
  }
  return filtered;
}

function recommendedFares(fares: any[]): any[] {
  if (fares.length <= 3) return fares;
  const bookable = fares.filter((f) => f.isBookable);
  const pool = bookable.length >= 3 ? bookable : fares;
  const prices = pool.map((f) => Number(f.displayPrice ?? f.totalFare ?? Infinity));
  const durations = pool.map((f) => Number(f.duration ?? Infinity));
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minD = Math.min(...durations), maxD = Math.max(...durations);
  const best = [...pool].sort((a, b) => {
    const score = (f: any) => ((Number(f.displayPrice ?? f.totalFare) - minP) / Math.max(1, maxP - minP)) * .62
      + ((Number(f.duration) - minD) / Math.max(1, maxD - minD)) * .28 + Number(f.stops ?? 0) * .1;
    return score(a) - score(b);
  })[0];
  const cheapest = [...pool].sort((a, b) => Number(a.displayPrice ?? a.totalFare) - Number(b.displayPrice ?? b.totalFare))[0];
  const fastest = [...pool].sort((a, b) => Number(a.duration) - Number(b.duration))[0];
  const picked: any[] = [];
  for (const [fare, badge] of [[best, "Best overall"], [cheapest, "Lowest fare"], [fastest, "Fastest"]] as const) {
    if (fare && !picked.some((x) => x.id === fare.id)) picked.push({ ...fare, __badge: badge });
  }
  for (const fare of pool) if (picked.length < 3 && !picked.some((x) => x.id === fare.id)) picked.push(fare);
  return picked.slice(0, 3);
}

function formatMoney(amount: number, currency: string): string {
  const code = (currency || "").toUpperCase();
  const locale = CURRENCY_LOCALES[code] ?? "en-US";
  try { return new Intl.NumberFormat(locale, { style: "currency", currency: code || "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${code || ""} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`.trim(); }
}

function buildBookUrl(fare: any, fareCurrency: string, price: number, adults: number, children = 0, infants = 0, payCurrency?: string, searchId?: string): string {
  const p = new URLSearchParams({
    fareId:   fare.id ?? "",
    adults:   String(adults),
    children: String(children),
    infants:  String(infants),
    supplier: fare.supplier ?? "",
    airline:  fare.airlineName ?? "",
    fn:       fare.flightNumber ?? "",
    from:     fare.origin ?? "",
    to:       fare.destination ?? "",
    dep:      fare.departureTime ?? "",
    arr:      fare.arrivalTime ?? "",
    dur:      String(fare.duration ?? 0),
    stops:    String(fare.stops ?? 0),
    price:    String(price),
    cur:      fareCurrency,
    ref:      fare.isRefundable ? "1" : "0",
    bag:      fare.baggage?.checked ?? "15 KG",
  });
  if (payCurrency) p.set("pc", payCurrency);
  if (searchId) p.set("sid", searchId);   // links the booking to this search's TripJack logs
  return `/book?${p.toString()}`;
}

function FareCard({ fare, requestedCurrency, aedRate, searchId, adults, children = 0, infants = 0 }: { fare: any; requestedCurrency: string | null; aedRate: number | null; searchId?: string; adults: number; children?: number; infants?: number }) {
  const dep = new Date(fare.departureTime);
  const arr = new Date(fare.arrivalTime);
  const fmt = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  const fmtDate = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  const fareCurrency = String(fare.currency || requestedCurrency || "INR").toUpperCase();
  const price = Number(fare.displayPrice ?? fare.totalFare ?? 0);
  const shown = inChosenCurrency(price, fareCurrency, requestedCurrency, aedRate);
  const currencyDiffers = Boolean(requestedCurrency && shown.currency !== requestedCurrency);
  const isBookable = Boolean(fare.isBookable && fare.supplier !== "GOOGLE_SERP");
  const durationH = Math.floor(fare.duration / 60);
  const durationM = fare.duration % 60;
  const airlineCode = (fare.flightNumber ?? "").slice(0, 2).toUpperCase();
  const arrNextDay = dep.getUTCDate() !== arr.getUTCDate();

  const badgeColor = fare.__badge === "Best overall" ? "#E31E24" : fare.__badge === "Lowest fare" ? "#0f172a" : "#0369a1";

  return (
    <div className="fare-card-v2" style={{ position: "relative" }}>
      {fare.__badge && (
        <div className="fare-card-recommendation" style={{ background: badgeColor }}>
          {fare.__badge}
        </div>
      )}

      <div className="fare-card-v2-main" style={fare.__badge ? { paddingTop: 22 } : {}}>
        {/* Airline */}
        <div className="fare-card-v2-airline">
          <div className="fare-card-v2-airline-logo">{airlineCode}</div>
          <div className="fare-card-v2-airline-name">{fare.airlineName}</div>
          <div className="fare-card-v2-flight-num">{fare.flightNumber}</div>
        </div>

        {/* Times & duration bar */}
        <div className="fare-card-v2-times">
          <div className="fare-card-v2-time-row">
            <div>
              <div className="fare-card-v2-time">{fmt(dep)}</div>
              <div className="fare-card-v2-airport">{fare.origin}</div>
            </div>
            <div className="fare-card-v2-duration-bar">
              <div className="fare-card-v2-duration">{durationH}h {durationM}m</div>
              <div className="fare-card-v2-line" />
              <div className={`fare-card-v2-stops-label${fare.stops === 0 ? " nonstop" : ""}`}>
                {fare.stops === 0 ? "Nonstop" : `${fare.stops} stop${fare.stops > 1 ? "s" : ""}`}
              </div>
            </div>
            <div>
              <div className="fare-card-v2-time">
                {fmt(arr)}
                {arrNextDay && <sup style={{ fontSize: 10, color: "#f59e0b", marginLeft: 2 }}>+1</sup>}
              </div>
              <div className="fare-card-v2-airport">{fare.destination}</div>
            </div>
          </div>
          {fare.layoverAirports?.length > 0 && (
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>Via {fare.layoverAirports.join(" · ")}</div>
          )}
        </div>

        {/* Tags */}
        <div className="fare-card-v2-tags">
          {fare.isRefundable && <span className="fare-card-v2-tag tag-refundable">✓ Refundable</span>}
          {fare.baggage?.checked && <span className="fare-card-v2-tag tag-baggage">🧳 {fare.baggage.checked}</span>}
          {fare.seatsLeft > 0 && fare.seatsLeft <= 5 && (
            <span className="fare-card-v2-tag tag-seats">🔥 {fare.seatsLeft} left</span>
          )}
        </div>

        {/* Price + book */}
        <div className="fare-card-v2-price-col">
          <div className="fare-card-v2-price">{formatMoney(shown.amount, shown.currency)}</div>
          <div className="fare-card-v2-price-note">
            {shown.converted ? `≈ ${formatMoney(price, fareCurrency)}` : fareCurrency}
            {!fare.isBookable && " · indicative"}
          </div>
          {isBookable ? (
            <a href={buildBookUrl(fare, fareCurrency, price, adults, children, infants, shown.converted ? shown.currency : undefined, searchId)} className="fare-card-v2-book">
              Book Now
            </a>
          ) : (
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Not bookable online</span>
          )}
        </div>
      </div>

      <details className="fare-card-v2-details">
        <summary className="fare-card-v2-expand-row">
          <span className="fare-card-v2-supplier">{fmtDate(dep)} · {fare.supplier ?? ""}</span>
          <span className="fare-card-v2-expand-btn">Details <span className="fare-card-v2-expand-indicator" aria-hidden="true">⌄</span></span>
        </summary>
        <div className="fare-card-v2-detail">
          <div className="fare-card-v2-detail-item">
            <label>Cabin baggage</label>
            <span>{fare.baggage?.cabin ?? "—"}</span>
          </div>
          <div className="fare-card-v2-detail-item">
            <label>Check-in baggage</label>
            <span>{fare.baggage?.checked ?? "—"}</span>
          </div>
          <div className="fare-card-v2-detail-item">
            <label>Refundable</label>
            <span>{fare.isRefundable ? "Yes" : "No"}</span>
          </div>
          {fare.fareClass && (
            <div className="fare-card-v2-detail-item">
              <label>Fare class</label>
              <span>{fare.fareClass}</span>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
