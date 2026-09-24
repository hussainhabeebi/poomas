"use client";
import { useEffect, useState } from "react";
import { apiCall, inr, readCustomerToken, STATUS_LABEL } from "../lib/customer-api";

interface TripRow {
  id: string; status: string; pnr: string | null; origin: string; destination: string;
  departureDate: string | null; totalAmount: number; currency: string;
  adultCount: number; childCount: number; infantCount: number; createdAt: string;
}

export default function TripsPage() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const ok = Boolean(readCustomerToken());
    setSignedIn(ok);
    if (ok) apiCall<{ trips: TripRow[] }>("/api/profile/trips").then((d) => setTrips(d.trips)).catch((e) => {
      if (e.status === 401 || e.status === 403) setSignedIn(false); else setError(e.message);
    });
  }, []);

  if (signedIn === null) return <main className="page-container" style={{ padding: "32px 16px" }}>Loading…</main>;

  if (!signedIn) {
    return (
      <main className="page-container" style={{ padding: "32px 16px", maxWidth: 560 }}>
        <section style={card}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>My Trips</h1>
          <p style={{ color: "#64748b", margin: "0 0 18px" }}>Sign in to see your bookings, download e-tickets and cancel online.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href="/login?next=/trips" style={primaryBtn}>Sign in</a>
            <a href="/signup?next=/trips" style={secondaryBtn}>Create account</a>
          </div>
          <p style={{ margin: "18px 0 0", fontSize: 14, color: "#64748b" }}>
            Booked as a guest? <a href="/trips/find" style={{ color: "#E31E24", fontWeight: 700 }}>Find your booking with PNR + email</a>
          </p>
        </section>
      </main>
    );
  }

  const now = Date.now();
  const isUpcoming = (t: TripRow) => t.departureDate && new Date(t.departureDate).getTime() >= now - 86_400_000 && ["TICKETED", "CONFIRMED"].includes(t.status);
  const upcoming = trips.filter(isUpcoming);
  const others = trips.filter((t) => !isUpcoming(t));

  return (
    <main className="page-container" style={{ padding: "24px 16px 48px", maxWidth: 820 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>My Trips</h1>
        <span style={{ display: "flex", gap: 8 }}>
          <a href="/account" style={smallLink}>Account</a>
          <a href="/wallet" style={smallLink}>Wallet</a>
        </span>
      </div>
      {error && <div style={errBox}>{error}</div>}
      {trips.length === 0 && !error && (
        <section style={card}>
          <p style={{ margin: "0 0 14px", color: "#64748b" }}>No bookings yet. Your trips will appear here after you book while signed in.</p>
          <a href="/" style={primaryBtn}>Search flights</a>
        </section>
      )}
      {upcoming.length > 0 && <Group title="Upcoming" trips={upcoming} />}
      {others.length > 0 && <Group title={upcoming.length ? "Past & other bookings" : "Bookings"} trips={others} />}
    </main>
  );
}

function Group({ title, trips }: { title: string; trips: TripRow[] }) {
  return (
    <section style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 14, color: "#64748b", fontWeight: 700, margin: "0 0 8px", textTransform: "uppercase", letterSpacing: .4 }}>{title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {trips.map((t) => {
          const st = STATUS_LABEL[t.status] ?? { label: t.status, color: "#334155", bg: "#f1f5f9" };
          const pax = t.adultCount + t.childCount + t.infantCount;
          return (
            <a key={t.id} href={`/trips/${t.id}`} style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, textDecoration: "none", color: "inherit" }}>
              <span style={{ minWidth: 0 }}>
                <strong style={{ fontSize: 18 }}>{t.origin} → {t.destination}</strong>
                <small style={{ display: "block", color: "#64748b", marginTop: 2 }}>
                  {t.departureDate ? new Date(t.departureDate).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "—"}
                  {` · ${pax} traveller${pax > 1 ? "s" : ""}`}{t.pnr ? ` · PNR ${t.pnr}` : ""}
                </small>
              </span>
              <span style={{ textAlign: "right", flexShrink: 0 }}>
                <span style={{ display: "inline-block", fontSize: 11, fontWeight: 800, color: st.color, background: st.bg, borderRadius: 20, padding: "3px 9px" }}>{st.label}</span>
                <small style={{ display: "block", color: "#0f172a", fontWeight: 700, marginTop: 4 }}>{inr(t.totalAmount, t.currency)}</small>
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 16 };
const primaryBtn: React.CSSProperties = { display: "inline-block", background: "#E31E24", color: "#fff", borderRadius: 10, padding: "11px 16px", fontWeight: 800, fontSize: 14, textDecoration: "none" };
const secondaryBtn: React.CSSProperties = { ...primaryBtn, background: "#fff", color: "#0f172a", border: "1.5px solid #e2e8f0" };
const smallLink: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: "#0f172a", background: "#f1f5f9", borderRadius: 8, padding: "7px 10px", textDecoration: "none" };
const errBox: React.CSSProperties = { background: "#FEE2E2", color: "#991B1B", padding: "10px 14px", borderRadius: 10, fontSize: 14, marginBottom: 12 };
