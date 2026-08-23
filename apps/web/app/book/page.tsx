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
  type, firstName: "", lastName: "", dob: "", gender: "M", nationality: "IN", passportNumber: "", passportExpiry: "",
});

export default function BookPage() {
  const params = useSearchParams();
  const fareId = params.get("fareId") ?? "";
  const supplier = params.get("supplier") ?? "";
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";

  const [offer, setOffer] = useState<Offer | null>(null);
  const [expiresAt, setExpiresAt] = useState("");
  const [passengers, setPassengers] = useState<Passenger[]>([emptyPassenger()]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<any>(null);

  useEffect(() => {
    if (!fareId || supplier !== "DUFFEL") {
      setError("This sandbox checkout currently supports Duffel fares only.");
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    fetch(`${apiUrl}/api/duffel-sandbox/offer/${encodeURIComponent(fareId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error ?? `Unable to load fare (${r.status})`);
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
      .catch((e) => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [fareId, supplier, apiUrl]);

  const formatter = useMemo(() => {
    const currency = offer?.currency ?? "USD";
    try { return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }); }
    catch { return new Intl.NumberFormat("en"); }
  }, [offer?.currency]);

  const updatePassenger = (i: number, key: keyof Passenger, value: string) => {
    setPassengers((prev) => prev.map((p, idx) => idx === i ? { ...p, [key]: value } : p));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setSubmitting(true);
    try {
      const identityRequired = Boolean(offer?.raw?.passenger_identity_documents_required);
      if (identityRequired && passengers.some((p) => !p.passportNumber || !p.passportExpiry)) {
        throw new Error("Passport number and expiry are required for this fare.");
      }
      if (!email || !phone) throw new Error("Email and phone are required.");

      const res = await fetch(`${apiUrl}/api/duffel-sandbox/book`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fareId,
          contactEmail: email.trim(),
          contactPhone: phone.trim(),
          passengers: passengers.map((p) => ({
            ...p,
            firstName: p.firstName.trim(), lastName: p.lastName.trim(), nationality: p.nationality.trim().toUpperCase(),
            passportNumber: p.passportNumber.trim() || undefined,
            passportExpiry: p.passportExpiry || undefined,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `Booking failed (${res.status})`);
      setConfirmation(data);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setError(e.message ?? "Booking failed");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  }

  const dep = offer ? new Date(offer.departureTime) : null;
  const arr = offer ? new Date(offer.arrivalTime) : null;
  const time = (d: Date | null) => d ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--:--";

  if (loading) {
    return <main className="checkout-shell"><div className="checkout-loading"><div className="spinner" /><b>Loading latest fare</b><span>Checking price and availability with Duffel…</span></div><Styles /></main>;
  }

  if (confirmation) {
    return (
      <main className="checkout-shell confirmation-shell">
        <div className="success-icon">✓</div>
        <div className="success-kicker">SANDBOX BOOKING</div>
        <h1 className="success-title">Booking confirmed</h1>
        <p className="success-copy">Test booking created successfully. No real charge or airline ticket was issued.</p>
        <div className="receipt-card">
          <ReceiptRow label="PNR" value={confirmation.pnr ?? "—"} strong />
          <ReceiptRow label="Duffel order" value={confirmation.bookingReference ?? "—"} />
          <ReceiptRow label="Status" value={confirmation.status ?? "CONFIRMED"} />
          {confirmation.ticketNumbers?.length > 0 && <ReceiptRow label="Document" value={confirmation.ticketNumbers.join(", ")} />}
        </div>
        <a href="/" className="primary-link">Book another flight</a>
        <Styles />
      </main>
    );
  }

  return (
    <main className="checkout-shell">
      <header className="checkout-topbar">
        <button type="button" className="back-btn" aria-label="Go back" onClick={() => window.history.back()}>‹</button>
        <div><div className="topbar-title">Secure checkout</div><div className="topbar-sub">Duffel sandbox</div></div>
        <div className="lock-badge">🔒</div>
      </header>

      <div className="progress-wrap"><div className="progress-dot active">1</div><div className="progress-line"/><div className="progress-dot active">2</div><div className="progress-line muted"/><div className="progress-dot">3</div></div>
      <div className="progress-labels"><span>Flight</span><span>Travellers</span><span>Confirm</span></div>

      {error && <div className="error-card"><b>Couldn’t continue</b><span>{error}</span></div>}

      {offer && (
        <section className="flight-summary-card">
          <div className="summary-head"><div><div className="summary-airline">{offer.airlineName}</div><div className="summary-flight">{offer.flightNumber}</div></div><div className="summary-price">{formatter.format(offer.totalFare)}</div></div>
          <div className="route-row"><div><b>{time(dep)}</b><span>{offer.origin}</span></div><div className="route-line"><span>✈</span></div><div className="route-end"><b>{time(arr)}</b><span>{offer.destination}</span></div></div>
          <div className="summary-meta"><span>{offer.baggage?.checked || "Baggage per fare"}</span><span>{offer.currency}</span></div>
          {expiresAt && <div className="expiry-note">Fare held until {new Date(expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>}
        </section>
      )}

      <form onSubmit={submit} className="checkout-form">
        <section className="section-card">
          <div className="section-title-row"><div className="section-icon">👤</div><div><h2>Traveller details</h2><p>Enter details exactly as on the travel document.</p></div></div>
          {passengers.map((p, i) => (
            <div key={i} className="passenger-block">
              <div className="passenger-chip">Passenger {i + 1} · {p.type}</div>
              <div className="field-grid">
                <Input label="First name" value={p.firstName} onChange={(v) => updatePassenger(i, "firstName", v)} required autoComplete="given-name" />
                <Input label="Last name" value={p.lastName} onChange={(v) => updatePassenger(i, "lastName", v)} required autoComplete="family-name" />
                <Input label="Date of birth" type="date" value={p.dob} onChange={(v) => updatePassenger(i, "dob", v)} required />
                <label className="field-label">Gender<select value={p.gender} onChange={(e) => updatePassenger(i, "gender", e.target.value)} className="field-input"><option value="M">Male</option><option value="F">Female</option></select></label>
                <Input label="Nationality" value={p.nationality} onChange={(v) => updatePassenger(i, "nationality", v.toUpperCase().slice(0, 2))} required maxLength={2} />
                <Input label="Passport number" value={p.passportNumber} onChange={(v) => updatePassenger(i, "passportNumber", v)} autoComplete="off" />
                <Input label="Passport expiry" type="date" value={p.passportExpiry} onChange={(v) => updatePassenger(i, "passportExpiry", v)} />
              </div>
            </div>
          ))}
        </section>

        <section className="section-card">
          <div className="section-title-row"><div className="section-icon">☎</div><div><h2>Contact details</h2><p>We’ll send the booking confirmation here.</p></div></div>
          <div className="field-grid">
            <Input label="Email address" type="email" value={email} onChange={setEmail} required autoComplete="email" />
            <Input label="Mobile number" type="tel" value={phone} onChange={setPhone} required autoComplete="tel" placeholder="+971…" />
          </div>
        </section>

        <section className="sandbox-note"><span>🧪</span><div><b>Sandbox mode</b><p>This creates a Duffel test order only. No real money will be charged.</p></div></section>

        <div className="bottom-spacer" />
        <div className="sticky-paybar">
          <div className="paybar-price"><span>Total</span><b>{offer ? formatter.format(offer.totalFare) : "—"}</b></div>
          <button disabled={submitting || !offer} type="submit" className="confirm-btn">{submitting ? "Booking…" : "Confirm booking"}</button>
        </div>
      </form>
      <Styles />
    </main>
  );
}

function ReceiptRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="receipt-row"><span>{label}</span><b className={strong ? "receipt-strong" : ""}>{value}</b></div>;
}

function Input({ label, value, onChange, type = "text", required = false, autoComplete, placeholder, maxLength }: { label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; autoComplete?: string; placeholder?: string; maxLength?: number }) {
  return <label className="field-label">{label}<input type={type} value={value} onChange={(e) => onChange(e.target.value)} required={required} className="field-input" autoComplete={autoComplete} placeholder={placeholder} maxLength={maxLength} /></label>;
}

function Styles() {
  return <style jsx global>{`
    body { background:#f5f7fb; }
    .checkout-shell{max-width:760px;margin:0 auto;min-height:100vh;padding:0 14px 32px;color:#101828;}
    .checkout-topbar{position:sticky;top:0;z-index:30;margin:0 -14px;padding:12px 14px;background:rgba(255,255,255,.96);backdrop-filter:blur(12px);display:flex;align-items:center;gap:12px;border-bottom:1px solid #edf0f4;}
    .back-btn{width:42px;height:42px;border:0;border-radius:14px;background:#f2f4f7;font-size:32px;line-height:1;color:#111827;display:grid;place-items:center;cursor:pointer;touch-action:manipulation;}
    .topbar-title{font-size:16px;font-weight:800}.topbar-sub{font-size:11px;color:#667085;margin-top:1px}.lock-badge{margin-left:auto;width:38px;height:38px;border-radius:12px;background:#ecfdf3;display:grid;place-items:center;font-size:16px}
    .progress-wrap{display:flex;align-items:center;padding:18px 26px 4px}.progress-dot{width:28px;height:28px;border-radius:50%;background:#e4e7ec;color:#667085;display:grid;place-items:center;font-size:12px;font-weight:800}.progress-dot.active{background:#ef1d2d;color:white}.progress-line{height:3px;flex:1;background:#ef1d2d}.progress-line.muted{background:#e4e7ec}.progress-labels{display:flex;justify-content:space-between;padding:0 14px 16px;font-size:11px;color:#667085;font-weight:700}
    .error-card{display:flex;flex-direction:column;gap:3px;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:14px;padding:13px 14px;margin-bottom:14px;font-size:13px}
    .flight-summary-card,.section-card{background:#fff;border:1px solid #eaecf0;border-radius:18px;box-shadow:0 3px 14px rgba(16,24,40,.04)}
    .flight-summary-card{padding:16px;margin-bottom:14px}.summary-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.summary-airline{font-size:15px;font-weight:800}.summary-flight{font-size:12px;color:#667085;margin-top:2px}.summary-price{font-size:20px;font-weight:900;color:#ef1d2d;white-space:nowrap}
    .route-row{display:grid;grid-template-columns:1fr 1.5fr 1fr;align-items:center;margin:18px 0 12px}.route-row>div{display:flex;flex-direction:column;gap:2px}.route-row b{font-size:17px}.route-row span{font-size:12px;color:#667085}.route-end{text-align:right;align-items:flex-end}.route-line{height:1px;background:#d0d5dd;position:relative}.route-line span{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:white;padding:0 7px;color:#ef1d2d;font-size:17px}.summary-meta{display:flex;justify-content:space-between;color:#667085;font-size:11px;border-top:1px dashed #eaecf0;padding-top:10px}.expiry-note{margin-top:10px;border-radius:9px;background:#fffaeb;color:#b54708;padding:8px 10px;font-size:11px;font-weight:700}
    .checkout-form{display:block}.section-card{padding:16px;margin-bottom:14px}.section-title-row{display:flex;gap:10px;align-items:flex-start;margin-bottom:14px}.section-icon{width:36px;height:36px;border-radius:12px;background:#fef2f2;display:grid;place-items:center}.section-title-row h2{font-size:16px;margin:0 0 2px}.section-title-row p{font-size:11px;color:#667085;margin:0}.passenger-block+.passenger-block{border-top:1px solid #f2f4f7;margin-top:16px;padding-top:16px}.passenger-chip{display:inline-flex;background:#f2f4f7;color:#344054;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:800;margin-bottom:12px}
    .field-grid{display:grid;grid-template-columns:1fr;gap:12px}.field-label{display:flex;flex-direction:column;gap:6px;font-size:12px;color:#344054;font-weight:700}.field-input{width:100%;height:48px;box-sizing:border-box;border:1px solid #d0d5dd;border-radius:12px;background:#fff;padding:0 13px;font-size:16px;color:#101828;outline:none;transition:border-color .15s,box-shadow .15s}.field-input:focus{border-color:#ef1d2d;box-shadow:0 0 0 3px rgba(239,29,45,.08)}
    .sandbox-note{display:flex;gap:10px;align-items:flex-start;background:#eff8ff;border:1px solid #b2ddff;border-radius:14px;padding:13px 14px;color:#175cd3}.sandbox-note b{font-size:13px}.sandbox-note p{font-size:11px;margin:2px 0 0;color:#475467}
    .bottom-spacer{height:96px}.sticky-paybar{position:fixed;left:0;right:0;bottom:0;z-index:40;background:rgba(255,255,255,.98);border-top:1px solid #eaecf0;padding:10px max(14px,env(safe-area-inset-left)) calc(10px + env(safe-area-inset-bottom));display:flex;align-items:center;gap:12px;box-shadow:0 -8px 24px rgba(16,24,40,.08)}.sticky-paybar>*{max-width:760px}.paybar-price{display:flex;flex-direction:column;min-width:100px}.paybar-price span{font-size:11px;color:#667085}.paybar-price b{font-size:16px}.confirm-btn{flex:1;height:50px;border:0;border-radius:14px;background:#ef1d2d;color:#fff;font-size:15px;font-weight:900;cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;box-shadow:0 6px 16px rgba(239,29,45,.2)}.confirm-btn:disabled{opacity:.55;cursor:not-allowed}.confirm-btn:active{transform:scale(.99)}
    .checkout-loading{min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:8px;color:#344054}.checkout-loading span{font-size:12px;color:#667085}.spinner{width:34px;height:34px;border:3px solid #f2f4f7;border-top-color:#ef1d2d;border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
    .confirmation-shell{display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:48px}.success-icon{width:72px;height:72px;border-radius:50%;background:#dcfae6;color:#079455;display:grid;place-items:center;font-size:34px;font-weight:900}.success-kicker{margin-top:18px;color:#079455;font-size:11px;font-weight:900;letter-spacing:.08em}.success-title{font-size:28px;margin:7px 0}.success-copy{font-size:13px;color:#667085;max-width:420px;margin:0 0 20px}.receipt-card{width:100%;background:#fff;border:1px solid #eaecf0;border-radius:18px;padding:6px 16px;margin-bottom:18px}.receipt-row{display:flex;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid #f2f4f7;font-size:13px;text-align:left}.receipt-row:last-child{border-bottom:0}.receipt-row span{color:#667085}.receipt-row b{text-align:right;word-break:break-all}.receipt-strong{font-size:18px;color:#101828}.primary-link{display:flex;align-items:center;justify-content:center;width:100%;height:50px;border-radius:14px;background:#101828;color:white;text-decoration:none;font-weight:800}
    @media(min-width:640px){.checkout-shell{padding-left:20px;padding-right:20px}.checkout-topbar{margin-left:-20px;margin-right:-20px;padding-left:20px;padding-right:20px}.field-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sticky-paybar{left:50%;transform:translateX(-50%);width:min(760px,100%);border:1px solid #eaecf0;border-bottom:0;border-radius:18px 18px 0 0}}
  `}</style>;
}
