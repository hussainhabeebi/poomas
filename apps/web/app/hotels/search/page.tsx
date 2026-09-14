import Link from "next/link";

type SearchParams = {
  city?: string; cityName?: string;
  checkIn?: string; checkOut?: string;
  rooms?: string; adults?: string;
  currency?: string;
};

type NormalizedHotel = {
  id: string; hotelCode: string; name: string; starRating: number;
  address: string; cityCode: string; checkIn: string; checkOut: string;
  nights: number; rooms: number; roomType: string; mealPlan: string;
  isRefundable: boolean; baseFare: number; taxes: number; totalFare: number;
  currency: string; images: string[]; amenities: string[];
};

type HotelSearchResult = {
  hotels: NormalizedHotel[];
  supplier?: string;
  fromCache?: boolean;
  error?: string;
};

interface PageProps { searchParams: Promise<SearchParams>; }

async function searchHotels(params: SearchParams): Promise<HotelSearchResult> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";
  const rooms  = parseInt(params.rooms ?? "1");
  const adults = parseInt(params.adults ?? "1");
  try {
    const res = await fetch(`${apiUrl}/api/hotels/search`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-tenant-slug": "poomas" },
      body: JSON.stringify({
        cityCode:    params.city ?? "",
        checkIn:     params.checkIn ?? "",
        checkOut:    params.checkOut ?? "",
        rooms:       Array.from({ length: rooms }, () => ({ adults, children: 0 })),
        nationality: "IN",
        currency:    params.currency ?? "INR",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    const data = await res.json().catch(() => ({})) as HotelSearchResult;
    if (!res.ok) return { hotels: [], error: (data as any).error ?? `API error ${res.status}` };
    return data;
  } catch (err) {
    return { hotels: [], error: err instanceof Error ? err.message : "Search unavailable" };
  }
}

function formatMoney(amount: number, currency: string): string {
  const code = (currency || "INR").toUpperCase();
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${code} ${amount.toLocaleString()}`;
  }
}

function buildBookUrl(hotel: NormalizedHotel, rooms: number): string {
  const p = new URLSearchParams({
    optionId:  hotel.id,
    name:      hotel.name,
    stars:     String(hotel.starRating),
    price:     String(hotel.totalFare),
    currency:  hotel.currency,
    checkIn:   hotel.checkIn,
    checkOut:  hotel.checkOut,
    nights:    String(hotel.nights),
    rooms:     String(rooms),
    roomType:  hotel.roomType,
    mealPlan:  hotel.mealPlan,
    ref:       hotel.isRefundable ? "1" : "0",
    city:      hotel.cityCode,
    address:   hotel.address,
  });
  return `/hotels/book?${p}`;
}

function Stars({ n }: { n: number }) {
  const full = Math.round(n);
  return (
    <span style={{ color: "#f59e0b", fontSize: 13, letterSpacing: 1 }}>
      {"★".repeat(Math.max(0, Math.min(5, full)))}
      {"☆".repeat(Math.max(0, 5 - Math.min(5, full)))}
    </span>
  );
}

export default async function HotelSearchPage({ searchParams }: PageProps) {
  const params  = await searchParams;
  const result  = await searchHotels(params);
  const hotels  = result.hotels ?? [];
  const rooms   = parseInt(params.rooms ?? "1");
  const nights  = hotels[0]?.nights ?? (
    params.checkIn && params.checkOut
      ? Math.max(1, Math.round((new Date(params.checkOut).getTime() - new Date(params.checkIn).getTime()) / 86400000))
      : 1
  );

  return (
    <main className="page-container" style={{ paddingTop: 16 }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: "clamp(18px,4vw,24px)", fontWeight: 800, margin: "0 0 4px" }}>
          Hotels in {params.cityName ?? params.city}
        </h1>
        <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
          {params.checkIn} → {params.checkOut} · {nights} night{nights !== 1 ? "s" : ""} ·{" "}
          {rooms} room{rooms !== 1 ? "s" : ""} · {params.adults ?? 1} adult{Number(params.adults) > 1 ? "s" : ""}/room
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <a href="/hotels" style={{ fontSize: 13, color: "#E31E24", textDecoration: "none", fontWeight: 600 }}>
          ‹ New search
        </a>
      </div>

      {hotels.length === 0 ? (
        <div style={{ textAlign: "center", padding: "70px 0", color: "#6b7280" }}>
          <div style={{ fontSize: 44, marginBottom: 14 }}>🏨</div>
          <p style={{ fontSize: 20, fontWeight: 700, color: "#374151", margin: "0 0 8px" }}>
            {result.error ? "Hotel search unavailable" : "No hotels found"}
          </p>
          <p style={{ margin: "0 0 20px" }}>
            {result.error ?? "Try different dates or destination."}
          </p>
          {result.error && (
            <p style={{ fontSize: 12, color: "#991b1b", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "10px 12px", maxWidth: 600, margin: "0 auto 20px", wordBreak: "break-word" }}>
              {result.error}
            </p>
          )}
          <a href="/hotels" className="fare-card-book-btn" style={{ maxWidth: 200, margin: "0 auto" }}>
            Search again
          </a>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ margin: 0, fontSize: 13, color: "#475569", fontWeight: 700 }}>
            {hotels.length} hotel{hotels.length !== 1 ? "s" : ""} found
          </p>
          {hotels.map((hotel, i) => (
            <HotelCard key={`${hotel.id}-${i}`} hotel={hotel} rooms={rooms} />
          ))}
        </div>
      )}
    </main>
  );
}

function HotelCard({ hotel, rooms }: { hotel: NormalizedHotel; rooms: number }) {
  const price = hotel.totalFare;
  const bookable = Boolean(hotel.id);

  return (
    <div style={{
      border: "1.5px solid #e5e7eb", borderRadius: 10, padding: 16, background: "white",
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 3 }}>{hotel.name || "—"}</div>
          <Stars n={hotel.starRating} />
          {hotel.address && (
            <div style={{ fontSize: 12, color: "#6b7280", marginTop: 3 }}>{hotel.address}</div>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 20, color: "#E31E24" }}>
            {formatMoney(price, hotel.currency)}
          </div>
          <div style={{ fontSize: 11, color: "#9ca3af" }}>
            {hotel.nights} night{hotel.nights !== 1 ? "s" : ""}, {rooms} room{rooms !== 1 ? "s" : ""}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
        {hotel.roomType && (
          <span style={{ background: "#f1f5f9", color: "#374151", padding: "3px 8px", borderRadius: 6, fontWeight: 600 }}>
            {hotel.roomType}
          </span>
        )}
        {hotel.mealPlan && hotel.mealPlan !== "EP" && (
          <span style={{ background: "#f0fdf4", color: "#166534", padding: "3px 8px", borderRadius: 6, fontWeight: 600 }}>
            {hotel.mealPlan === "CP" ? "Breakfast included" : hotel.mealPlan === "MAP" ? "Half board" : hotel.mealPlan === "AP" ? "Full board" : hotel.mealPlan}
          </span>
        )}
        <span style={{ color: hotel.isRefundable ? "#059669" : "#9ca3af", fontWeight: 600 }}>
          {hotel.isRefundable ? "✓ Free cancellation" : "Non-refundable"}
        </span>
      </div>

      {hotel.amenities.length > 0 && (
        <div style={{ fontSize: 11, color: "#6b7280" }}>
          {hotel.amenities.slice(0, 5).join(" · ")}
        </div>
      )}

      {bookable ? (
        <Link
          href={buildBookUrl(hotel, rooms)}
          className="fare-card-book-btn"
          style={{ textDecoration: "none", textAlign: "center" }}
        >
          Book Now
        </Link>
      ) : (
        <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: "8px 0" }}>
          Indicative price · Not directly bookable
        </div>
      )}
    </div>
  );
}
