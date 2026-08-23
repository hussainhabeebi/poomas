"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TRIP_TYPES  = ["One Way", "Round Trip"] as const;
const CABIN_CLASSES = ["Economy", "Premium Economy", "Business", "First"] as const;
const CABIN_MAP: Record<string, string> = {
  "Economy": "ECONOMY", "Premium Economy": "PREMIUM_ECONOMY",
  "Business": "BUSINESS", "First": "FIRST",
};

export default function SearchWidget() {
  const router = useRouter();
  const [tripType, setTripType]         = useState<(typeof TRIP_TYPES)[number]>("One Way");
  const [origin, setOrigin]             = useState("");
  const [destination, setDestination]   = useState("");
  const [departDate, setDepartDate]     = useState("");
  const [returnDate, setReturnDate]     = useState("");
  const [adults, setAdults]             = useState(1);
  const [cabinClass, setCabinClass]     = useState<(typeof CABIN_CLASSES)[number]>("Economy");

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams({
      origin:        origin.toUpperCase().trim(),
      destination:   destination.toUpperCase().trim(),
      departureDate: departDate,
      adults:        String(adults),
      cabinClass:    CABIN_MAP[cabinClass] ?? "ECONOMY",
      tripType:      tripType === "Round Trip" ? "ROUNDTRIP" : "ONEWAY",
      ...(tripType === "Round Trip" && returnDate ? { returnDate } : {}),
    });
    router.push(`/search?${params}`);
  }

  return (
    <div className="search-widget">
      {/* Trip type tabs */}
      <div className="trip-tabs">
        {TRIP_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTripType(t)}
            className={t === tripType ? "trip-tab trip-tab-active" : "trip-tab trip-tab-inactive"}
          >
            {t}
          </button>
        ))}
      </div>

      <form onSubmit={handleSearch}>
        <div className="search-fields">
          <div className="search-field">
            <label htmlFor="sw-origin">From</label>
            <input
              id="sw-origin"
              className="search-input"
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              placeholder="BOM, DEL, CCJ…"
              required
              maxLength={3}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </div>

          <div className="search-field">
            <label htmlFor="sw-dest">To</label>
            <input
              id="sw-dest"
              className="search-input"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="DXB, SIN, LHR…"
              required
              maxLength={3}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
            />
          </div>

          <div className="search-field">
            <label htmlFor="sw-depart">Depart</label>
            <input
              id="sw-depart"
              className="search-input"
              type="date"
              value={departDate}
              onChange={(e) => setDepartDate(e.target.value)}
              required
              min={new Date().toISOString().split("T")[0]}
            />
          </div>

          {tripType === "Round Trip" ? (
            <div className="search-field">
              <label htmlFor="sw-return">Return</label>
              <input
                id="sw-return"
                className="search-input"
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                required
                min={departDate || new Date().toISOString().split("T")[0]}
              />
            </div>
          ) : (
            <div className="search-field">
              <label htmlFor="sw-class">Class</label>
              <select
                id="sw-class"
                className="search-input"
                value={cabinClass}
                onChange={(e) => setCabinClass(e.target.value as typeof cabinClass)}
              >
                {CABIN_CLASSES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          )}

          <button type="submit" className="search-btn">
            Search Flights
          </button>
        </div>
      </form>
    </div>
  );
}
