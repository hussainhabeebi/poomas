"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";

type Props = {
  origin: string;
  destination: string;
  departureDate: string;
};

const AIRPORT_GROUPS = [
  [
    { code: "COK", city: "Kochi" },
    { code: "CCJ", city: "Kozhikode" },
    { code: "CNN", city: "Kannur" },
    { code: "TRV", city: "Thiruvananthapuram" },
  ],
  [
    { code: "DXB", city: "Dubai International" },
    { code: "DWC", city: "Dubai Al Maktoum" },
    { code: "SHJ", city: "Sharjah" },
    { code: "AUH", city: "Abu Dhabi" },
  ],
];

function airportOptions(code: string) {
  return AIRPORT_GROUPS.find((group) => group.some((airport) => airport.code === code))
    ?? [{ code, city: code }];
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function SearchResultControls({ origin, destination, departureDate }: Props) {
  const router = useRouter();
  const current = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const selectedDate = useMemo(() => {
    const parsed = new Date(`${departureDate}T12:00:00Z`);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [departureDate]);

  function update(updates: Record<string, string | null>) {
    const next = new URLSearchParams(current.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    });
    next.delete("all");
    startTransition(() => router.push(`/search?${next.toString()}`));
  }

  const dates = [-2, -1, 0, 1, 2].map((offset) => {
    const date = new Date(selectedDate);
    date.setUTCDate(date.getUTCDate() + offset);
    return date;
  });
  const sort = current.get("sort") ?? "best";
  const stops = current.get("stops");
  const refundable = current.get("refundable") === "1";
  const baggage = current.get("baggage") === "1";

  return (
    <section className={`result-tools ${isPending ? "is-loading" : ""}`} aria-label="Modify flight search">
      <div className="date-switcher" aria-label="Choose another departure date">
        {dates.map((date) => {
          const value = isoDate(date);
          const active = value === departureDate;
          return (
            <button key={value} type="button" className={active ? "active" : ""} onClick={() => !active && update({ departureDate: value })}>
              <span>{date.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" })}</span>
              <strong>{date.toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" })}</strong>
              {active && <i>Selected</i>}
            </button>
          );
        })}
      </div>

      <div className="result-tool-row">
        <label className="airport-select">
          <span>From nearby</span>
          <select value={origin} onChange={(event) => update({ origin: event.target.value })}>
            {airportOptions(origin).map((airport) => <option key={airport.code} value={airport.code}>{airport.city} ({airport.code})</option>)}
          </select>
        </label>
        <button className="result-swap" type="button" aria-label="Swap airports" onClick={() => update({ origin: destination, destination: origin })}>⇄</button>
        <label className="airport-select">
          <span>To nearby</span>
          <select value={destination} onChange={(event) => update({ destination: event.target.value })}>
            {airportOptions(destination).map((airport) => <option key={airport.code} value={airport.code}>{airport.city} ({airport.code})</option>)}
          </select>
        </label>
      </div>

      <div className="filter-scroll" aria-label="Flight filters">
        <select aria-label="Sort flights" value={sort} onChange={(event) => update({ sort: event.target.value === "best" ? null : event.target.value })}>
          <option value="best">Recommended</option>
          <option value="price">Lowest price</option>
          <option value="duration">Shortest duration</option>
          <option value="departure">Earliest departure</option>
        </select>
        <button type="button" className={stops === "0" ? "active" : ""} onClick={() => update({ stops: stops === "0" ? null : "0" })}>Nonstop</button>
        <button type="button" className={refundable ? "active" : ""} onClick={() => update({ refundable: refundable ? null : "1" })}>Refundable</button>
        <button type="button" className={baggage ? "active" : ""} onClick={() => update({ baggage: baggage ? null : "1" })}>Checked baggage</button>
      </div>

      {isPending && <div className="result-refresh"><span /> Updating live fares…</div>}
    </section>
  );
}
