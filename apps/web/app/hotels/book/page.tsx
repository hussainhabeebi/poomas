"use client";

import { FormEvent, useEffect, useState } from "react";

type HotelInfo = {
  optionId: string; name: string; stars: number;
  price: number; currency: string;
  checkIn: string; checkOut: string; nights: number;
  rooms: number; roomType: string; mealPlan: string;
  isRefundable: boolean; city: string; address: string;
};

type Guest = { title: string; firstName: string; lastName: string };

const emptyGuest = (): Guest => ({ title: "Mr", firstName: "", lastName: "" });

export default function HotelBookPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";

  const [hotel,       setHotel]       = useState<HotelInfo | null>(null);
  const [prebooking,  setPrebooking]  = useState(false);
  const [prebooked,   setPrebooked]   = useState(false);
  const [prebookErr,  setPrebookErr]  = useState("");
  const [confirmedPrice, setConfirmedPrice] = useState<number | null>(null);

  const [contactName,  setContactName]  = useState("");
  const [email,        setEmail]        = useState("");
  const [phone,        setPhone]        = useState("");
  const [guests,       setGuests]       = useState<Guest[]>([emptyGuest()]);

  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState("");
  const [confirmation, setConfirmation] = useState<any>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const optionId = q.get("optionId") ?? "";
    if (!optionId) return;

    const roomCount = parseInt(q.get("rooms") ?? "1");
    const info: HotelInfo = {
      optionId,
      name:        q.get("name")     ?? "",
      stars:       parseInt(q.get("stars")  ?? "0"),
      price:       parseFloat(q.get("price") ?? "0"),
      currency:    q.get("currency") ?? "INR",
      checkIn:     q.get("checkIn")  ?? "",
      checkOut:    q.get("checkOut") ?? "",
      nights:      parseInt(q.get("nights") ?? "1"),
      rooms:       roomCount,
      roomType:    q.get("roomType") ?? "",
      mealPlan:    q.get("mealPlan") ?? "",
      isRefundable: q.get("ref") === "1",
      city:        q.get("city")    ?? "",
      address:     q.get("address") ?? "",
    };
    setHotel(info);
    setGuests(Array.from({ length: roomCount }, emptyGuest));

    // Pre-book price check
    setPrebooking(true);
    fetch(`${apiUrl}/api/hotels/prebook`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-tenant-slug": "poomas" },
      body: JSON.stringify({ optionId }),
    })
      .then((r) => r.json())
      .then((d: any) => {
        if (d.isAvailable === false) throw new Error("Hotel is no longer available for these dates");
        setConfirmedPrice(d.totalFare > 0 ? d.totalFare : null);
        setPrebooked(true);
      })
      .catch((err) => setPrebookErr(err?.message ?? "Price check failed"))
      .finally(() => setPrebooking(false));
  }, []);

  const money = (amount: number) => {
    const code = hotel?.currency ?? "INR";
    try {
      return new Intl.NumberFormat("en-IN", { style: "currency", currency: code, maximumFractionDigits: 0 }).format(amount);
    } catch {
      return `${code} ${amount.toLocaleString()}`;
    }
  };

  const updGuest = (i: number, k: keyof Guest, v: string) =>
    setGuests((gs) => gs.map((g, n) => n === i ? { ...g, [k]: v } : g));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!hotel || submitting || prebooking || (!prebooked && !prebookErr)) return;
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`${apiUrl}/api/hotels/book`, {
        method:  "POST",
        headers: { "Content-Type": "application/json", "x-tenant-slug": "poomas" },
        body: JSON.stringify({
          optionId:     hotel.optionId,
          contactName:  contactName.trim(),
          contactEmail: email.trim(),
          contactPhone: phone.trim(),
          guests: guests.map((g, i) => ({
            roomIndex: i,
            title:     g.title,
            firstName: g.firstName.trim(),
            lastName:  g.lastName.trim(),
            type:      "ADULT",
          })),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((d as any).error ?? `Booking failed (${res.status})`);
      setConfirmation(d);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (x: any) {
      setError(x?.message ?? "Booking failed");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setSubmitting(false);
    }
  }

  const displayPrice = confirmedPrice ?? hotel?.price ?? 0;
  const mealLabel: Record<string, string> = {
    CP: "Breakfast included", MAP: "Half board", AP: "Full board",
  };

  if (confirmation) {
    return (
      <main className="ck success"><style>{css}</style>
        <div className="ok">✓</div>
        <h1>Hotel Booked!</h1>
        {confirmation.bookingRef && (
          <p style={{ fontSize: 22, fontWeight: 800 }}>
            Ref: <span style={{ color: "#E31E24" }}>{confirmation.bookingRef}</span>
          </p>
        )}
        <p style={{ color: "#667085" }}>
          Confirmation details sent to {email}.
        </p>
        <div className="receipt">
          <Row l="Hotel"       v={hotel?.name         ?? "—"} />
          <Row l="Booking Ref" v={confirmation.bookingRef ?? "—"} />
          <Row l="Status"      v={confirmation.status  ?? "CONFIRMED"} />
          <Row l="Check-in"    v={hotel?.checkIn       ?? "—"} />
          <Row l="Check-out"   v={hotel?.checkOut      ?? "—"} />
        </div>
        <a className="home" href="/hotels">Search another hotel</a>
      </main>
    );
  }

  return (
    <main className="ck"><style>{css}</style>
      <header>
        <button type="button" onClick={() => history.back()}>‹</button>
        <div><b>Hotel Checkout</b><span>{hotel?.name ?? "Loading…"}</span></div>
        <i>🔒</i>
      </header>

      {error && <div className="err"><b>Couldn't continue</b><span>{error}</span></div>}

      {/* Price verification banner */}
      {prebooking && (
        <div className="prebook-banner prebook-checking">
          <span className="spinner" /> Verifying availability &amp; price…
        </div>
      )}
      {!prebooking && prebooked && (
        <div className="prebook-banner prebook-ok">
          ✓ Available — price confirmed
          {confirmedPrice !== null && hotel?.price !== confirmedPrice && (
            <b> · Updated to {money(confirmedPrice)}</b>
          )}
        </div>
      )}
      {!prebooking && prebookErr && (
        <div className="prebook-banner prebook-warn">
          ⚠ {prebookErr} — you can still try to book
        </div>
      )}

      {/* Hotel summary card */}
      {hotel && (
        <section className="card hotel">
          <div className="hh">
            <div>
              <b>{hotel.name}</b>
              <span style={{ color: "#f59e0b", fontSize: 12 }}>{"★".repeat(Math.min(5, hotel.stars))}</span>
              {hotel.address && <small>{hotel.address}</small>}
            </div>
            <strong>{money(displayPrice)}</strong>
          </div>
          <div className="hd">
            <div><b>{hotel.checkIn}</b><span>Check-in</span></div>
            <div className="hd-nights">{hotel.nights}n</div>
            <div className="hd-end"><b>{hotel.checkOut}</b><span>Check-out</span></div>
          </div>
          <div className="hmeta">
            {hotel.roomType && <span>{hotel.rooms} × {hotel.roomType}</span>}
            {hotel.mealPlan && hotel.mealPlan !== "EP" && <span>{mealLabel[hotel.mealPlan] ?? hotel.mealPlan}</span>}
            <span>{hotel.isRefundable ? "✓ Free cancellation" : "Non-refundable"}</span>
          </div>
        </section>
      )}

      <form onSubmit={submit}>
        {/* Contact details */}
        <section className="card">
          <div className="title">
            <span>☎</span>
            <div><h2>Contact details</h2><p>Confirmation will be sent here.</p></div>
          </div>
          <div className="grid">
            <Input l="Full name"     v={contactName} c={setContactName} r />
            <Input l="Email"  t="email" v={email}  c={setEmail} r />
            <Input l="Mobile" t="tel"   v={phone}  c={setPhone} r ph="+91…" />
          </div>
        </section>

        {/* Guest details */}
        <section className="card">
          <div className="title">
            <span>👤</span>
            <div>
              <h2>Guest details</h2>
              <p>Enter name as on government ID · one lead guest per room.</p>
            </div>
          </div>
          {guests.map((g, i) => (
            <div className="pax" key={i}>
              <div className="chip">Room {i + 1} — Lead guest</div>
              <div className="grid">
                <label>Title
                  <select value={g.title} onChange={(e) => updGuest(i, "title", e.target.value)}>
                    <option value="Mr">Mr</option>
                    <option value="Ms">Ms</option>
                    <option value="Mrs">Mrs</option>
                    <option value="Dr">Dr</option>
                  </select>
                </label>
                <Input l="First name" v={g.firstName} c={(v) => updGuest(i, "firstName", v)} r />
                <Input l="Last name"  v={g.lastName}  c={(v) => updGuest(i, "lastName",  v)} r />
              </div>
            </div>
          ))}
        </section>

        <div className="spacer" />
        <div className="pay">
          <div>
            <span>Total · {hotel?.nights ?? 0} nights</span>
            <b>{money(displayPrice)}</b>
          </div>
          <button disabled={!hotel || submitting || prebooking}>
            {submitting ? "Booking…" : "Confirm Booking"}
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

const css = `body{background:#f5f7fb}.ck{max-width:760px;margin:auto;min-height:100vh;padding:0 14px 32px;color:#101828}.ck header{position:sticky;top:0;z-index:30;margin:0 -14px;padding:12px 14px;background:#fff;display:flex;gap:12px;align-items:center;border-bottom:1px solid #eaecf0}.ck header button{width:44px;height:44px;border:0;border-radius:14px;background:#f2f4f7;font-size:31px}.ck header div{display:flex;flex-direction:column}.ck header div span{font-size:11px;color:#667085}.ck header i{margin-left:auto;font-style:normal}.err{display:flex;flex-direction:column;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;padding:13px;border-radius:14px;margin:14px 0}.prebook-banner{padding:11px 14px;border-radius:12px;font-size:13px;font-weight:700;margin:14px 0;display:flex;align-items:center;gap:8px}.prebook-checking{background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1}.prebook-ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}.prebook-warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e}.spinner{display:inline-block;width:14px;height:14px;border:2px solid #bae6fd;border-top-color:#0369a1;border-radius:50%;animation:spin .7s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.card{background:white;border:1px solid #eaecf0;border-radius:18px;padding:16px;margin-bottom:14px}.hh{display:flex;justify-content:space-between;gap:8px}.hh>div{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}.hh small{font-size:11px;color:#667085}.hh strong{font-size:20px;color:#ed1c24;flex-shrink:0}.hd{display:grid;grid-template-columns:1fr 1.2fr 1fr;align-items:center;margin:16px 0 10px}.hd>div{display:flex;flex-direction:column}.hd>div b{font-size:15px}.hd>div span{font-size:11px;color:#667085}.hd-nights{text-align:center;background:#f0f9ff;border-radius:99px;height:28px;display:grid;place-items:center;font-size:12px;font-weight:800;color:#0369a1;border:1px solid #bae6fd}.hd-end{text-align:right;align-items:flex-end}.hmeta{display:flex;flex-wrap:wrap;gap:8px;border-top:1px dashed #eaecf0;padding-top:10px;font-size:12px;color:#667085}.title{display:flex;gap:10px}.title h2{font-size:17px;margin:0}.title p{font-size:12px;color:#667085;margin:3px 0 14px}.pax+.pax{border-top:1px solid #f2f4f7;margin-top:16px;padding-top:16px}.chip{display:inline-block;background:#eff6ff;color:#1d4ed8;padding:6px 10px;border-radius:99px;font-size:11px;font-weight:800;margin-bottom:12px}.grid{display:grid;grid-template-columns:1fr;gap:12px}.grid label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#344054}.grid input,.grid select{height:50px;border:1px solid #d0d5dd;border-radius:12px;padding:0 13px;background:#fff;font-size:16px}.grid input:focus,.grid select:focus{outline:none;border-color:#ed1c24;box-shadow:0 0 0 3px rgba(237,28,36,.08)}.spacer{height:96px}.pay{position:fixed;left:0;right:0;bottom:0;z-index:40;background:#fff;border-top:1px solid #eaecf0;padding:10px 14px calc(10px + env(safe-area-inset-bottom));display:flex;gap:12px;align-items:center}.pay>div{display:flex;flex-direction:column;min-width:110px}.pay span{font-size:11px;color:#667085}.pay button{flex:1;height:52px;border:0;border-radius:14px;background:#ed1c24;color:#fff;font-size:16px;font-weight:800}.pay button:disabled{opacity:.55}.success{text-align:center;padding-top:48px}.ok{width:72px;height:72px;border-radius:50%;background:#dcfce7;color:#15803d;display:grid;place-items:center;margin:auto;font-size:36px}.success h1{font-size:24px;margin:16px 0 8px}.success p{color:#667085}.receipt{background:#fff;border:1px solid #eaecf0;border-radius:16px;margin:22px 0;text-align:left}.row{display:flex;justify-content:space-between;padding:14px;border-bottom:1px solid #f2f4f7}.row:last-child{border-bottom:0}.home{display:block;background:#111827;color:#fff;text-decoration:none;padding:14px;border-radius:14px;font-weight:800;margin-top:8px}@media(min-width:640px){.grid{grid-template-columns:repeat(2,1fr)}.pay{left:50%;transform:translateX(-50%);max-width:760px;border-radius:18px 18px 0 0}}`;
