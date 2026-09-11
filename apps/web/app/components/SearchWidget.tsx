"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

const AIRPORTS = [
  { code: "BOM", city: "Mumbai",        country: "IN" },
  { code: "DEL", city: "New Delhi",     country: "IN" },
  { code: "CCJ", city: "Kozhikode",     country: "IN" },
  { code: "COK", city: "Kochi",         country: "IN" },
  { code: "TRV", city: "Trivandrum",    country: "IN" },
  { code: "MAA", city: "Chennai",       country: "IN" },
  { code: "BLR", city: "Bengaluru",     country: "IN" },
  { code: "HYD", city: "Hyderabad",     country: "IN" },
  { code: "AMD", city: "Ahmedabad",     country: "IN" },
  { code: "PNQ", city: "Pune",          country: "IN" },
  { code: "GOI", city: "Goa",           country: "IN" },
  { code: "CCU", city: "Kolkata",       country: "IN" },
  { code: "LKO", city: "Lucknow",       country: "IN" },
  { code: "IXJ", city: "Jammu",         country: "IN" },
  { code: "SXR", city: "Srinagar",      country: "IN" },
  { code: "ATQ", city: "Amritsar",      country: "IN" },
  { code: "IXC", city: "Chandigarh",    country: "IN" },
  { code: "DXB", city: "Dubai",         country: "AE" },
  { code: "AUH", city: "Abu Dhabi",     country: "AE" },
  { code: "SHJ", city: "Sharjah",       country: "AE" },
  { code: "DOH", city: "Doha",          country: "QA" },
  { code: "MCT", city: "Muscat",        country: "OM" },
  { code: "BAH", city: "Bahrain",       country: "BH" },
  { code: "KWI", city: "Kuwait City",   country: "KW" },
  { code: "RUH", city: "Riyadh",        country: "SA" },
  { code: "JED", city: "Jeddah",        country: "SA" },
  { code: "DMM", city: "Dammam",        country: "SA" },
  { code: "LHR", city: "London",        country: "GB" },
  { code: "CDG", city: "Paris",         country: "FR" },
  { code: "FRA", city: "Frankfurt",     country: "DE" },
  { code: "SIN", city: "Singapore",     country: "SG" },
  { code: "KUL", city: "Kuala Lumpur",  country: "MY" },
  { code: "BKK", city: "Bangkok",       country: "TH" },
  { code: "HKG", city: "Hong Kong",     country: "HK" },
  { code: "NRT", city: "Tokyo",         country: "JP" },
  { code: "JFK", city: "New York",      country: "US" },
  { code: "LAX", city: "Los Angeles",   country: "US" },
  { code: "YYZ", city: "Toronto",       country: "CA" },
  { code: "SYD", city: "Sydney",        country: "AU" },
  { code: "MEL", city: "Melbourne",     country: "AU" },
];

const CABIN_CLASSES = ["Economy", "Premium Economy", "Business", "First"] as const;
const CABIN_MAP: Record<string, string> = {
  "Economy": "ECONOMY", "Premium Economy": "PREMIUM_ECONOMY",
  "Business": "BUSINESS", "First": "FIRST",
};

const CURRENCIES = [
  { code: "INR", symbol: "₹" },
  { code: "AED", symbol: "د.إ" },
  { code: "USD", symbol: "$" },
] as const;
type CurrencyCode = "INR" | "AED" | "USD";

type Airport = typeof AIRPORTS[number];
type TripType = "One Way" | "Round Trip";
type SearchMode = "FLIGHTS" | "HOTELS";

function AirportInput({
  id, label, value, onChange, placeholder, tabIndex,
}: {
  id: string; label: string; value: Airport | null;
  onChange: (a: Airport) => void; placeholder: string; tabIndex?: number;
}) {
  const displayVal = value ? `${value.city} (${value.code})` : "";
  const [query, setQuery] = useState(displayVal);
  const [open,  setOpen]  = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value ? `${value.city} (${value.code})` : "");
  }, [value]);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value ? `${value.city} (${value.code})` : "");
      }
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [value]);

  const q = query.toLowerCase().trim();
  const matches = q
    ? AIRPORTS.filter((a) => a.code.toLowerCase().startsWith(q) || a.city.toLowerCase().includes(q)).slice(0, 8)
    : AIRPORTS.slice(0, 8);

  function pick(a: Airport) {
    onChange(a);
    setQuery(`${a.city} (${a.code})`);
    setOpen(false);
  }

  return (
    <div className="airport-wrap" ref={wrapRef}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="search-input"
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        inputMode="text"
        tabIndex={tabIndex}
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        required
      />
      {open && matches.length > 0 && (
        <ul className="airport-dropdown">
          {matches.map((a) => (
            <li
              key={a.code}
              onMouseDown={(e) => { e.preventDefault(); pick(a); }}
              onTouchEnd={(e) => { e.preventDefault(); pick(a); }}
            >
              <span className="ap-code">{a.code}</span>
              <span className="ap-city">{a.city}</span>
              <span className="ap-flag">
                {String.fromCodePoint(...[...a.country].map((c) => 0x1F1A5 + c.charCodeAt(0)))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function SearchWidget() {
  const router = useRouter();

  const [searchMode, setSearchMode]  = useState<SearchMode>("FLIGHTS");
  const [tripType,   setTripType]    = useState<TripType>("One Way");
  const [origin,     setOrigin]      = useState<Airport | null>(null);
  const [dest,       setDest]        = useState<Airport | null>(null);
  const [departDate, setDepartDate]  = useState("");
  const [returnDate, setReturnDate]  = useState("");
  const [adults,     setAdults]      = useState(1);
  const [cabinClass, setCabinClass]  = useState<(typeof CABIN_CLASSES)[number]>("Economy");
  const [currency,   setCurrencyState] = useState<CurrencyCode>("INR");
  const [searching,  setSearching]   = useState(false);
  const [searchStage, setSearchStage] = useState(0);

  // Hotel state
  const [hotelCity,    setHotelCity]    = useState<Airport | null>(null);
  const [hotelCheckIn, setHotelCheckIn] = useState("");
  const [hotelCheckOut, setHotelCheckOut] = useState("");
  const [hotelRooms,   setHotelRooms]   = useState(1);
  const [hotelAdults,  setHotelAdults]  = useState(2);

  const SEARCH_STAGES = ["Checking live fares", "Comparing airlines", "Finding your best options"];
  const HOTEL_STAGES  = ["Searching hotels", "Comparing rates", "Finding best deals"];

  useEffect(() => {
    if (!searching) { setSearchStage(0); return; }
    const stages = searchMode === "HOTELS" ? HOTEL_STAGES : SEARCH_STAGES;
    const timer = window.setInterval(() => setSearchStage((s) => Math.min(s + 1, stages.length - 1)), 1600);
    return () => window.clearInterval(timer);
  }, [searching, searchMode]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("pref_currency") as CurrencyCode | null;
      if (saved && CURRENCIES.some((c) => c.code === saved)) setCurrencyState(saved);
    } catch {}
  }, []);

  function setCurrency(code: CurrencyCode) {
    setCurrencyState(code);
    try { localStorage.setItem("pref_currency", code); } catch {}
  }

  function swap() { setOrigin(dest); setDest(origin); }

  function handleFlightSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!origin || !dest) return;
    const params = new URLSearchParams({
      origin:        origin.code,
      destination:   dest.code,
      departureDate: departDate,
      adults:        String(adults),
      cabinClass:    CABIN_MAP[cabinClass] ?? "ECONOMY",
      tripType:      tripType === "Round Trip" ? "ROUNDTRIP" : "ONEWAY",
      currency,
      ...(tripType === "Round Trip" && returnDate ? { returnDate } : {}),
    });
    const url = `/search?${params.toString()}`;
    setSearching(true);
    router.prefetch(url);
    window.requestAnimationFrame(() => router.push(url));
  }

  function handleHotelSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!hotelCity) return;
    const params = new URLSearchParams({
      cityCode:  hotelCity.code,
      city:      hotelCity.city,
      checkIn:   hotelCheckIn,
      checkOut:  hotelCheckOut,
      rooms:     String(hotelRooms),
      adults:    String(hotelAdults),
      currency,
    });
    const url = `/hotels/search?${params.toString()}`;
    setSearching(true);
    router.prefetch(url);
    window.requestAnimationFrame(() => router.push(url));
  }

  const today = new Date().toISOString().split("T")[0];
  const stages = searchMode === "HOTELS" ? HOTEL_STAGES : SEARCH_STAGES;

  return (
    <div className="search-widget">
      {/* Mode tabs: Flights / Hotels */}
      <div className="mode-tabs">
        <button
          type="button"
          className={searchMode === "FLIGHTS" ? "mode-tab mode-tab-active" : "mode-tab"}
          onClick={() => { setSearchMode("FLIGHTS"); setSearching(false); }}
        >
          ✈ Flights
        </button>
        <button
          type="button"
          className={searchMode === "HOTELS" ? "mode-tab mode-tab-active" : "mode-tab"}
          onClick={() => { setSearchMode("HOTELS"); setSearching(false); }}
        >
          🏨 Hotels
        </button>
      </div>

      {searchMode === "FLIGHTS" ? (
        <>
          <div className="trip-tabs">
            {(["One Way", "Round Trip"] as TripType[]).map((t) => (
              <button
                key={t} type="button"
                onClick={() => setTripType(t)}
                className={t === tripType ? "trip-tab trip-tab-active" : "trip-tab trip-tab-inactive"}
              >
                {t}
              </button>
            ))}
            <select
              className="passengers-select"
              value={adults}
              onChange={(e) => setAdults(Number(e.target.value))}
              aria-label="Passengers"
            >
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n} {n === 1 ? "Adult" : "Adults"}</option>
              ))}
            </select>
            <div className="currency-pills" role="group" aria-label="Currency">
              {CURRENCIES.map((cur) => (
                <button
                  key={cur.code}
                  type="button"
                  className={currency === cur.code ? "currency-pill currency-pill-active" : "currency-pill"}
                  onClick={() => setCurrency(cur.code)}
                  aria-pressed={currency === cur.code}
                >
                  {cur.symbol} {cur.code}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleFlightSearch} aria-busy={searching}>
            <div className="sw-grid">
              <div className="sw-route-row">
                <AirportInput id="sw-origin" label="From" value={origin} onChange={setOrigin} placeholder="City or airport" tabIndex={1} />
                <button type="button" className="swap-btn" onClick={swap} aria-label="Swap airports">⇄</button>
                <AirportInput id="sw-dest" label="To" value={dest} onChange={setDest} placeholder="City or airport" tabIndex={2} />
              </div>
              <div className="sw-extras-row">
                <div className="search-field">
                  <label htmlFor="sw-depart">Depart</label>
                  <input id="sw-depart" className="search-input" type="date" value={departDate} onChange={(e) => setDepartDate(e.target.value)} required min={today} tabIndex={3} />
                </div>
                {tripType === "Round Trip" ? (
                  <div className="search-field">
                    <label htmlFor="sw-return">Return</label>
                    <input id="sw-return" className="search-input" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} required min={departDate || today} tabIndex={4} />
                  </div>
                ) : (
                  <div className="search-field">
                    <label htmlFor="sw-class">Class</label>
                    <select id="sw-class" className="search-input" value={cabinClass} onChange={(e) => setCabinClass(e.target.value as typeof cabinClass)} tabIndex={4}>
                      {CABIN_CLASSES.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <button type="submit" className={searching ? "search-btn search-btn-loading" : "search-btn"} tabIndex={5} disabled={searching}>
                {searching ? <><span className="search-spinner" /> {stages[searchStage]}</> : <>Search live flights <span aria-hidden="true">→</span></>}
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <div className="trip-tabs">
            <span style={{ fontSize: 13, fontWeight: 600, color: "#6b7280" }}>Hotel search</span>
            <div className="currency-pills" role="group" aria-label="Currency" style={{ marginLeft: "auto" }}>
              {CURRENCIES.map((cur) => (
                <button
                  key={cur.code}
                  type="button"
                  className={currency === cur.code ? "currency-pill currency-pill-active" : "currency-pill"}
                  onClick={() => setCurrency(cur.code)}
                  aria-pressed={currency === cur.code}
                >
                  {cur.symbol} {cur.code}
                </button>
              ))}
            </div>
          </div>

          <form onSubmit={handleHotelSearch} aria-busy={searching}>
            <div className="sw-grid">
              <div className="sw-route-row" style={{ gridTemplateColumns: "1fr" }}>
                <AirportInput id="hw-city" label="Destination city" value={hotelCity} onChange={setHotelCity} placeholder="Dubai, Mumbai, London…" tabIndex={1} />
              </div>
              <div className="sw-extras-row hotel-extras-row">
                <div className="search-field">
                  <label htmlFor="hw-checkin">Check-in</label>
                  <input id="hw-checkin" className="search-input" type="date" value={hotelCheckIn} onChange={(e) => setHotelCheckIn(e.target.value)} required min={today} tabIndex={2} />
                </div>
                <div className="search-field">
                  <label htmlFor="hw-checkout">Check-out</label>
                  <input id="hw-checkout" className="search-input" type="date" value={hotelCheckOut} onChange={(e) => setHotelCheckOut(e.target.value)} required min={hotelCheckIn || today} tabIndex={3} />
                </div>
                <div className="search-field">
                  <label htmlFor="hw-rooms">Rooms</label>
                  <select id="hw-rooms" className="search-input" value={hotelRooms} onChange={(e) => setHotelRooms(Number(e.target.value))} tabIndex={4}>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {n === 1 ? "Room" : "Rooms"}</option>)}
                  </select>
                </div>
                <div className="search-field">
                  <label htmlFor="hw-adults">Adults / room</label>
                  <select id="hw-adults" className="search-input" value={hotelAdults} onChange={(e) => setHotelAdults(Number(e.target.value))} tabIndex={5}>
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} Adult{n > 1 ? "s" : ""}</option>)}
                  </select>
                </div>
              </div>
              <button type="submit" className={searching ? "search-btn search-btn-loading" : "search-btn"} tabIndex={6} disabled={searching}>
                {searching ? <><span className="search-spinner" /> {stages[searchStage]}</> : <>Search hotels <span aria-hidden="true">→</span></>}
              </button>
            </div>
          </form>
        </>
      )}

      {searching && (
        <div className="search-progress" role="status" aria-live="polite">
          <div className="search-progress-track"><span className="search-plane">{searchMode === "HOTELS" ? "🏨" : "✈"}</span><i /></div>
          <div><strong>{stages[searchStage]}</strong><small>Live results can take a few seconds. Please don't close this page.</small></div>
        </div>
      )}

      <div className="search-shortcuts" aria-label="Quick travel benefits">
        {searchMode === "FLIGHTS"
          ? <><span>✓ Live fares</span><span>✓ Baggage details</span><span>✓ Secure checkout</span></>
          : <><span>✓ Live hotel rates</span><span>✓ Free cancellation options</span><span>✓ Breakfast included options</span></>
        }
      </div>
    </div>
  );
}
