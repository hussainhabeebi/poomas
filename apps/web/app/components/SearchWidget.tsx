"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TRIP_TYPES = ["One Way", "Round Trip", "Multi-City"] as const;
const CABIN_CLASSES = ["Economy", "Premium Economy", "Business", "First"] as const;

export default function SearchWidget() {
  const router = useRouter();
  const [tripType, setTripType]     = useState<(typeof TRIP_TYPES)[number]>("One Way");
  const [origin, setOrigin]         = useState("");
  const [destination, setDestination] = useState("");
  const [departDate, setDepartDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [adults, setAdults]         = useState(1);
  const [cabinClass, setCabinClass] = useState<(typeof CABIN_CLASSES)[number]>("Economy");

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams({
      origin:        origin.toUpperCase(),
      destination:   destination.toUpperCase(),
      departureDate: departDate,
      adults:        String(adults),
      cabinClass:    cabinClass.toUpperCase().replace(" ", "_"),
      tripType:      tripType.toUpperCase().replace(" ", ""),
      ...(tripType === "Round Trip" && returnDate ? { returnDate } : {}),
    });
    router.push(`/search?${params}`);
  }

  return (
    <div style={{
      background: "white",
      borderRadius: 12,
      padding: 24,
      boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
      marginTop: -40,
      position: "relative",
      zIndex: 10,
    }}>
      {/* Trip type tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {TRIP_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setTripType(t)}
            style={{
              padding: "6px 16px",
              borderRadius: 20,
              border: "none",
              cursor: "pointer",
              background: tripType === t ? "var(--color-primary)" : "#f3f4f6",
              color:      tripType === t ? "white" : "#374151",
              fontWeight: tripType === t ? 600 : 400,
              fontSize: 14,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <form onSubmit={handleSearch}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>FROM</span>
            <input
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="City or airport"
              required
              maxLength={3}
              style={inputStyle}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>TO</span>
            <input
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="City or airport"
              required
              maxLength={3}
              style={inputStyle}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>DEPART</span>
            <input
              type="date"
              value={departDate}
              onChange={(e) => setDepartDate(e.target.value)}
              required
              style={inputStyle}
            />
          </label>

          {tripType === "Round Trip" ? (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>RETURN</span>
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                required
                style={inputStyle}
              />
            </label>
          ) : (
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 500 }}>CLASS</span>
              <select
                value={cabinClass}
                onChange={(e) => setCabinClass(e.target.value as typeof cabinClass)}
                style={{ ...inputStyle, cursor: "pointer" }}
              >
                {CABIN_CLASSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
          )}

          <button
            type="submit"
            style={{
              background: "var(--color-primary)",
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "14px 28px",
              fontWeight: 700,
              fontSize: 15,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Search Flights
          </button>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  border: "1.5px solid #e5e7eb",
  borderRadius: 8,
  fontSize: 15,
  outline: "none",
  width: "100%",
};
