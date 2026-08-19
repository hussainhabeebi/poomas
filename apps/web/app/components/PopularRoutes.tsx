interface Route {
  origin:      string;
  destination: string;
  label:       string;
  fromPrice?:  number;
  currency?:   string;
}

const DEFAULT_ROUTES: Route[] = [
  { origin: "COK", destination: "DXB", label: "Kochi → Dubai",      fromPrice: 12500, currency: "INR" },
  { origin: "CCJ", destination: "AUH", label: "Kozhikode → Abu Dhabi", fromPrice: 13200, currency: "INR" },
  { origin: "BOM", destination: "DXB", label: "Mumbai → Dubai",      fromPrice: 10800, currency: "INR" },
  { origin: "MAA", destination: "DXB", label: "Chennai → Dubai",     fromPrice: 11500, currency: "INR" },
  { origin: "DEL", destination: "DXB", label: "Delhi → Dubai",       fromPrice: 9900,  currency: "INR" },
  { origin: "HYD", destination: "DXB", label: "Hyderabad → Dubai",   fromPrice: 10200, currency: "INR" },
];

export default function PopularRoutes({ routes }: { routes: Route[] }) {
  const displayRoutes = routes.length > 0 ? routes : DEFAULT_ROUTES;

  function buildSearchUrl(r: Route) {
    const today = new Date();
    today.setDate(today.getDate() + 14);
    const date = today.toISOString().split("T")[0];
    return `/search?origin=${r.origin}&destination=${r.destination}&departureDate=${date}&adults=1&tripType=ONEWAY&cabinClass=ECONOMY`;
  }

  return (
    <section style={{ marginTop: 48 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, color: "#111827", marginBottom: 20 }}>
        Popular Routes
      </h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
        {displayRoutes.map((r, i) => (
          <a
            key={i}
            href={buildSearchUrl(r)}
            style={{
              display: "block",
              padding: "16px 20px",
              border: "1.5px solid #e5e7eb",
              borderRadius: 10,
              textDecoration: "none",
              transition: "border-color 0.15s, box-shadow 0.15s",
              background: "white",
            }}
          >
            <div style={{ fontWeight: 600, color: "#111827", marginBottom: 4 }}>{r.label}</div>
            {r.fromPrice && (
              <div style={{ fontSize: 14, color: "var(--color-primary)", fontWeight: 500 }}>
                from {r.currency ?? "INR"} {r.fromPrice.toLocaleString()}
              </div>
            )}
          </a>
        ))}
      </div>
    </section>
  );
}
