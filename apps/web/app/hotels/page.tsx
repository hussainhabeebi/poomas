"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

const CITIES = [
  { code: "DXB", city: "Dubai",         country: "AE" },
  { code: "AUH", city: "Abu Dhabi",     country: "AE" },
  { code: "SHJ", city: "Sharjah",       country: "AE" },
  { code: "DOH", city: "Doha",          country: "QA" },
  { code: "BOM", city: "Mumbai",        country: "IN" },
  { code: "DEL", city: "New Delhi",     country: "IN" },
  { code: "CCJ", city: "Kozhikode",     country: "IN" },
  { code: "COK", city: "Kochi",         country: "IN" },
  { code: "BLR", city: "Bengaluru",     country: "IN" },
  { code: "HYD", city: "Hyderabad",     country: "IN" },
  { code: "MAA", city: "Chennai",       country: "IN" },
  { code: "GOI", city: "Goa",           country: "IN" },
  { code: "AMD", city: "Ahmedabad",     country: "IN" },
  { code: "CCU", city: "Kolkata",       country: "IN" },
  { code: "TRV", city: "Trivandrum",    country: "IN" },
  { code: "MCT", city: "Muscat",        country: "OM" },
  { code: "RUH", city: "Riyadh",        country: "SA" },
  { code: "JED", city: "Jeddah",        country: "SA" },
  { code: "KWI", city: "Kuwait City",   country: "KW" },
  { code: "BAH", city: "Bahrain",       country: "BH" },
  { code: "LHR", city: "London",        country: "GB" },
  { code: "CDG", city: "Paris",         country: "FR" },
  { code: "SIN", city: "Singapore",     country: "SG" },
  { code: "BKK", city: "Bangkok",       country: "TH" },
  { code: "KUL", city: "Kuala Lumpur",  country: "MY" },
  { code: "NRT", city: "Tokyo",         country: "JP" },
  { code: "JFK", city: "New York",      country: "US" },
  { code: "SYD", city: "Sydney",        country: "AU" },
];

type City = typeof CITIES[number];
type CurrencyCode = "INR" | "AED" | "USD";
const CURRENCIES = [
  { code: "INR" as CurrencyCode, symbol: "₹" },
  { code: "AED" as CurrencyCode, symbol: "د.إ" },
  { code: "USD" as CurrencyCode, symbol: "$" },
];

function CityInput({
  label, value, onChange,
}: { label: string; value: City | null; onChange: (c: City) => void }) {
  const displayVal = value ? `${value.city} (${value.code})` : "";
  const [query, setQuery] = useState(displayVal);
  const [open, setOpen]   = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setQuery(value ? `${value.city} (${value.code})` : "");
  }, [value]);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(value ? `${value.city} (${value.code})` : "");
      }
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, [value]);

  const q = query.toLowerCase().trim();
  const matches = q
    ? CITIES.filter((c) => c.code.toLowerCase().startsWith(q) || c.city.toLowerCase().includes(q)).slice(0, 8)
    : CITIES.slice(0, 8);

  return (
    <div className="hw-field-wrap" ref={wrapRef}>
      <label>{label}</label>
      <input
        className="hw-input"
        value={query}
        placeholder="City or destination"
        autoComplete="off"
        onFocus={() => { setQuery(""); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        required
      />
      {open && matches.length > 0 && (
        <ul className="hw-dropdown">
          {matches.map((c) => (
            <li
              key={c.code}
              onMouseDown={(e) => { e.preventDefault(); onChange(c); setQuery(`${c.city} (${c.code})`); setOpen(false); }}
              onTouchEnd={(e) => { e.preventDefault(); onChange(c); setQuery(`${c.city} (${c.code})`); setOpen(false); }}
            >
              <span className="hw-code">{c.code}</span>
              <span className="hw-city">{c.city}</span>
              <span className="hw-flag">
                {String.fromCodePoint(...[...c.country].map((ch) => 0x1F1A5 + ch.charCodeAt(0)))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function HotelsPage() {
  const router = useRouter();
  const [city,     setCity]     = useState<City | null>(null);
  const [checkIn,  setCheckIn]  = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [rooms,    setRooms]    = useState(1);
  const [adults,   setAdults]   = useState(1);
  const [currency, setCurrency] = useState<CurrencyCode>("INR");

  const today = new Date().toISOString().split("T")[0];

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!city) return;
    const params = new URLSearchParams({
      city:     city.code,
      cityName: city.city,
      checkIn,
      checkOut,
      rooms:    String(rooms),
      adults:   String(adults),
      currency,
    });
    router.push(`/hotels/search?${params}`);
  }

  return (
    <main className="hw-page">
      <style>{css}</style>

      <div className="hw-hero">
        <div className="hw-hero-inner">
          <span className="hw-badge">🏨 Hotels</span>
          <h1 className="hw-title">Find your perfect stay</h1>
          <p className="hw-subtitle">Best rates on hotels across India, Gulf & beyond</p>
        </div>
      </div>

      <div className="hw-container">
        <div className="hw-widget">
          <div className="hw-widget-tabs">
            {(["INR", "AED", "USD"] as CurrencyCode[]).map((code) => (
              <button
                key={code} type="button"
                className={currency === code ? "hw-cur hw-cur-active" : "hw-cur"}
                onClick={() => setCurrency(code)}
              >
                {CURRENCIES.find((c) => c.code === code)?.symbol} {code}
              </button>
            ))}
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <label className="hw-select-label">
                <span>Rooms</span>
                <select className="hw-select" value={rooms} onChange={(e) => setRooms(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <label className="hw-select-label">
                <span>Adults/room</span>
                <select className="hw-select" value={adults} onChange={(e) => setAdults(Number(e.target.value))}>
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          </div>

          <form onSubmit={handleSearch}>
            <div className="hw-grid">
              <CityInput label="Destination" value={city} onChange={setCity} />
              <div className="hw-dates">
                <div className="hw-field-wrap">
                  <label>Check-in</label>
                  <input className="hw-input" type="date" value={checkIn} min={today}
                    onChange={(e) => setCheckIn(e.target.value)} required />
                </div>
                <div className="hw-field-wrap">
                  <label>Check-out</label>
                  <input className="hw-input" type="date" value={checkOut}
                    min={checkIn || today} onChange={(e) => setCheckOut(e.target.value)} required />
                </div>
              </div>
              <button type="submit" className="hw-search-btn">
                Search hotels →
              </button>
            </div>
          </form>

          <div className="hw-perks">
            <span>✓ Live availability</span>
            <span>✓ Best rates</span>
            <span>✓ Free cancellation options</span>
          </div>
        </div>
      </div>
    </main>
  );
}

const css = `
.hw-page { min-height: 100vh; background: #f8fafc; }
.hw-hero {
  min-height: 240px; display: flex; align-items: center; justify-content: center;
  padding: 48px 16px 88px; text-align: center;
  background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 50%, #0f172a 100%);
}
.hw-hero-inner { max-width: 560px; }
.hw-badge {
  display: inline-block; background: rgba(255,255,255,.15); color: white;
  border: 1px solid rgba(255,255,255,.25); border-radius: 20px;
  padding: 6px 14px; font-size: 13px; font-weight: 600; margin-bottom: 14px;
}
.hw-title { margin: 0 0 10px; font-size: clamp(24px, 5vw, 40px); font-weight: 900; color: white; }
.hw-subtitle { margin: 0; font-size: clamp(13px, 2.5vw, 16px); color: rgba(255,255,255,.8); }
.hw-container { max-width: 900px; margin: -44px auto 40px; padding: 0 16px; position: relative; z-index: 10; }
.hw-widget {
  background: white; border-radius: 14px; padding: 20px 16px;
  box-shadow: 0 4px 24px rgba(0,0,0,.08);
}
.hw-widget-tabs {
  display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; align-items: center;
}
.hw-cur {
  padding: 6px 12px; border-radius: 20px; border: 1px solid #e5e7eb;
  background: white; color: #6b7280; font-size: 12px; font-weight: 600; cursor: pointer;
}
.hw-cur-active { background: #E31E24; border-color: #E31E24; color: white; }
.hw-select-label { display: flex; flex-direction: column; gap: 2px; font-size: 11px; color: #6b7280; font-weight: 600; }
.hw-select {
  border: 1.5px solid #e5e7eb; border-radius: 8px; padding: 4px 8px;
  font-size: 13px; background: white; cursor: pointer; outline: none;
}
.hw-grid { display: flex; flex-direction: column; gap: 10px; }
.hw-field-wrap { position: relative; display: flex; flex-direction: column; gap: 4px; }
.hw-field-wrap label { font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
.hw-input {
  padding: 12px 14px; border: 1.5px solid #e5e7eb; border-radius: 6px;
  font-size: 15px; width: 100%; outline: none; min-height: 52px; background: white;
  color: #1e293b; font-family: inherit;
}
.hw-input:focus { border-color: #E31E24; }
.hw-dates { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.hw-dropdown {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0;
  background: white; border: 1.5px solid #e5e7eb; border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.12); list-style: none; margin: 0; padding: 4px 0; z-index: 200;
  max-height: 260px; overflow-y: auto;
}
.hw-dropdown li {
  display: flex; align-items: center; gap: 8px; padding: 12px 14px; cursor: pointer;
}
.hw-dropdown li:hover { background: #f3f4f6; }
.hw-code { font-weight: 700; font-size: 15px; color: #E31E24; min-width: 38px; }
.hw-city { font-size: 14px; color: #1e293b; flex: 1; }
.hw-flag { font-size: 18px; }
.hw-search-btn {
  background: #E31E24; color: white; border: none; border-radius: 10px;
  padding: 14px 28px; font-weight: 700; font-size: 16px; cursor: pointer;
  width: 100%; min-height: 54px; font-family: inherit;
}
.hw-search-btn:active { opacity: .85; }
.hw-perks { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 14px; font-size: 12px; color: #6b7280; font-weight: 600; }
@media (min-width: 760px) {
  .hw-grid { flex-direction: row; align-items: end; }
  .hw-field-wrap:first-child { flex: 1.4; }
  .hw-dates { flex: 1.6; }
  .hw-search-btn { flex-shrink: 0; width: auto; align-self: end; }
  .hw-widget { padding: 28px 24px; }
}
`;
