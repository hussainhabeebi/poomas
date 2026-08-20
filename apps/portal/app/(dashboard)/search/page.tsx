"use client";
export const runtime = "edge";

import { useState } from "react";

const CABIN_CLASSES = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] as const;

interface FareCard {
  id:           string;
  supplier:     string;
  airline:      string;
  airlineName:  string;
  flightNumber: string;
  origin:       string;
  destination:  string;
  departureTime: string;
  arrivalTime:  string;
  duration:     number;
  stops:        number;
  displayPrice: number;
  currency:     string;
  isRefundable: boolean;
  baggage:      { cabin: string; checked: string };
  isBookable:   boolean;
}

export default function SearchPage() {
  const [form, setForm] = useState({
    origin:        "",
    destination:   "",
    departureDate: "",
    adults:        1,
    cabinClass:    "ECONOMY" as (typeof CABIN_CLASSES)[number],
  });
  const [results, setResults] = useState<FareCard[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/search", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ ...form, tripType: "ONEWAY" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { fares: FareCard[] };
      setResults(data.fares);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  const durationStr = (min: number) =>
    `${Math.floor(min / 60)}h ${min % 60}m`;

  const currSym = (c: string) =>
    c === "INR" ? "₹" : c === "AED" ? "د.إ" : "$";

  return (
    <div>
      <h1 style={{ marginBottom: 24, fontSize: 22, fontWeight: 700 }}>Book Flights</h1>

      {/* Search form */}
      <form onSubmit={handleSearch} style={{
        background: "white", padding: 24, borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,.08)", marginBottom: 32,
        display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>FROM</label>
          <input
            required placeholder="e.g. COK"
            value={form.origin}
            onChange={(e) => setForm((f) => ({ ...f, origin: e.target.value.toUpperCase() }))}
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>TO</label>
          <input
            required placeholder="e.g. DXB"
            value={form.destination}
            onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value.toUpperCase() }))}
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>DEPARTURE DATE</label>
          <input
            required type="date"
            value={form.departureDate}
            onChange={(e) => setForm((f) => ({ ...f, departureDate: e.target.value }))}
            style={inputStyle}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>ADULTS</label>
          <select
            value={form.adults}
            onChange={(e) => setForm((f) => ({ ...f, adults: Number(e.target.value) }))}
            style={inputStyle}
          >
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>CABIN</label>
          <select
            value={form.cabinClass}
            onChange={(e) => setForm((f) => ({ ...f, cabinClass: e.target.value as typeof form.cabinClass }))}
            style={inputStyle}
          >
            {CABIN_CLASSES.map((c) => <option key={c}>{c.replace("_", " ")}</option>)}
          </select>
        </div>

        <button type="submit" disabled={loading} style={btnStyle}>
          {loading ? "Searching…" : "Search Flights"}
        </button>
      </form>

      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: 16, marginBottom: 24, color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {/* Results */}
      {results !== null && (
        <div>
          <h2 style={{ marginBottom: 16, fontSize: 16, fontWeight: 600, color: "#374151" }}>
            {results.length} flights found
          </h2>
          {results.length === 0 && (
            <p style={{ color: "#6b7280" }}>No flights found for the selected route and date.</p>
          )}
          {results.map((fare) => (
            <div key={fare.id} style={{
              background: "white", borderRadius: 12, padding: 20, marginBottom: 16,
              boxShadow: "0 1px 4px rgba(0,0,0,.08)", display: "flex", alignItems: "center", gap: 24,
            }}>
              {/* Airline */}
              <div style={{ minWidth: 100 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{fare.airlineName}</div>
                <div style={{ color: "#6b7280", fontSize: 13 }}>{fare.flightNumber}</div>
              </div>

              {/* Route */}
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {new Date(fare.departureTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 13 }}>{fare.origin}</div>
                </div>

                <div style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>{durationStr(fare.duration)}</div>
                  <div style={{ borderTop: "2px solid #e5e7eb", position: "relative" }} />
                  <div style={{ fontSize: 12, color: fare.stops === 0 ? "#16a34a" : "#f59e0b" }}>
                    {fare.stops === 0 ? "Non-stop" : `${fare.stops} stop${fare.stops > 1 ? "s" : ""}`}
                  </div>
                </div>

                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>
                    {new Date(fare.arrivalTime).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 13 }}>{fare.destination}</div>
                </div>
              </div>

              {/* Baggage */}
              <div style={{ textAlign: "center", minWidth: 80 }}>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Cabin {fare.baggage.cabin}</div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>Check {fare.baggage.checked}</div>
                <div style={{ fontSize: 12, color: fare.isRefundable ? "#16a34a" : "#6b7280", marginTop: 4 }}>
                  {fare.isRefundable ? "Refundable" : "Non-refundable"}
                </div>
              </div>

              {/* Price + Book */}
              <div style={{ textAlign: "right", minWidth: 140 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#E31E24" }}>
                  {currSym(fare.currency)}{fare.displayPrice.toLocaleString("en-IN")}
                </div>
                {fare.isBookable ? (
                  <a
                    href={`/checkout?fareId=${fare.id}&supplier=${fare.supplier}`}
                    style={{ ...btnStyle, display: "inline-block", marginTop: 8, textDecoration: "none", fontSize: 13, padding: "8px 16px" }}
                  >
                    Book →
                  </a>
                ) : (
                  <span style={{ fontSize: 12, color: "#9ca3af", display: "block", marginTop: 8 }}>Indicative only</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 14px",
  fontSize: 14, outline: "none", minWidth: 120,
};

const btnStyle: React.CSSProperties = {
  background: "#E31E24", color: "white", border: "none",
  borderRadius: 8, padding: "10px 24px", fontSize: 14, fontWeight: 600,
  cursor: "pointer",
};
