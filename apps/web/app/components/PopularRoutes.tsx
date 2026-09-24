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
    <div className="popular-route-list">
      <div className="popular-route-grid">
        {displayRoutes.map((r, i) => (
          <a
            key={i}
            href={buildSearchUrl(r)}
            className="popular-route-card"
          >
            <span className="popular-route-title">{r.label}</span>
            {r.fromPrice && (
              <span className="popular-route-fare">
                from {r.currency ?? "INR"} {r.fromPrice.toLocaleString()}
              </span>
            )}
            <span className="popular-route-arrow" aria-hidden="true">→</span>
          </a>
        ))}
      </div>
    </div>
  );
}
