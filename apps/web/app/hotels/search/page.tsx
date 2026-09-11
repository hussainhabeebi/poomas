import { cookies } from "next/headers";

type HotelSearchParams = {
  cityCode?: string; city?: string;
  checkIn?: string; checkOut?: string;
  rooms?: string; adults?: string;
  currency?: "INR" | "AED" | "USD";
};

type NormalizedHotel = {
  id: string; hotelCode: string; name: string; starRating: number;
  address: string; cityCode: string; checkIn: string; checkOut: string;
  nights: number; rooms: number; roomType: string; mealPlan: string;
  isRefundable: boolean; baseFare: number; taxes: number; totalFare: number;
  currency: string; images: string[]; amenities: string[];
};

type HotelResult = {
  hotels: NormalizedHotel[];
  supplier?: string;
  fromCache?: boolean;
  apiError?: string;
};

const CURRENCY_LOCALES: Record<string, string> = {
  INR: "en-IN", AED: "en-AE", USD: "en-US",
};

const MEAL_PLAN_LABELS: Record<string, string> = {
  EP: "Room only", CP: "Breakfast included", MAP: "Half board", AP: "Full board",
};

interface HotelSearchPageProps { searchParams: Promise<HotelSearchParams>; }

async function searchHotels(params: HotelSearchParams, sessionId: string | null): Promise<HotelResult> {
  try {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";
    const rooms = parseInt(params.rooms ?? "1");
    const adults = parseInt(params.adults ?? "2");
    const roomsArr = Array.from({ length: Math.max(1, rooms) }, () => ({ adults: Math.max(1, adults), children: 0 }));

    const res = await fetch(`${apiUrl}/api/hotels/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tenant-slug": "poomas",
        ...(sessionId ? { "X-Session-ID": sessionId } : {}),
      },
      body: JSON.stringify({
        cityCode:    params.cityCode ?? "",
        checkIn:     params.checkIn ?? "",
        checkOut:    params.checkOut ?? "",
        rooms:       roomsArr,
        nationality: "IN",
        currency:    params.currency ?? "INR",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(35_000),
    });

    const raw = await res.text();
    let data: HotelResult | { error?: string } | null = null;
    try { data = raw ? JSON.parse(raw) : null; } catch {}

    if (!res.ok) {
      return {
        hotels: [],
        apiError: (data && "error" in data ? data.error : undefined) ?? `${res.status} ${res.statusText}${raw ? ` — ${raw.slice(0, 180)}` : ""}`,
      };
    }
    return (data as HotelResult) ?? { hotels: [], apiError: "Hotel API returned an empty response" };
  } catch (err) {
    return { hotels: [], apiError: err instanceof Error ? err.message : "Hotel API unavailable" };
  }
}

export default async function HotelSearchPage({ searchParams }: HotelSearchPageProps) {
  const params = await searchParams;
  let sessionId: string | null = null;
  try { const s = await cookies(); sessionId = s.get("sid")?.value ?? null; } catch {}

  const result = await searchHotels(params, sessionId);
  const hotels = result.hotels ?? [];
  const currency = (params.currency ?? "INR").toUpperCase();
  const locale = CURRENCY_LOCALES[currency] ?? "en-US";
  const nights = params.checkIn && params.checkOut
    ? Math.round((new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) / 86400000)
    : 0;

  function fmt(amount: number, cur: string): string {
    const c = (cur || currency).toUpperCase();
    const l = CURRENCY_LOCALES[c] ?? locale;
    try { return new Intl.NumberFormat(l, { style: "currency", currency: c, maximumFractionDigits: 0 }).format(amount); }
    catch { return `${c} ${amount.toLocaleString()}`; }
  }

  return (
    <main className="page-container" style={{ paddingTop: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: "clamp(18px,4vw,24px)", fontWeight: 800, margin: "0 0 4px" }}>
          Hotels in {params.city ?? params.cityCode}
        </h1>
        <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
          {params.checkIn} → {params.checkOut}
          {nights > 0 ? ` · ${nights} night${nights !== 1 ? "s" : ""}` : ""}
          {` · ${params.rooms ?? 1} room${Number(params.rooms ?? 1) > 1 ? "s" : ""}`}
          {` · ${params.adults ?? 2} adult${Number(params.adults ?? 2) > 1 ? "s" : ""}`}
          {` · ${currency}`}
        </p>
      </div>

      <a href="/" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#6b7280", textDecoration: "none", marginBottom: 12 }}>
        ← Modify search
      </a>

      {hotels.length === 0 ? (
        <div style={{ textAlign: "center", padding: "70px 0", color: "#6b7280" }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>🏨</div>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#374151", margin: "0 0 8px" }}>
            {result.apiError ? "Hotel search unavailable" : "No hotels found"}
          </p>
          <p style={{ margin: "0 0 12px" }}>
            {result.apiError ? "The hotel API could not complete this search." : "Try different dates or destination."}
          </p>
          {result.apiError && (
            <p style={{ margin: "0 auto 16px", maxWidth: 760, fontSize: 12, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 12px", wordBreak: "break-word" }}>
              {result.apiError}
            </p>
          )}
          <a href="/" className="fare-card-book-btn" style={{ maxWidth: 220, margin: "0 auto" }}>Search Again</a>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 2 }}>
            {hotels.length} hotel{hotels.length !== 1 ? "s" : ""} found
          </div>
          {hotels.map((hotel, i) => (
            <HotelCard key={`${hotel.id}-${i}`} hotel={hotel} fmt={fmt} nights={nights} />
          ))}
        </div>
      )}
    </main>
  );
}

function StarRating({ stars }: { stars: number }) {
  return (
    <span style={{ color: "#f59e0b", fontSize: 13 }}>
      {"★".repeat(Math.min(5, Math.max(0, stars)))}
      {"☆".repeat(Math.max(0, 5 - Math.min(5, stars)))}
    </span>
  );
}

function HotelCard({ hotel, fmt, nights }: { hotel: NormalizedHotel; fmt: (a: number, c: string) => string; nights: number }) {
  const img = hotel.images?.[0];
  const mealLabel = MEAL_PLAN_LABELS[hotel.mealPlan] ?? hotel.mealPlan;

  return (
    <div className="fare-card" style={{ flexDirection: "column", gap: 0, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
        {img && (
          <div style={{ width: 120, minHeight: 100, flexShrink: 0, overflow: "hidden" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt={hotel.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          </div>
        )}
        <div style={{ flex: 1, padding: "16px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{hotel.name}</div>
              <StarRating stars={hotel.starRating} />
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 20, color: "var(--color-primary)" }}>
                {fmt(hotel.totalFare, hotel.currency)}
              </div>
              {nights > 0 && (
                <div style={{ fontSize: 11, color: "#9ca3af" }}>
                  {fmt(Math.round(hotel.totalFare / nights), hotel.currency)} / night
                </div>
              )}
            </div>
          </div>

          {hotel.address && (
            <div style={{ fontSize: 12, color: "#6b7280" }}>📍 {hotel.address}</div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
            <span style={{ background: "#f1f5f9", borderRadius: 4, padding: "2px 7px", color: "#475569" }}>
              {hotel.roomType}
            </span>
            <span style={{ background: "#f1f5f9", borderRadius: 4, padding: "2px 7px", color: "#475569" }}>
              {mealLabel}
            </span>
            <span style={{ color: hotel.isRefundable ? "#059669" : "#9ca3af" }}>
              {hotel.isRefundable ? "✓ Free cancellation" : "Non-refundable"}
            </span>
          </div>

          {hotel.amenities?.length > 0 && (
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {hotel.amenities.slice(0, 4).join(" · ")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
