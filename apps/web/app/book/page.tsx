"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type Passenger = {
  type: "ADULT" | "CHILD" | "INFANT";
  firstName: string;
  lastName: string;
  dob: string;
  gender: "M" | "F";
  nationality: string;
  passportNumber: string;
  passportExpiry: string;
};

type Offer = {
  id: string;
  airlineName: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  totalFare: number;
  currency: string;
  baggage?: { cabin?: string; checked?: string };
  raw?: { passengers?: { type?: string }[]; passenger_identity_documents_required?: boolean };
};

const emptyPassenger = (type: Passenger["type"] = "ADULT"): Passenger => ({
  type,
  firstName: "",
  lastName: "",
  dob: "",
  gender: "M",
  nationality: "IN",
  passportNumber: "",
  passportExpiry: "",
});

export default function BookPage() {
  const params = useSearchParams();
  const fareId = params.get("fareId") ?? "";
  const supplier = params.get("supplier") ?? "";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";

  const [offer, setOffer] = useState<Offer | null>(null);
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [passengers, setPassengers] = useState<Passenger[]>([emptyPassenger()]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<any>(null);

  useEffect(() => {
    if (!fareId || supplier !== "DUFFEL") {
      setError("Sandbox checkout is currently enabled for Duffel fares only.");
      setLoading(false);
      return;
    }

    fetch(`${apiUrl}/api/duffel-sandbox/offer/${encodeURIComponent(fareId)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "Unable to load fare");
        return data;
      })
      .then((data) => {
        const o = data.offer as Offer;
        setOffer(o);
        setExpiresAt(data.expiresAt ?? "");
        const rawPax = o.raw?.passengers ?? [];
        if (rawPax.length) {
          setPassengers(rawPax.map((p) => emptyPassenger(
            p.type === "child" ? "CHILD" : p.type === "infant_without_seat" ? "INFANT" : "ADULT",
          )));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [fareId, supplier, apiUrl]);

  const formatter = useMemo(() => {
    const currency = offer?.currency ?? "USD";
    try { return new Intl.NumberFormat("en", { style: "currency", currency }); }
    catch { return new Intl.NumberFormat("en"); }
  }, [offer?.currency]);

  const updatePassenger = (i: number, key: keyof Passenger, value: string) => {
    setPassengers((prev) => prev.map((p, idx) => idx === i ? { ...p, [key]: value } : p));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const identityRequired = Boolean(offer?.raw?.passenger_identity_documents_required);
      if (identityRequired && passengers.some((p) => !p.passportNumber || !p.passportExpiry)) {
        throw new Error("Passport details are required for this fare.");
      }

      const res = await fetch(`${apiUrl}/api/duffel-sandbox/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fareId,
          contactEmail: email,
          contactPhone: phone,
          passengers: passengers.map((p) => ({
            ...p,
            passportNumber: p.passportNumber || undefined,
            passportExpiry: p.passportExpiry || undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Booking failed");
      setConfirmation(data);
    } catch (e: any) {
      setError(e.message ?? "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="page-container" style={{ paddingTop: 40 }}>Loading latest Duffel fare…</main>;

  if (confirmation) {
    return (
      <main className="page-container" style={{ paddingTop: 40, maxWidth: 760 }}>
        <div style={{ border: "1px solid #bbf7d0", background: "#f0fdf4", borderRadius: 16, padding: 28 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#15803d", marginBottom: 8 }}>DUFFEL SANDBOX BOOKING</div>
          <h1 style={{ margin: "0 0 10px" }}>Booking confirmed</h1>
          <p style={{ margin: "0 0 18px", color: "#475569" }}>No real money or live airline ticket was issued.</p>
          <div style={{ display: "grid", gap: 10 }}>
            <div><b>PNR:</b> {confirmation.pnr}</div>
            <div><b>Duffel order:</b> {confirmation.bookingReference}</div>
            <div><b>Status:</b> {confirmation.status}</div>
            {confirmation.ticketNumbers?.length > 0 && <div><b>Ticket:</b> {confirmation.ticketNumbers.join(", ")}</div>}
          </div>
          <a href="/" style={{ display: "inline-block", marginTop: 24, padding: "12px 18px", background: "#111827", color: "white", borderRadius: 8, textDecoration: "none" }}>New Search</a>
        </div>
      </main>
    );
  }

  return (
    <main className="page-container" style={{ paddingTop: 28, paddingBottom: 60, maxWidth: 900 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: "#b45309", marginBottom: 6 }}>SANDBOX CHECKOUT · NO REAL CHARGE</div>
        <h1 style={{ margin: 0 }}>Passenger details</h1>
      </div>

      {offer && (
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 18, marginBottom: 24, background: "white" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <b>{offer.airlineName}</b> · {offer.flightNumber}<br />
              <span style={{ color: "#64748b" }}>{offer.origin} → {offer.destination}</span>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800 }}>{formatter.format(offer.totalFare)}</div>
          </div>
          {expiresAt && <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>Offer expires: {new Date(expiresAt).toLocaleString()}</div>}
        </div>
      )}

      {error && <div style={{ background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", padding: 12, borderRadius: 8, marginBottom: 18 }}>{error}</div>}

      <form onSubmit={submit}>
        {passengers.map((p, i) => (
          <section key={i} style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 18, marginBottom: 16, background: "white" }}>
            <h2 style={{ fontSize: 17, marginTop: 0 }}>Passenger {i + 1} · {p.type}</h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12 }}>
              <Input label="First name" value={p.firstName} onChange={(v) => updatePassenger(i, "firstName", v)} required />
              <Input label="Last name" value={p.lastName} onChange={(v) => updatePassenger(i, "lastName", v)} required />
              <Input label="Date of birth" type="date" value={p.dob} onChange={(v) => updatePassenger(i, "dob", v)} required />
              <label style={labelStyle}>Gender<select value={p.gender} onChange={(e) => updatePassenger(i, "gender", e.target.value)} style={inputStyle}><option value="M">Male</option><option value="F">Female</option></select></label>
              <Input label="Nationality (2-letter)" value={p.nationality} onChange={(v) => updatePassenger(i, "nationality", v.toUpperCase())} required />
              <Input label="Passport number" value={p.passportNumber} onChange={(v) => updatePassenger(i, "passportNumber", v)} />
              <Input label="Passport expiry" type="date" value={p.passportExpiry} onChange={(v) => updatePassenger(i, "passportExpiry", v)} />
            </div>
          </section>
        ))}

        <section style={{ border: "1px solid #e5e7eb", borderRadius: 14, padding: 18, marginBottom: 18, background: "white" }}>
          <h2 style={{ fontSize: 17, marginTop: 0 }}>Contact</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
            <Input label="Email" type="email" value={email} onChange={setEmail} required />
            <Input label="Phone (E.164, e.g. +971...)" value={phone} onChange={setPhone} required />
          </div>
        </section>

        <button disabled={submitting || !offer} type="submit" style={{ width: "100%", padding: 15, border: 0, borderRadius: 10, fontSize: 16, fontWeight: 800, background: "#ed1c24", color: "white", cursor: "pointer" }}>
          {submitting ? "Creating Duffel sandbox order…" : "Confirm Sandbox Booking"}
        </button>
      </form>
    </main>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, fontSize: 13, fontWeight: 600 };
const inputStyle = { width: "100%", boxSizing: "border-box" as const, padding: "10px 11px", border: "1px solid #d1d5db", borderRadius: 8, background: "white" };

function Input({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean }) {
  return <label style={labelStyle}>{label}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} style={inputStyle} /></label>;
}
