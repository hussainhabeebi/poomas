"use client";

// Full details of the chosen flight on the checkout page: date, times, airports
// and terminals, every leg with its layovers, and what the fare includes
// (baggage, meal, refundability, cabin class).

type Seg = {
  key: string; airline: string; airlineName?: string; flightNumber: string;
  origin: string; destination: string; departureTime: string; arrivalTime?: string; duration?: number; isReturn?: boolean;
  originCity?: string; destinationCity?: string; originAirport?: string; destinationAirport?: string;
  departureTerminal?: string; arrivalTerminal?: string; aircraft?: string;
  cabinClass?: string; bookingClass?: string; checkedBaggage?: string; cabinBaggage?: string;
  mealIncluded?: boolean; refundable?: boolean;
};

type Fare = {
  airlineName: string; flightNumber: string; origin: string; destination: string;
  departureTime: string; arrivalTime: string; duration: number; stops: number;
  isRefundable: boolean; cabinChecked: string; cabinBag: string; cabinClass: string; fareLabel: string; meal: "" | "1" | "0";
};

const CITY: Record<string, string> = {
  BOM: "Mumbai", DEL: "Delhi", CCJ: "Kozhikode", COK: "Kochi", TRV: "Thiruvananthapuram", CNN: "Kannur", IXE: "Mangalore",
  MAA: "Chennai", BLR: "Bengaluru", HYD: "Hyderabad", AMD: "Ahmedabad", PNQ: "Pune", GOI: "Goa", CCU: "Kolkata", LKO: "Lucknow",
  DXB: "Dubai", DWC: "Dubai Al Maktoum", AUH: "Abu Dhabi", SHJ: "Sharjah", RKT: "Ras Al Khaimah", FJR: "Fujairah", AAN: "Al Ain",
  DOH: "Doha", MCT: "Muscat", SLL: "Salalah", BAH: "Bahrain", KWI: "Kuwait", RUH: "Riyadh", JED: "Jeddah", DMM: "Dammam", MED: "Madinah",
  LHR: "London", CDG: "Paris", FRA: "Frankfurt", SIN: "Singapore", KUL: "Kuala Lumpur", BKK: "Bangkok", HKG: "Hong Kong",
  CMB: "Colombo", KTM: "Kathmandu", DAC: "Dhaka", MLE: "Malé",
};

// Airline times are the airport's local clock: read them from the string, not
// through the browser's time zone.
const clock = (s?: string) => {
  const m = s?.match(/T(\d{2}:\d{2})/);
  if (m) return m[1];
  return s ? new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";
};
const dayOf = (s?: string) => s?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
const longDate = (s?: string) => {
  const d = dayOf(s);
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};
const shortDate = (s?: string) => {
  const d = dayOf(s);
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};
// Minutes between two local times at the same airport (layover).
const gap = (from?: string, to?: string) => {
  const a = Date.parse(`${(from ?? "").slice(0, 16)}Z`), b = Date.parse(`${(to ?? "").slice(0, 16)}Z`);
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? Math.round((b - a) / 60000) : 0;
};
const hm = (min: number) => (min > 0 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : "");
const title = (s: string) => s.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const cityOf = (code: string, city?: string) => city || CITY[code.toUpperCase()] || "";

// knownStops: from the search result when only a summary leg is known (no
// per-leg data) — the leg list is then hidden rather than shown as nonstop.
function Journey({ label, segs, knownStops }: { label: string; segs: Seg[]; knownStops?: number }) {
  const first = segs[0], last = segs[segs.length - 1];
  const layovers = segs.slice(1).map((s, i) => gap(segs[i].arrivalTime, s.departureTime));
  const total = segs.reduce((n, s) => n + (s.duration ?? 0), 0) + layovers.reduce((n, m) => n + m, 0);
  const stops = knownStops ?? segs.length - 1;
  const summaryOnly = knownStops !== undefined && knownStops > 0;
  const nextDay = dayOf(last.arrivalTime) && dayOf(first.departureTime) && dayOf(last.arrivalTime) !== dayOf(first.departureTime);
  return (
    <div className="fdJourney">
      <div className="fdJHead">
        <b>{label}</b>
        <span>{longDate(first.departureTime)}</span>
      </div>
      <div className="fdRoute">
        <div>
          <strong>{clock(first.departureTime)}</strong>
          <b>{first.origin}</b>
          <span>{cityOf(first.origin, first.originCity)}</span>
        </div>
        <div className="fdMid">
          <span>{hm(total)}</span>
          <i aria-hidden="true">✈</i>
          <span>{stops === 0 ? "Nonstop" : `${stops} stop${stops > 1 ? "s" : ""}${summaryOnly ? "" : ` · ${segs.slice(0, -1).map((s) => s.destination).join(", ")}`}`}</span>
        </div>
        <div className="end">
          <strong>{clock(last.arrivalTime)}{nextDay && <sup>+1</sup>}</strong>
          <b>{last.destination}</b>
          <span>{cityOf(last.destination, last.destinationCity)}</span>
        </div>
      </div>

      {!summaryOnly && <ol className="fdLegs">
        {segs.map((s, i) => (
          <li key={s.key || i}>
            {i > 0 && layovers[i - 1] > 0 && (
              <div className="fdLay">⏱ {hm(layovers[i - 1])} layover in {cityOf(s.origin, s.originCity) || s.origin} ({s.origin})
                {segs[i - 1].arrivalTerminal && s.departureTerminal && segs[i - 1].arrivalTerminal !== s.departureTerminal ? " · terminal change" : ""}</div>
            )}
            <div className="fdLeg">
              <div className="fdLegHead">
                <b>{s.airlineName || s.airline} · {s.airline && !s.flightNumber.startsWith(s.airline) ? `${s.airline} ` : ""}{s.flightNumber}</b>
                <span>{[s.aircraft && `Aircraft ${s.aircraft}`, s.cabinClass && title(s.cabinClass), s.bookingClass && `Class ${s.bookingClass}`].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="fdStop">
                <em>{clock(s.departureTime)}</em>
                <div><b>{s.origin} · {cityOf(s.origin, s.originCity)}</b>
                  <span>{[shortDate(s.departureTime), s.originAirport, s.departureTerminal && `Terminal ${s.departureTerminal}`].filter(Boolean).join(" · ")}</span></div>
              </div>
              {(s.duration ?? 0) > 0 && <div className="fdDur">{hm(s.duration ?? 0)} flight</div>}
              <div className="fdStop">
                <em>{clock(s.arrivalTime)}</em>
                <div><b>{s.destination} · {cityOf(s.destination, s.destinationCity)}</b>
                  <span>{[shortDate(s.arrivalTime), s.destinationAirport, s.arrivalTerminal && `Terminal ${s.arrivalTerminal}`].filter(Boolean).join(" · ")}</span></div>
              </div>
            </div>
          </li>
        ))}
      </ol>}
    </div>
  );
}

export function FlightDetails({ fare, segments, travellers }: { fare: Fare; segments: Seg[]; travellers: { adults: number; children: number; infants: number } }) {
  // Without the airline's review (still loading, or another supplier) build one
  // leg from the search result.
  const fallback: Seg = {
    key: "fare", airline: "", airlineName: fare.airlineName, flightNumber: fare.flightNumber,
    origin: fare.origin, destination: fare.destination, departureTime: fare.departureTime, arrivalTime: fare.arrivalTime, duration: fare.duration,
  };
  const onward = segments.filter((s) => !s.isReturn);
  const ret = segments.filter((s) => s.isReturn);
  const journeys: [string, Seg[], number?][] = segments.length
    ? [[ret.length ? "Onward" : "Flight", onward.length ? onward : segments], ...(ret.length && onward.length ? [["Return", ret] as [string, Seg[]]] : [])]
    : fare.departureTime || fare.origin ? [["Flight", [fallback], fare.stops]] : [];

  // What the fare includes: the airline's review wins over the search result.
  const a = onward[0] ?? segments[0];
  const r = ret[0];
  const both = (x?: string, y?: string) => (x && y && x !== y ? `${x} (return ${y})` : x || y || "");
  const checked = both(a?.checkedBaggage, r?.checkedBaggage) || fare.cabinChecked;
  const cabin = both(a?.cabinBaggage, r?.cabinBaggage) || fare.cabinBag;
  const meal = a?.mealIncluded ?? (fare.meal === "1" ? true : fare.meal === "0" ? false : undefined);
  const refundable = a?.refundable ?? fare.isRefundable;
  const cls = a?.cabinClass || fare.cabinClass;
  const pax = [
    travellers.adults && `${travellers.adults} adult${travellers.adults > 1 ? "s" : ""}`,
    travellers.children && `${travellers.children} child${travellers.children > 1 ? "ren" : ""}`,
    travellers.infants && `${travellers.infants} infant${travellers.infants > 1 ? "s" : ""}`,
  ].filter(Boolean).join(", ");

  return (
    <div className="fd">
      {(fare.fareLabel || cls) && (
        <div className="fdTags">
          {fare.fareLabel && <span>{fare.fareLabel} fare</span>}
          {cls && <span>{title(cls)}</span>}
        </div>
      )}
      {journeys.map(([label, segs, knownStops]) => <Journey key={label} label={label} segs={segs} knownStops={knownStops} />)}

      <div className="fdInc">
        <b>Included in this fare</b>
        <dl>
          <div><dt>🧳 Check-in baggage</dt><dd className={checked ? "" : "fdMuted"}>{checked ? `${checked} per adult` : "Checked baggage allowance not provided"}</dd></div>
          <div><dt>👜 Cabin baggage</dt><dd className={cabin ? "" : "fdMuted"}>{cabin ? `${cabin} per adult` : "As per airline policy"}</dd></div>
          {meal !== undefined && <div><dt>🍽 Meal</dt><dd className={meal ? "" : "fdMuted"}>{meal ? "Free meal included" : "Available to buy"}</dd></div>}
          <div><dt>↩ Cancellation</dt><dd className={refundable ? "fdOk" : "fdMuted"}>{refundable ? "Refundable" : "Non-refundable"}</dd></div>
          {cls && <div><dt>💺 Cabin</dt><dd>{title(cls)}{a?.bookingClass ? ` · class ${a.bookingClass}` : ""}</dd></div>}
          {pax && <div><dt>👥 Travellers</dt><dd>{pax}</dd></div>}
        </dl>
      </div>
    </div>
  );
}

export const flightDetailsCss = `.fd{margin-top:8px}.fdTags{display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 4px}.fdTags span{font-size:11px;font-weight:800;color:#be123c;background:#fff1f2;border-radius:99px;padding:4px 10px}.fdJourney{border-top:1px dashed #eaecf0;margin-top:12px;padding-top:12px}.fdJHead{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}.fdJHead b{font-size:14px}.fdJHead span{font-size:13px;font-weight:700;color:#344054}.fdRoute{display:grid;grid-template-columns:1fr 1.3fr 1fr;align-items:center;gap:8px;margin:14px 0 6px}.fdRoute>div{display:flex;flex-direction:column;min-width:0}.fdRoute strong{font-size:22px;line-height:1.1}.fdRoute strong sup{font-size:11px;color:#ed1c24;margin-left:2px}.fdRoute b{font-size:13px}.fdRoute span{font-size:12px;color:#667085;overflow:hidden;text-overflow:ellipsis}.fdRoute .end{text-align:right;align-items:flex-end}.fdMid{align-items:center;text-align:center}.fdMid i{font-style:normal;color:#ed1c24;width:100%;border-bottom:1px solid #d0d5dd;line-height:10px;margin:2px 0 6px}.fdMid span{font-size:11px!important}.fdLegs{list-style:none;padding:0;margin:10px 0 0}.fdLeg{background:#f9fafb;border:1px solid #eaecf0;border-radius:12px;padding:10px 12px}.fdLegHead{display:flex;flex-direction:column;gap:2px;margin-bottom:8px}.fdLegHead b{font-size:13px}.fdLegHead span{font-size:11px;color:#667085}.fdStop{display:flex;gap:10px;align-items:flex-start}.fdStop em{font-style:normal;font-weight:800;font-size:14px;min-width:44px}.fdStop>div{display:flex;flex-direction:column;min-width:0}.fdStop b{font-size:13px}.fdStop span{font-size:12px;color:#667085}.fdDur{font-size:11px;color:#98a2b3;margin:4px 0 4px 54px;padding-left:8px;border-left:2px dotted #d0d5dd}.fdLay{font-size:12px;font-weight:700;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:7px 10px;margin:8px 0}.fdInc{border-top:1px dashed #eaecf0;margin-top:14px;padding-top:12px}.fdInc>b{font-size:14px}.fdInc dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:10px 0 0}.fdInc dl div{min-width:0}.fdInc dt{font-size:11px;color:#667085;font-weight:700}.fdInc dd{margin:2px 0 0;font-size:13px;font-weight:700;color:#101828}.fdInc dd.fdMuted{color:#98a2b3}.fdInc dd.fdOk{color:#067647}@media(max-width:420px){.fdInc dl{grid-template-columns:minmax(0,1fr)}.fdRoute strong{font-size:19px}}`;
