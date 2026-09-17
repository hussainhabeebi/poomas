"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import SocialSignIn from "./SocialSignIn";
import { bookingError } from "./booking-error";

type Passenger = {
  type: "ADULT" | "CHILD" | "INFANT";
  firstName: string; lastName: string;
  dob: string; gender: "M" | "F";
  nationality: string;
  passportNumber: string; passportExpiry: string;
};

type FareInfo = {
  fareId: string; supplier: string;
  airlineName: string; flightNumber: string;
  origin: string; destination: string;
  departureTime: string; arrivalTime: string;
  duration: number; stops: number;
  totalFare: number; currency: string;
  isRefundable: boolean; cabinChecked: string;
};

type SavedPassenger = {
  id: string;
  firstName: string; lastName: string;
  dob: string | null; gender: string | null;
  nationality: string | null;
  passportNumber: string | null; passportExpiry: string | null;
  isDefault: boolean;
};

const emptyPassenger = (type: Passenger["type"] = "ADULT"): Passenger => ({
  type, firstName: "", lastName: "", dob: "", gender: "M", nationality: "IN",
  passportNumber: "", passportExpiry: "",
});

const AIRPORT_COUNTRY: Record<string, string> = {
  BOM:"IN", DEL:"IN", CCJ:"IN", COK:"IN", TRV:"IN", MAA:"IN", BLR:"IN",
  HYD:"IN", AMD:"IN", PNQ:"IN", GOI:"IN", CCU:"IN", LKO:"IN", IXJ:"IN",
  SXR:"IN", ATQ:"IN", IXC:"IN", VTZ:"IN", IXB:"IN", GAU:"IN", IXA:"IN",
  DXB:"AE", AUH:"AE", SHJ:"AE",
  DOH:"QA", MCT:"OM", BAH:"BH", KWI:"KW", RUH:"SA", JED:"SA", DMM:"SA",
  LHR:"GB", CDG:"FR", FRA:"DE", SIN:"SG", KUL:"MY", BKK:"TH",
  HKG:"HK", NRT:"JP", JFK:"US", LAX:"US", ORD:"US", YYZ:"CA", SYD:"AU", MEL:"AU",
  CMB:"LK", KTM:"NP", DAC:"BD", MLE:"MV",
};

function getToken(): string {
  try {
    const match = document.cookie.match(/(?:^|;\s*)poomas_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  } catch { return ""; }
}

export default function BookPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";
  const [fare, setFare] = useState<FareInfo | null>(null);
  const [passengers, setPassengers] = useState<Passenger[]>([emptyPassenger()]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [bookingUncertain, setBookingUncertain] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [fareExpired, setFareExpired] = useState(false);
  const [confirmation, setConfirmation] = useState<any>(null);

  // Auth state
  const [token, setToken] = useState("");
  const [savedPassengers, setSavedPassengers] = useState<SavedPassenger[]>([]);
  const [saveDetails, setSaveDetails] = useState(false);

  // Inline login state
  const [showLogin, setShowLogin] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const fareId   = q.get("fareId") ?? "";
    const supplier = q.get("supplier") ?? "";
    if (!fareId || !supplier) return;
    const adults   = Math.min(9, Math.max(1, Number(q.get("adults"))   || 1));
    const children = Math.min(6, Math.max(0, Number(q.get("children")) || 0));
    const infants  = Math.min(4, Math.max(0, Number(q.get("infants"))  || 0));
    setPassengers([
      ...Array.from({ length: adults },   () => emptyPassenger("ADULT")),
      ...Array.from({ length: children }, () => emptyPassenger("CHILD")),
      ...Array.from({ length: infants },  () => emptyPassenger("INFANT")),
    ]);
    setFare({
      fareId, supplier,
      airlineName:   q.get("airline") ?? "",
      flightNumber:  q.get("fn") ?? "",
      origin:        q.get("from") ?? "",
      destination:   q.get("to") ?? "",
      departureTime: q.get("dep") ?? "",
      arrivalTime:   q.get("arr") ?? "",
      duration:      parseInt(q.get("dur") ?? "0"),
      stops:         parseInt(q.get("stops") ?? "0"),
      totalFare:     parseFloat(q.get("price") ?? "0"),
      currency:      q.get("cur") ?? "INR",
      isRefundable:  q.get("ref") === "1",
      cabinChecked:  q.get("bag") ?? "15 KG",
    });

  }, []);

  useEffect(() => {
    const t = getToken();
    if (t) {
      setToken(t);
      fetchSavedPassengers(t);
    }
  }, []);

  async function fetchSavedPassengers(t: string) {
    try {
      const res = await fetch(`${apiUrl}/api/profile/passengers`, {
        headers: { "Authorization": `Bearer ${t}`, "x-tenant-slug": "poomas" },
      });
      if (res.ok) {
        const d = await res.json() as { passengers: SavedPassenger[] };
        setSavedPassengers(d.passengers ?? []);
        const def = d.passengers.find((p) => p.isDefault);
        if (def) setPassengers((prev) => prev.map((p, i) => i === 0 && !p.firstName && !p.lastName
          ? { ...p, firstName: def.firstName, lastName: def.lastName, dob: def.dob?.slice(0, 10) ?? p.dob,
              gender: (def.gender as "M" | "F") ?? p.gender, nationality: def.nationality ?? p.nationality,
              passportNumber: def.passportNumber ?? p.passportNumber, passportExpiry: def.passportExpiry?.slice(0, 10) ?? p.passportExpiry }
          : p));
      }
    } catch { /* non-fatal */ }
  }

  function applyProfile(p: SavedPassenger, idx: number) {
    setPassengers((prev) => prev.map((x, i) => i !== idx ? x : {
      ...x,
      firstName:      p.firstName,
      lastName:       p.lastName,
      dob:            p.dob ? p.dob.slice(0, 10) : x.dob,
      gender:         (p.gender as "M" | "F") ?? x.gender,
      nationality:    p.nationality ?? x.nationality,
      passportNumber: p.passportNumber ?? x.passportNumber,
      passportExpiry: p.passportExpiry ? p.passportExpiry.slice(0, 10) : x.passportExpiry,
    }));
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoggingIn(true);
    try {
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-slug": "poomas" },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const d = await res.json() as any;
      if (!res.ok) throw new Error(d.error ?? "Login failed");
      document.cookie = `poomas_token=${d.token}; Path=/; SameSite=Lax; Secure`;
      setToken(d.token);
      setShowLogin(false);
      await fetchSavedPassengers(d.token);
    } catch (x: any) {
      setLoginError(x?.message ?? "Login failed");
    } finally {
      setLoggingIn(false);
    }
  }

  const isInternational = useMemo(() => {
    if (!fare) return false;
    const fromC = AIRPORT_COUNTRY[fare.origin.toUpperCase()];
    const toC   = AIRPORT_COUNTRY[fare.destination.toUpperCase()];
    return !!fromC && !!toC && fromC !== toC;
  }, [fare]);

  const money = useMemo(() => {
    try {
      return new Intl.NumberFormat("en-IN", {
        style: "currency", currency: fare?.currency ?? "INR", maximumFractionDigits: 0,
      });
    } catch { return new Intl.NumberFormat("en"); }
  }, [fare?.currency]);

  const upd = (i: number, k: keyof Passenger, v: string) =>
    setPassengers((p) => p.map((x, n) => n === i ? { ...x, [k]: v } : x));

  const t = (s?: string) =>
    s ? new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!fare || submitting || fareExpired || bookingUncertain) return;
    if (!reviewing) { setReviewing(true); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/book`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-tenant-slug": "poomas" },
        body: JSON.stringify({
          fareId:        fare.fareId,
          supplier:      fare.supplier,
          contactEmail:  email.trim(),
          contactPhone:  phone.trim(),
          origin:        fare.origin,
          destination:   fare.destination,
          departureDate: fare.departureTime.slice(0, 10),
          totalFare:     fare.totalFare,
          currency:      fare.currency,
          passengers:    passengers.map((p) => ({
            ...p,
            firstName:      p.firstName.trim(),
            lastName:       p.lastName.trim(),
            nationality:    p.nationality.trim().toUpperCase().slice(0, 2) || "IN",
            passportNumber: p.passportNumber.trim() || undefined,
            passportExpiry: p.passportExpiry || undefined,
          })),
        }),
      }).catch(() => {
        setBookingUncertain(true);
        throw new Error(bookingError({ errorCode: "BOOKING_STATUS_UNKNOWN" }, 502));
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if ((d as any).errorCode === "FARE_EXPIRED") {
          setFareExpired(true);
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        if (d.errorCode === "BOOKING_STATUS_UNKNOWN" || !d.errorCode && res.status >= 500) setBookingUncertain(true);
        throw new Error(bookingError(d, res.status));
      }
      if (d.success !== true || typeof d.bookingReference !== "string" || !d.bookingReference) {
        setBookingUncertain(true);
        throw new Error(bookingError({ errorCode: "BOOKING_STATUS_UNKNOWN" }, 502));
      }

      // Save traveller details if opted in
      if (saveDetails && token) {
        for (const p of passengers) {
          if (!p.firstName || !p.lastName) continue;
          const existing = savedPassengers.find(
            (s) => s.firstName.toLowerCase() === p.firstName.trim().toLowerCase() &&
                   s.lastName.toLowerCase()  === p.lastName.trim().toLowerCase(),
          );
          if (!existing) {
            fetch(`${apiUrl}/api/profile/passengers`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}`, "x-tenant-slug": "poomas" },
              body: JSON.stringify({
                firstName:      p.firstName.trim(),
                lastName:       p.lastName.trim(),
                dob:            p.dob || undefined,
                gender:         p.gender,
                nationality:    p.nationality.toUpperCase().slice(0, 2) || undefined,
                passportNumber: p.passportNumber.trim() || undefined,
                passportExpiry: p.passportExpiry || undefined,
                isDefault:      savedPassengers.length === 0,
              }),
            }).catch(() => {});
          }
        }
      }

      setConfirmation(d);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (x: any) {
      setError(x?.message ?? "Booking failed. Please check your details and try again.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  }

  if (confirmation) {
    return (
      <main className="ck success"><style>{css}{checkoutCss}</style>
        <div className="ok">✓</div>
        <h1>{["CONFIRMED", "TICKETED"].includes(confirmation.status) && confirmation.pnr ? "Booking confirmed" : "Booking request received"}</h1>
        {confirmation.warningCode === "BOOKING_SAVE_PENDING" && <p>The supplier accepted your request, but we couldn't save all details. Do not book again. Contact support with your booking reference.</p>}
        {confirmation.status === "PENDING" && <p>Airline confirmation is pending. Do not submit another booking for this flight.</p>}
        {confirmation.pnr && (
          <p style={{ fontSize: 22, fontWeight: 800 }}>
            PNR: <span style={{ color: "#E31E24" }}>{confirmation.pnr}</span>
          </p>
        )}
        <p style={{ color: "#667085" }}>
          Keep this reference for your booking. Contact email: {email}.
        </p>
        <div className="receipt">
          <Row l="Booking ID"  v={confirmation.bookingId        ?? "—"} />
          <Row l="Booking Ref" v={confirmation.bookingReference ?? "—"} />
          <Row l="PNR"         v={confirmation.pnr              ?? "—"} />
          <Row l="Status"      v={confirmation.status           ?? "CONFIRMED"} />
        </div>
        <a className="home" href="/">Search another flight</a>
      </main>
    );
  }

  return (
    <main className="ck"><style>{css}{checkoutCss}</style>
      <header>
        <button type="button" aria-label={reviewing ? "Edit traveller details" : "Back to results"} disabled={submitting} onClick={() => reviewing ? setReviewing(false) : history.back()}>‹</button>
        <div><b>{reviewing ? "Review your booking" : "Complete your booking"}</b><span>{reviewing ? "Check names and contact details" : "Continue as a guest — no account required"}</span></div>
        <i>🔒</i>
      </header>

      <p className="checkoutProgress">{reviewing ? "Step 2 of 2 · Review" : "Step 1 of 2 · Traveller details"}</p>

      {fareExpired && (
        <div className="err" role="alert">
          <b>This fare is no longer available</b>
          <span>The supplier could not offer this fare. Your entered details remain on this page.</span>
          <a href="/">Search flights again</a>
        </div>
      )}

      {error && <div className="err"><b>Couldn't continue</b><span>{error}</span></div>}

      {/* Login banner — shown when not logged in */}
      {!token && !reviewing && (
        <div className="loginBanner">
          <SocialSignIn apiUrl={apiUrl} onSuccess={(result) => {
            document.cookie = `poomas_token=${result.token}; Path=/; SameSite=Lax; Secure; Max-Age=86400`;
            setToken(result.token); setShowLogin(false);
            setEmail((previous) => previous || result.customer.email || "");
            void fetchSavedPassengers(result.token);
          }} />
          <span>Have an account? <button type="button" className="linkBtn" onClick={() => setShowLogin((v) => !v)}>Sign in with email</button></span>
        </div>
      )}

      {/* Inline login form */}
      {showLogin && !reviewing && (
        <section className="card loginCard">
          <div className="title">
            <span>👤</span>
            <div><h2>Sign in</h2><p>Auto-fill your saved traveller details.</p></div>
          </div>
          {loginError && <div className="err"><span>{loginError}</span></div>}
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="grid">
              <Input l="Email" t="email" v={loginEmail} c={setLoginEmail} r />
              <Input l="Password" t="password" v={loginPassword} c={setLoginPassword} r />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" className="loginBtn" disabled={loggingIn}>
                {loggingIn ? "Signing in…" : "Sign in"}
              </button>
              <button type="button" className="cancelBtn" onClick={() => setShowLogin(false)}>Cancel</button>
            </div>
          </form>
        </section>
      )}

      {fare && (
        <section className="card flight">
          <div className="fh">
            <div><b>{fare.airlineName}</b><span>{fare.flightNumber}</span></div>
            <strong>{money.format(fare.totalFare)}</strong>
          </div>
          <div className="route">
            <div><b>{t(fare.departureTime)}</b><span>{fare.origin}</span></div>
            <div className="plane">✈</div>
            <div className="end"><b>{t(fare.arrivalTime)}</b><span>{fare.destination}</span></div>
          </div>
          <div className="meta">
            <span>{fare.stops === 0 ? "Nonstop" : `${fare.stops} stop`} · {Math.floor(fare.duration / 60)}h {fare.duration % 60}m</span>
            <span>{fare.isRefundable ? "✓ Refundable" : "Non-refundable"}</span>
            <span>{fare.cabinChecked}</span>
          </div>
        </section>
      )}

      <form onSubmit={submit}>
        {reviewing ? (
          <section className="card">
            <h2>Review traveller details</h2>
            {passengers.map((p, i) => <p key={i}><b>Traveller {i + 1}:</b> {p.firstName} {p.lastName}</p>)}
            <p>{email}<br />{phone}</p>
            <p className="signinNote">Check names match the travel document. Availability is confirmed when you submit.</p>
            <button type="button" className="cancelBtn" disabled={submitting} onClick={() => setReviewing(false)}>Edit details</button>
          </section>
        ) : (<>
        <section className="card">
          <div className="title">
            <span>👤</span>
            <div><h2>Traveller details</h2><p>Enter details exactly as on your passport.</p></div>
          </div>
          {passengers.map((p, i) => (
            <div className="pax" key={i}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <span className="chip">Passenger {i + 1}</span>
                <select
                  className="typeSelect"
                  value={p.type}
                  onChange={(e) => upd(i, "type", e.target.value as Passenger["type"])}
                  aria-label={`Passenger ${i + 1} type`}
                >
                  <option value="ADULT">Adult (12+)</option>
                  <option value="CHILD">Child (2–11)</option>
                  <option value="INFANT">Infant (under 2)</option>
                </select>
                {savedPassengers.length > 0 && (
                  <select
                    className="profileSelect"
                    value=""
                    onChange={(e) => {
                      const sp = savedPassengers.find((s) => s.id === e.target.value);
                      if (sp) applyProfile(sp, i);
                    }}
                  >
                    <option value="">Use saved profile…</option>
                    {savedPassengers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.firstName} {s.lastName}{s.isDefault ? " ★" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="grid">
                <Input l="First name"             v={p.firstName}      c={(v) => upd(i, "firstName",      v)} r />
                <Input l="Last name"              v={p.lastName}       c={(v) => upd(i, "lastName",       v)} r />
                <Input l="Date of birth"  t="date" v={p.dob}           c={(v) => upd(i, "dob",            v)} r={p.type !== "ADULT" || isInternational} />
                <label>Gender
                  <select value={p.gender} onChange={(e) => upd(i, "gender", e.target.value as "M" | "F")}>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </label>
              </div>
              <div className="passportSection">
                {isInternational && (
                  <p className="intlBadge">✈ International flight — passport details required</p>
                )}
                <div className="grid">
                  <Input l="Nationality (e.g. IN, AE)" v={p.nationality} c={(v) => upd(i, "nationality", v.toUpperCase().slice(0, 2))} max={2} r={isInternational} />
                  <Input l="Passport number" v={p.passportNumber} c={(v) => upd(i, "passportNumber", v)} r={isInternational} />
                  <Input l="Passport expiry" t="date" v={p.passportExpiry} c={(v) => upd(i, "passportExpiry", v)} r={isInternational} />
                </div>
              </div>
            </div>
          ))}

          {/* Save details option — only when logged in */}
          {token && (
            <label className="saveCheck">
              <input type="checkbox" checked={saveDetails} onChange={(e) => setSaveDetails(e.target.checked)} />
              Save traveller details for next time
            </label>
          )}
        </section>

        <section className="card">
          <div className="title">
            <span>☎</span>
            <div><h2>Contact details</h2><p>Booking confirmation will be sent here.</p></div>
          </div>
          <div className="grid">
            <Input l="Email address" t="email" v={email} c={setEmail} r />
            <Input l="Mobile number" t="tel"   v={phone} c={setPhone} r ph="+91…" />
          </div>
        </section>

        </>)}

        <div className="spacer" />
        <div className="pay">
          <div>
            <span>Total</span>
            <b>{fare ? money.format(fare.totalFare) : "—"}</b>
          </div>
          <button disabled={!fare || submitting || fareExpired || bookingUncertain}>
            {submitting ? "Submitting booking…" : bookingUncertain ? "Contact support to check status" : reviewing ? "Confirm booking" : "Review booking"}
          </button>
        </div>
      </form>
    </main>
  );
}

function Input({ l, v, c, t = "text", r = false, ph, max }: {
  l: string; v: string; c: (v: string) => void; t?: string; r?: boolean; ph?: string; max?: number;
}) {
  return (
    <label>{l}
      <input type={t} value={v} onChange={(e) => c(e.target.value)}
        required={r} placeholder={ph} maxLength={max} />
    </label>
  );
}

function Row({ l, v }: { l: string; v: string }) {
  return <div className="row"><span>{l}</span><b>{v}</b></div>;
}

const checkoutCss = `.ck header{position:static;z-index:auto}.checkoutProgress{font-size:13px;color:#667085;margin:16px 0}.socialButtons{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:12px}.appleButton{background:#000;color:#fff;border:1px solid #000;min-height:44px;border-radius:6px;padding:10px 20px;font:600 15px system-ui;cursor:pointer}.signinNote{font-size:13px;color:#667085;line-height:1.5}.passportSection{margin-top:16px}.intlBadge{font-size:12px;font-weight:700;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:7px 11px;margin-bottom:12px}.ck .card h2{font-size:18px}.loginBanner{background:#fff;border-color:#eaecf0;color:#344054}`;

const css = `.checkBanner{display:flex;align-items:center;gap:8px;background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1;padding:11px 14px;border-radius:12px;font-size:13px;font-weight:700;margin-bottom:14px}.checkError{justify-content:space-between;background:#fff7ed;border-color:#fed7aa;color:#9a3412}.checkError button{border:0;background:#ea580c;color:#fff;border-radius:8px;padding:7px 12px;font-weight:800;cursor:pointer}.spinner{display:inline-block;width:14px;height:14px;border:2px solid #bae6fd;border-top-color:#0369a1;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}@keyframes spin{to{transform:rotate(360deg)}}body{background:#f5f7fb}.ck{max-width:760px;margin:auto;min-height:100vh;padding:0 14px 32px;color:#101828}.ck header{position:sticky;top:0;z-index:30;margin:0 -14px;padding:12px 14px;background:#fff;display:flex;gap:12px;align-items:center;border-bottom:1px solid #eaecf0}.ck header button{width:44px;height:44px;border:0;border-radius:14px;background:#f2f4f7;font-size:31px}.ck header div{display:flex;flex-direction:column}.ck header div span{font-size:11px;color:#667085}.ck header i{margin-left:auto;font-style:normal}.steps{display:flex;align-items:center;padding:18px 24px 4px}.steps b{width:28px;height:28px;border-radius:50%;background:#ed1c24;color:#fff;display:grid;place-items:center;font-size:12px}.steps b.off{background:#e4e7ec;color:#667085}.steps em{height:3px;flex:1;background:#ed1c24}.steps em.off{background:#e4e7ec}.stepLabels{display:flex;justify-content:space-between;padding:0 10px 16px;color:#667085;font-size:11px;font-weight:700}.err{display:flex;flex-direction:column;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;padding:13px;border-radius:14px;margin-bottom:14px}.loginBanner{background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;padding:12px 14px;border-radius:14px;margin-bottom:14px;font-size:13px}.linkBtn{background:none;border:none;color:#1d4ed8;font-weight:700;cursor:pointer;text-decoration:underline;padding:0;font-size:inherit}.loginCard{border-color:#bfdbfe}.loginBtn{flex:1;height:44px;border:0;border-radius:12px;background:#1d4ed8;color:#fff;font-size:14px;font-weight:700;cursor:pointer}.loginBtn:disabled{opacity:.55}.cancelBtn{height:44px;padding:0 18px;border:1px solid #d0d5dd;border-radius:12px;background:#fff;font-size:14px;cursor:pointer}.profileSelect{height:36px;border:1px solid #d0d5dd;border-radius:10px;padding:0 10px;background:#fff;font-size:13px;color:#344054;cursor:pointer}.saveCheck{display:flex;align-items:center;gap:8px;margin-top:16px;font-size:13px;color:#344054;cursor:pointer}.saveCheck input{width:16px;height:16px;accent-color:#ed1c24}.card{background:white;border:1px solid #eaecf0;border-radius:18px;padding:16px;margin-bottom:14px}.fh{display:flex;justify-content:space-between}.fh>div{display:flex;flex-direction:column}.fh span,.route span,.meta,.flight small{font-size:12px;color:#667085}.fh strong{font-size:20px;color:#ed1c24}.route{display:grid;grid-template-columns:1fr 1.2fr 1fr;align-items:center;margin:20px 0 12px}.route>div{display:flex;flex-direction:column}.route .end{text-align:right;align-items:flex-end}.plane{text-align:center;border-bottom:1px solid #d0d5dd;height:10px;color:#ed1c24}.meta{display:flex;justify-content:space-between;border-top:1px dashed #eaecf0;padding-top:10px;gap:8px}.title{display:flex;gap:10px}.title h2{font-size:17px;margin:0}.title p{font-size:12px;color:#667085;margin:3px 0 14px}.pax+.pax{border-top:1px solid #f2f4f7;margin-top:16px;padding-top:16px}.chip{display:inline-block;background:#fff1f2;color:#be123c;padding:6px 10px;border-radius:99px;font-size:11px;font-weight:800}.typeSelect{height:32px;border:1px solid #fecdd3;border-radius:99px;padding:0 10px;background:#fff1f2;color:#be123c;font-size:11px;font-weight:800;cursor:pointer;appearance:none;-webkit-appearance:none;padding-right:22px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23be123c'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center}.typeSelect:focus{outline:none;box-shadow:0 0 0 3px rgba(237,28,36,.08)}.grid{display:grid;grid-template-columns:1fr;gap:12px}.grid label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#344054}.grid input,.grid select{height:50px;border:1px solid #d0d5dd;border-radius:12px;padding:0 13px;background:#fff;font-size:16px}.grid input:focus,.grid select:focus{outline:none;border-color:#ed1c24;box-shadow:0 0 0 3px rgba(237,28,36,.08)}.spacer{height:96px}.pay{position:fixed;left:0;right:0;bottom:0;z-index:40;background:#fff;border-top:1px solid #eaecf0;padding:10px 14px calc(10px + env(safe-area-inset-bottom));display:flex;gap:12px;align-items:center}.pay>div{display:flex;flex-direction:column;min-width:110px}.pay span{font-size:11px;color:#667085}.pay button{flex:1;height:52px;border:0;border-radius:14px;background:#ed1c24;color:#fff;font-size:16px;font-weight:800}.pay button:disabled{opacity:.55}.success{text-align:center;padding-top:48px}.ok{width:72px;height:72px;border-radius:50%;background:#dcfce7;color:#15803d;display:grid;place-items:center;margin:auto;font-size:36px}.success h1{font-size:24px;margin:16px 0 8px}.success p{color:#667085}.receipt{background:#fff;border:1px solid #eaecf0;border-radius:16px;margin:22px 0;text-align:left}.row{display:flex;justify-content:space-between;padding:14px;border-bottom:1px solid #f2f4f7}.row:last-child{border-bottom:0}.home{display:block;background:#111827;color:#fff;text-decoration:none;padding:14px;border-radius:14px;font-weight:800;margin-top:8px}.ck button,.home{touch-action:manipulation;-webkit-tap-highlight-color:transparent}@media(min-width:640px){.grid{grid-template-columns:repeat(2,1fr)}.pay{left:50%;transform:translateX(-50%);max-width:760px;border-radius:18px 18px 0 0}}`;
