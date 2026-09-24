"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiCall, downloadFile, inr, openETicket, readGuestToken } from "../../lib/customer-api";

// Itinerary confirmation: the payment-result page sends the traveller here with a
// read-only trip token. We wait for the airline booking, then download the
// itinerary (live TripJack booking details) automatically.

interface Segment { airline: string; airlineName: string; flightNumber: string; from: { code: string; city?: string; terminal?: string }; to: { code: string; city?: string; terminal?: string }; departure: string; arrival: string; durationMin?: number; cabinBaggage?: string; checkedBaggage?: string }
interface Trip {
  id: string; status: string; pnr: string | null; origin: string; destination: string; departureDate: string | null;
  currency: string; totalAmount: number; contactEmail: string | null;
  passengers: { id: string; type: string; firstName: string; lastName: string }[];
  itinerary: { pnr?: string; segments: Segment[]; travellers: { name: string; type?: string; pnr?: string; ticketNumber?: string }[] } | null;
}

const POLL_MS = 4000;
const MAX_WAIT_MS = 10 * 60 * 1000;
const CONFIRMED = ["CONFIRMED", "TICKETED"];
const FINISHED = [...CONFIRMED, "PAYMENT_FAILED", "CANCELLED", "REFUND_PENDING", "REFUNDED"];

// TripJack times are airport-local without an offset: show them as written.
function split(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return { date: s, time: "" };
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return { date, time: `${m[4]}:${m[5]}` };
}

export default function ItineraryConfirmationPage() {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState("");
  const [timedOut, setTimedOut] = useState(false);
  const [download, setDownload] = useState<"idle" | "busy" | "done" | "failed">("idle");
  const [downloadError, setDownloadError] = useState("");
  const startedAt = useRef(Date.now());
  const autoTried = useRef(false);

  const [hasToken, setHasToken] = useState(true);

  const confirmed = CONFIRMED.includes(trip?.status ?? "");
  const pnr = trip?.pnr ?? trip?.itinerary?.pnr ?? null;
  const fileName = `itinerary-${(pnr ?? trip?.id.slice(0, 8) ?? "booking").replace(/[^A-Za-z0-9-]/g, "")}.html`;

  const saveItinerary = useCallback(async () => {
    setDownload("busy"); setDownloadError("");
    try {
      await downloadFile("/api/trips/itinerary", "guest", fileName);
      setDownload("done");
      try { if (trip) sessionStorage.setItem(`itinerary_downloaded:${trip.id}`, "1"); } catch {}
    } catch (e: any) {
      setDownload("failed"); setDownloadError(e.message);
    }
  }, [fileName, trip]);

  // Follow the booking until the airline confirms it (or it fails).
  useEffect(() => {
    if (!readGuestToken()) { setHasToken(false); return; }
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;
    async function poll() {
      try {
        const d = await apiCall<{ trip: Trip }>("/api/trips/view", { auth: "guest" });
        if (stopped) return;
        setTrip(d.trip);
        const done = FINISHED.includes(d.trip.status);
        // Once confirmed, keep polling briefly until TripJack returns the flight details.
        const waitingForDetails = CONFIRMED.includes(d.trip.status) && !d.trip.itinerary?.segments.length;
        if (done && !waitingForDetails) return;
      } catch (e: any) {
        if (stopped) return;
        if (e.status === 401 || e.status === 404) { setError(e.message); return; }
      }
      if (Date.now() - startedAt.current > MAX_WAIT_MS) { setTimedOut(true); return; }
      timer = setTimeout(poll, POLL_MS);
    }
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  // Download the itinerary automatically once, as soon as the flight details are in.
  useEffect(() => {
    if (!trip || !confirmed || !trip.itinerary?.segments.length || autoTried.current) return;
    autoTried.current = true;
    try { if (sessionStorage.getItem(`itinerary_downloaded:${trip.id}`)) { setDownload("done"); return; } } catch {}
    saveItinerary();
  }, [trip, confirmed, saveItinerary]);

  if (!hasToken || error) {
    return (
      <main className="page-container" style={{ padding: "32px 16px", maxWidth: 560 }}>
        <section style={card}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22, fontWeight: 800 }}>Find your itinerary</h1>
          <p style={muted}>{error || "This confirmation link has expired."} Look up your booking with your PNR or booking reference and email to download the itinerary.</p>
          <a href="/trips/find" style={primaryBtn}>Find my booking</a>
        </section>
      </main>
    );
  }

  if (!trip) {
    return <main className="page-container" style={{ padding: "32px 16px" }}>Loading your booking…</main>;
  }

  const failed = ["PAYMENT_FAILED", "CANCELLED", "REFUND_PENDING", "REFUNDED"].includes(trip.status);
  const segs = trip.itinerary?.segments ?? [];
  const travellers = trip.itinerary?.travellers?.length ? trip.itinerary.travellers
    : trip.passengers.map((p) => ({ name: `${p.firstName} ${p.lastName}`, type: p.type, ticketNumber: undefined as string | undefined }));

  return (
    <main className="page-container" style={{ padding: "20px 16px 56px", maxWidth: 720 }}>
      <section style={{ ...card, textAlign: "center" }}>
        <div style={{ width: 60, height: 60, display: "grid", placeItems: "center", margin: "0 auto 14px", borderRadius: "50%", fontSize: 26, background: confirmed ? "#dcfce7" : failed ? "#fee2e2" : "#fef3c7" }}>
          {confirmed ? "✓" : failed ? "×" : "…"}
        </div>
        <h1 style={{ margin: "0 0 6px", fontSize: 24, fontWeight: 800 }}>
          {confirmed ? "Your booking is confirmed" : failed ? "Booking could not be completed" : "Confirming your seat with the airline"}
        </h1>
        <p style={{ ...muted, margin: 0 }}>
          {confirmed
            ? `${trip.origin} → ${trip.destination} · ${travellers.length} traveller${travellers.length > 1 ? "s" : ""}. ${download === "done" ? "Your itinerary has been downloaded." : download === "busy" ? "Downloading your itinerary…" : ""}${trip.contactEmail ? ` The e-ticket is also on its way to ${trip.contactEmail}.` : ""}`
            : failed
              ? "The airline couldn't confirm this booking. Your payment is being refunded to your original payment method."
              : timedOut
                ? "This is taking longer than usual. You don't need to pay again — we'll email your itinerary as soon as the airline confirms. You can also check My Trips later."
                : "Payment received. Keep this page open — your itinerary downloads automatically once the airline issues the ticket (usually under a minute)."}
        </p>
        {confirmed && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 10, marginTop: 16, textAlign: "left" }}>
            <Info label="Airline PNR" value={pnr ?? "Pending"} mono />
            <Info label="Booking ID" value={trip.id.slice(0, 8).toUpperCase()} mono />
            <Info label="Total paid" value={inr(trip.totalAmount, trip.currency)} />
          </div>
        )}
      </section>

      {confirmed && (
        <section style={{ ...card, marginTop: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button disabled={download === "busy" || !segs.length} onClick={saveItinerary} style={{ ...primaryBtn, opacity: download === "busy" || !segs.length ? .6 : 1 }}>
              {download === "busy" ? "Downloading…" : download === "done" ? "Download itinerary again" : "Download itinerary"}
            </button>
            <button onClick={() => openETicket("/api/trips/eticket", "guest").catch((e) => setDownloadError(e.message))} style={secondaryBtn}>View / print e-ticket</button>
            <a href="/trips/guest" style={secondaryBtn}>Manage booking</a>
          </div>
          {downloadError && <div style={errBox}>{downloadError}</div>}
        </section>
      )}

      {(confirmed || segs.length > 0) && (
        <section style={{ ...card, marginTop: 12 }}>
          <h2 style={h2}>Flight itinerary</h2>
          {segs.length === 0 ? (
            <p style={muted}>Fetching flight details from the airline…</p>
          ) : segs.map((s, i) => {
            const dep = split(s.departure), arr = split(s.arrival);
            return (
              <div key={i} style={{ padding: "12px 0", borderTop: i ? "1px dashed #e2e8f0" : "none" }}>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}><strong style={{ color: "#0f172a" }}>{s.airlineName || s.airline}</strong> · {s.flightNumber}{s.durationMin ? ` · ${Math.floor(s.durationMin / 60)}h ${s.durationMin % 60}m` : ""}</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{dep.time}</div>
                    <div style={{ fontWeight: 700 }}>{s.from.code}{s.from.city ? ` · ${s.from.city}` : ""}</div>
                    <small style={{ color: "#64748b" }}>{dep.date}{s.from.terminal ? ` · ${s.from.terminal}` : ""}</small>
                  </div>
                  <span style={{ color: "#E31E24" }}>✈</span>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 22, fontWeight: 800 }}>{arr.time}</div>
                    <div style={{ fontWeight: 700 }}>{s.to.code}{s.to.city ? ` · ${s.to.city}` : ""}</div>
                    <small style={{ color: "#64748b" }}>{arr.date}{s.to.terminal ? ` · ${s.to.terminal}` : ""}</small>
                  </div>
                </div>
                {(s.cabinBaggage || s.checkedBaggage) && <small style={{ display: "block", color: "#64748b", marginTop: 6 }}>Baggage: {[s.cabinBaggage && `cabin ${s.cabinBaggage}`, s.checkedBaggage && `check-in ${s.checkedBaggage}`].filter(Boolean).join(" · ")}</small>}
              </div>
            );
          })}
        </section>
      )}

      {confirmed && (
        <section style={{ ...card, marginTop: 12 }}>
          <h2 style={h2}>Travellers</h2>
          {travellers.map((t, i) => (
            <div key={i} style={row}>
              <span>{t.name}{t.type ? <small style={{ color: "#64748b" }}> · {t.type.toLowerCase()}</small> : null}</span>
              <small style={{ color: "#475569", fontFamily: "monospace" }}>{t.ticketNumber ? `Ticket ${t.ticketNumber}` : ""}</small>
            </div>
          ))}
        </section>
      )}

      <div style={{ textAlign: "center", marginTop: 16 }}>
        <a href="/" style={{ color: "#64748b", fontSize: 14 }}>Back to home</a>
      </div>
    </main>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: 10, padding: "8px 10px" }}>
      <small style={{ color: "#64748b", display: "block" }}>{label}</small>
      <strong style={{ fontFamily: mono ? "monospace" : "inherit", fontSize: 15 }}>{value}</strong>
    </div>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 };
const h2: React.CSSProperties = { margin: "0 0 10px", fontSize: 16, fontWeight: 800 };
const muted: React.CSSProperties = { margin: "0 0 12px", color: "#64748b", fontSize: 14, lineHeight: 1.55 };
const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: "1px solid #f1f5f9", fontSize: 14 };
const primaryBtn: React.CSSProperties = { display: "inline-block", background: "#E31E24", color: "#fff", borderRadius: 10, padding: "10px 14px", fontWeight: 800, fontSize: 14, textDecoration: "none", border: 0, cursor: "pointer", fontFamily: "inherit" };
const secondaryBtn: React.CSSProperties = { ...primaryBtn, background: "#fff", color: "#0f172a", border: "1.5px solid #e2e8f0" };
const errBox: React.CSSProperties = { background: "#FEE2E2", color: "#991B1B", padding: "10px 14px", borderRadius: 10, fontSize: 14, marginTop: 12 };
