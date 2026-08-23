import { cookies, headers } from "next/headers";

type SearchParams = {
  origin?: string; destination?: string; departureDate?: string;
  returnDate?: string; adults?: string; cabinClass?: string;
  tripType?: string; currency?: string;
};

interface SearchPageProps {
  searchParams: Promise<SearchParams>;
}

async function searchFlights(params: SearchParams, tenantSlug: string, sessionId: string | null) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/search`, {
    method:  "POST",
    headers: {
      "Content-Type":  "application/json",
      "x-tenant-slug": tenantSlug,
      ...(sessionId ? { "X-Session-ID": sessionId } : {}),
    },
    body: JSON.stringify({
      origin:        params.origin,
      destination:   params.destination,
      departureDate: params.departureDate,
      returnDate:    params.returnDate,
      adults:        parseInt(params.adults ?? "1"),
      cabinClass:    params.cabinClass ?? "ECONOMY",
      tripType:      params.tripType ?? "ONEWAY",
    }),
    cache: "no-store",
  });

  if (!res.ok) return null;
  return res.json() as Promise<{ fares: unknown[]; isIndicative: boolean; disclaimer?: string }>;
}

export default async function SearchResultsPage({ searchParams }: SearchPageProps) {
  const [headersList, cookieStore, params] = await Promise.all([headers(), cookies(), searchParams]);
  const slug      = headersList.get("x-tenant-slug") ?? "poomas";
  const sessionId = cookieStore.get("sid")?.value ?? null;

  const result = await searchFlights(params, slug, sessionId);

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "24px 16px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        {params.origin} → {params.destination}
        <span style={{ fontSize: 15, fontWeight: 400, color: "#6b7280", marginLeft: 12 }}>
          {params.departureDate} · {params.adults} adult(s) · {params.cabinClass}
        </span>
      </h1>

      {result?.isIndicative && (
        <div style={{
          background: "#FEF3C7", border: "1px solid #F59E0B",
          borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 14,
        }}>
          ⚠️ {result.disclaimer}
        </div>
      )}

      {!result || result.fares.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0", color: "#6b7280" }}>
          <p style={{ fontSize: 20 }}>No flights found for this route and date.</p>
          <p>Try different dates or destinations.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {(result.fares as any[]).map((fare, i) => (
            <FareCard key={i} fare={fare} />
          ))}
        </div>
      )}
    </main>
  );
}

function FareCard({ fare }: { fare: any }) {
  return (
    <div style={{
      border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "20px 24px",
      display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 16,
      alignItems: "center", background: "white",
    }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 18 }}>{fare.airlineName}</div>
        <div style={{ color: "#6b7280", fontSize: 13 }}>{fare.flightNumber}</div>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontWeight: 600 }}>
          {new Date(fare.departureTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          {" → "}
          {new Date(fare.arrivalTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
        </div>
        <div style={{ fontSize: 13, color: "#6b7280" }}>
          {fare.stops === 0 ? "Nonstop" : `${fare.stops} stop${fare.stops > 1 ? "s" : ""}`}
          {" · "}{Math.floor(fare.duration / 60)}h {fare.duration % 60}m
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, color: fare.isRefundable ? "#059669" : "#9ca3af" }}>
          {fare.isRefundable ? "Refundable" : "Non-refundable"}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280" }}>{fare.baggage?.checked}</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontWeight: 700, fontSize: 22, color: "var(--color-primary)" }}>
          ₹{(fare.displayPrice ?? fare.totalFare).toLocaleString("en-IN")}
        </div>
        {!fare.isBookable && (
          <div style={{ fontSize: 11, color: "#6b7280" }}>Indicative</div>
        )}
        {fare.isBookable && (
          <a href={`/book?fareId=${fare.id}&supplier=${fare.supplier}`}
            style={{
              display: "inline-block", marginTop: 8,
              background: "var(--color-primary)", color: "white",
              padding: "8px 20px", borderRadius: 6, fontWeight: 600,
              textDecoration: "none", fontSize: 14,
            }}>
            Book
          </a>
        )}
      </div>
    </div>
  );
}
