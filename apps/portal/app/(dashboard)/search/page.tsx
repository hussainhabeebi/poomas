"use client";
import { useState, useEffect } from "react";

const CABIN_CLASSES = ["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"] as const;

// Stable anonymous session ID persisted in localStorage for SERP trial tracking
function getSessionId(): string {
  try {
    const key = "poomas_session_id";
    let id = localStorage.getItem(key);
    if (!id) {
      id = `anon_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return `anon_${Date.now()}`;
  }
}

interface FareCard {
  id:            string;
  supplier:      string;
  airline:       string;
  airlineName:   string;
  flightNumber:  string;
  origin:        string;
  destination:   string;
  departureTime: string;
  arrivalTime:   string;
  duration:      number;
  stops:         number;
  displayPrice:  number;
  currency:      string;
  isRefundable:  boolean;
  baggage:       { cabin: string; checked: string };
  isBookable:    boolean;
}

interface SearchResponse {
  fares:               FareCard[];
  usedSuppliers:       string[];
  isIndicative:        boolean;
  serpTrialsRemaining: number;
  disclaimer?:         string;
}

export default function SearchPage() {
  const [form, setForm] = useState({
    origin:        "",
    destination:   "",
    departureDate: "",
    adults:        1,
    cabinClass:    "ECONOMY" as (typeof CABIN_CLASSES)[number],
  });
  const [results, setResults]   = useState<SearchResponse | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [sessionId, setSessionId] = useState("");

  useEffect(() => { setSessionId(getSessionId()); }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (sessionId) headers["X-Session-ID"] = sessionId;

      const res = await fetch("/api/search", {
        method: "POST",
        headers,
        body:   JSON.stringify({ ...form, tripType: "ONEWAY" }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as SearchResponse;
      setResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  const durationStr = (min: number) => `${Math.floor(min / 60)}h ${min % 60}m`;
  const currSym = (c: string) => c === "INR" ? "₹" : c === "AED" ? "د.إ" : "$";

  const bookable  = results?.fares.filter((f) => f.isBookable)  ?? [];
  const indicative = results?.fares.filter((f) => !f.isBookable) ?? [];

  return (
    <div>
      <h1 style={{ marginBottom: 24, fontSize: 22, fontWeight: 700 }}>Book Flights</h1>

      {/* Search form */}
      <form onSubmit={handleSearch} style={{
        background: "white", padding: 24, borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,.08)", marginBottom: 32,
        display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end",
      }}>
        {[
          { label: "FROM",  key: "origin",      placeholder: "e.g. COK", type: "text"  },
          { label: "TO",    key: "destination", placeholder: "e.g. DXB", type: "text"  },
          { label: "DATE",  key: "departureDate", placeholder: "", type: "date" },
        ].map(({ label, key, placeholder, type }) => (
          <div key={key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{label}</label>
            <input
              required type={type} placeholder={placeholder}
              value={form[key as keyof typeof form] as string}
              onChange={(e) => setForm((f) => ({
                ...f,
                [key]: key === "origin" || key === "destination"
                  ? e.target.value.toUpperCase()
                  : e.target.value,
              }))}
              style={inputStyle}
            />
          </div>
        ))}

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>ADULTS</label>
          <select value={form.adults} onChange={(e) => setForm((f) => ({ ...f, adults: Number(e.target.value) }))} style={inputStyle}>
            {[1,2,3,4,5,6,7,8,9].map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>CABIN</label>
          <select value={form.cabinClass} onChange={(e) => setForm((f) => ({ ...f, cabinClass: e.target.value as typeof form.cabinClass }))} style={inputStyle}>
            {CABIN_CLASSES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#374151" }}>
              {results.fares.length} flights found
            </h2>

            {/* Trial badge */}
            {results.serpTrialsRemaining >= 0 && results.usedSuppliers.includes("GOOGLE_SERP") && (
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "#eff6ff", border: "1px solid #bfdbfe",
                borderRadius: 8, padding: "6px 12px", fontSize: 13,
              }}>
                <span style={{ fontSize: 16 }}>✈</span>
                <span style={{ color: "#1d4ed8", fontWeight: 600 }}>Google Flights included</span>
                {results.serpTrialsRemaining > 0 && (
                  <span style={{ color: "#6b7280" }}>· {results.serpTrialsRemaining} free preview{results.serpTrialsRemaining !== 1 ? "s" : ""} left</span>
                )}
                {results.serpTrialsRemaining === 0 && (
                  <span style={{ color: "#6b7280" }}>· last free preview</span>
                )}
              </div>
            )}
          </div>

          {results.fares.length === 0 && (
            <p style={{ color: "#6b7280" }}>No flights found for the selected route and date.</p>
          )}

          {/* Bookable fares */}
          {bookable.map((fare) => <FareRow key={fare.id} fare={fare} currSym={currSym} durationStr={durationStr} />)}

          {/* Google Flights indicative fares */}
          {indicative.length > 0 && (
            <>
              <div style={{
                display: "flex", alignItems: "center", gap: 12, margin: "24px 0 12px",
              }}>
                <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
                <span style={{
                  fontSize: 12, fontWeight: 700, color: "#6b7280", letterSpacing: "0.05em",
                  background: "#f3f4f6", borderRadius: 6, padding: "4px 10px",
                }}>
                  GOOGLE FLIGHTS · INDICATIVE PRICES
                </span>
                <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
              </div>

              {results.disclaimer && (
                <div style={{
                  background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8,
                  padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#92400e",
                }}>
                  ⚠ {results.disclaimer}
                </div>
              )}

              {indicative.map((fare) => <FareRow key={fare.id} fare={fare} currSym={currSym} durationStr={durationStr} indicative />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FareRow({
  fare, currSym, durationStr, indicative = false,
}: {
  fare: FareCard;
  currSym: (c: string) => string;
  durationStr: (m: number) => string;
  indicative?: boolean;
}) {
  return (
    <div style={{
      background: indicative ? "#fafafa" : "white",
      border: indicative ? "1px dashed #d1d5db" : "none",
      borderRadius: 12, padding: 20, marginBottom: 16,
      boxShadow: indicative ? "none" : "0 1px 4px rgba(0,0,0,.08)",
      display: "flex", alignItems: "center", gap: 24,
      opacity: indicative ? 0.9 : 1,
    }}>
      {/* Airline */}
      <div style={{ minWidth: 100 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{fare.airlineName}</div>
        <div style={{ color: "#6b7280", fontSize: 13 }}>{fare.flightNumber}</div>
        {indicative && (
          <div style={{
            marginTop: 4, fontSize: 11, fontWeight: 700, color: "#2563eb",
            background: "#dbeafe", borderRadius: 4, padding: "2px 6px", display: "inline-block",
          }}>
            Google Flights
          </div>
        )}
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
          <div style={{ borderTop: "2px solid #e5e7eb" }} />
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

      {/* Price + action */}
      <div style={{ textAlign: "right", minWidth: 140 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: indicative ? "#374151" : "#E31E24" }}>
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
          <button
            onClick={() => window.open("https://wa.me/", "_blank")}
            style={{
              marginTop: 8, fontSize: 12, padding: "7px 14px", cursor: "pointer",
              background: "#25d366", color: "white", border: "none", borderRadius: 8, fontWeight: 600,
            }}
          >
            Enquire on WhatsApp
          </button>
        )}
      </div>
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
