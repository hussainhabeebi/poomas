"use client";

import { useState, useRef, useEffect, useCallback } from "react";
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
  const inputRef = useRef<HTMLInputElement>(null);

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
    ? AIRPORTS.filter(
        (a) =>
          a.code.toLowerCase().startsWith(q) ||
          a.city.toLowerCase().includes(q)
      ).slice(0, 8)
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
        ref={inputRef}
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
                {String.fromCodePoint(
                  ...[...a.country].map((c) => 0x1F1A5 + c.charCodeAt(0))
                )}
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
  const [tripType,   setTripType]   = useState<TripType>("One Way");
  const [origin,     setOrigin]     = useState<Airport | null>(null);
  const [dest,       setDest]       = useState<Airport | null>(null);
  const [departDate, setDepartDate] = useState("");
  const [returnDate, setReturnDate] = useState("");
  const [adults,     setAdults]     = useState(1);
  const [children,   setChildren]   = useState(0);
  const [infants,    setInfants]    = useState(0);
  const [paxOpen,    setPaxOpen]    = useState(false);
  const paxRef = useRef<HTMLDivElement>(null);
  const [cabinClass, setCabinClass] = useState<(typeof CABIN_CLASSES)[number]>("Economy");
  const [currency,   setCurrencyState] = useState<CurrencyCode>("INR");
  const [searching,  setSearching] = useState(false);
  const [searchStage, setSearchStage] = useState(0);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (paxRef.current && !paxRef.current.contains(e.target as Node)) setPaxOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const SEARCH_STAGES = ["Checking live fares", "Comparing airlines", "Finding your best options"];

  useEffect(() => {
    if (!searching) { setSearchStage(0); return; }
    const timer = window.setInterval(() => setSearchStage((s) => Math.min(s + 1, SEARCH_STAGES.length - 1)), 1600);
    return () => window.clearInterval(timer);
  }, [searching]);

  // Restore currency preference from localStorage on first render
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

  function swap() {
    setOrigin(dest);
    setDest(origin);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!origin || !dest) return;
    const params = new URLSearchParams({
      origin:        origin.code,
      destination:   dest.code,
      departureDate: departDate,
      adults:        String(adults),
      children:      String(children),
      infants:       String(infants),
      cabinClass:    CABIN_MAP[cabinClass] ?? "ECONOMY",
      tripType:      tripType === "Round Trip" ? "ROUNDTRIP" : "ONEWAY",
      currency,
      ...(tripType === "Round Trip" && returnDate ? { returnDate } : {}),
    });
    const url = `/search?${params.toString()}`;
    setSearching(true);
    router.prefetch(url);
    // Give mobile Safari one frame to paint the loading state before navigation.
    window.requestAnimationFrame(() => router.push(url));
  }

  const today = new Date().toISOString().split("T")[0];

  return (
    <div className="search-widget">
      {/* Top bar: trip type + passengers */}
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
        <div ref={paxRef} style={{ position: "relative" }}>
          <button
            type="button"
            className="passengers-select"
            onClick={() => setPaxOpen((v) => !v)}
            aria-label="Passengers"
            style={{ cursor: "pointer", textAlign: "left" }}
          >
            {adults + children + infants} Pax {children + infants > 0 ? `· ${adults}A${children > 0 ? ` ${children}C` : ""}${infants > 0 ? ` ${infants}I` : ""}` : adults === 1 ? "Adult" : "Adults"}
          </button>
          {paxOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 50, background: "#fff", border: "1px solid #d0d5dd", borderRadius: 14, padding: "14px 16px", minWidth: 220, boxShadow: "0 8px 24px rgba(0,0,0,.12)" }}>
              {([
                { label: "Adults", sub: "12+ years", val: adults, set: setAdults, min: 1, max: 9 },
                { label: "Children", sub: "2–11 years", val: children, set: setChildren, min: 0, max: 6 },
                { label: "Infants", sub: "Under 2", val: infants, set: setInfants, min: 0, max: 4 },
              ] as const).map(({ label, sub, val, set, min, max }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: label !== "Infants" ? "1px solid #f2f4f7" : "none" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{label}</div>
                    <div style={{ fontSize: 12, color: "#667085" }}>{sub}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button type="button" onClick={() => (set as (n: number) => void)(Math.max(min, val - 1))} disabled={val <= min} style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #d0d5dd", background: val <= min ? "#f9fafb" : "#fff", fontWeight: 800, fontSize: 18, cursor: val <= min ? "default" : "pointer", color: val <= min ? "#d0d5dd" : "#111" }}>−</button>
                    <span style={{ minWidth: 18, textAlign: "center", fontWeight: 700 }}>{val}</span>
                    <button type="button" onClick={() => (set as (n: number) => void)(Math.min(max, val + 1))} disabled={val >= max} style={{ width: 32, height: 32, borderRadius: "50%", border: "1px solid #d0d5dd", background: val >= max ? "#f9fafb" : "#fff", fontWeight: 800, fontSize: 18, cursor: val >= max ? "default" : "pointer", color: val >= max ? "#d0d5dd" : "#111" }}>+</button>
                  </div>
                </div>
              ))}
              <button type="button" onClick={() => setPaxOpen(false)} style={{ marginTop: 12, width: "100%", height: 40, borderRadius: 10, border: "none", background: "#0f172a", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14 }}>Done</button>
            </div>
          )}
        </div>

        {/* Currency selector */}
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

      <form onSubmit={handleSearch} aria-busy={searching}>
        <div className="sw-grid">
          {/* Route row: FROM ⇄ TO */}
          <div className="sw-route-row">
            <AirportInput
              id="sw-origin" label="From" value={origin}
              onChange={setOrigin} placeholder="City or airport" tabIndex={1}
            />
            <button type="button" className="swap-btn" onClick={swap} aria-label="Swap airports">
              ⇄
            </button>
            <AirportInput
              id="sw-dest" label="To" value={dest}
              onChange={setDest} placeholder="City or airport" tabIndex={2}
            />
          </div>

          {/* Extras row: DEPART + RETURN/CLASS */}
          <div className="sw-extras-row">
            <div className="search-field">
              <label htmlFor="sw-depart">Depart</label>
              <input
                id="sw-depart" className="search-input" type="date"
                value={departDate} onChange={(e) => setDepartDate(e.target.value)}
                required min={today} tabIndex={3}
              />
            </div>

            {tripType === "Round Trip" ? (
              <div className="search-field">
                <label htmlFor="sw-return">Return</label>
                <input
                  id="sw-return" className="search-input" type="date"
                  value={returnDate} onChange={(e) => setReturnDate(e.target.value)}
                  required min={departDate || today} tabIndex={4}
                />
              </div>
            ) : (
              <div className="search-field">
                <label htmlFor="sw-class">Class</label>
                <select
                  id="sw-class" className="search-input" value={cabinClass}
                  onChange={(e) => setCabinClass(e.target.value as typeof cabinClass)}
                  tabIndex={4}
                >
                  {CABIN_CLASSES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* Search button */}
          <button type="submit" className={searching ? "search-btn search-btn-loading" : "search-btn"} tabIndex={5} disabled={searching}>
            {searching ? <><span className="search-spinner" /> {SEARCH_STAGES[searchStage]}</> : <>Search live flights <span aria-hidden="true">→</span></>}
          </button>
        </div>
      </form>

      {searching && (
        <div className="search-progress" role="status" aria-live="polite">
          <div className="search-progress-track"><span className="search-plane">✈</span><i /></div>
          <div><strong>{SEARCH_STAGES[searchStage]}</strong><small>Live supplier results can take a few seconds. Please don’t close this page.</small></div>
        </div>
      )}

      <div className="search-shortcuts" aria-label="Quick travel benefits">
        <span>✓ Live fares</span><span>✓ Baggage details</span><span>✓ Secure checkout</span>
      </div>
    </div>
  );
}
