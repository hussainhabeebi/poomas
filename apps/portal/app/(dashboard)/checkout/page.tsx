"use client";
export const runtime = "edge";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

interface PaymentInfo {
  ready:       boolean;
  bookingId:   string;
  totalAmount: string;
  currency:    string;
  gateway?:    "RAZORPAY" | "NOMOD";
  orderId?:    string;
  keyId?:      string;       // Razorpay
  checkoutUrl?: string;      // Nomod
}

function CheckoutContent() {
  const sp        = useSearchParams();
  const fareId    = sp.get("fareId") ?? "";
  const supplier  = sp.get("supplier") ?? "";
  const bookingId = sp.get("bookingId") ?? "";

  const [step, setStep]       = useState<"form" | "paying" | "done">(bookingId ? "paying" : "form");
  const [payInfo, setPayInfo] = useState<PaymentInfo | null>(null);
  const [polling, setPolling] = useState(false);
  const [form, setForm]       = useState({
    firstName: "", lastName: "", email: "", phone: "",
    gender: "M" as "M" | "F",
    passportNumber: "", passportExpiry: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");

  // Poll for payment URL after booking creation
  useEffect(() => {
    if (!bookingId || step !== "paying") return;
    setPolling(true);

    const poll = async () => {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`/api/payments/checkout/${bookingId}`);
        const data = await res.json() as PaymentInfo;
        if (data.ready) {
          setPayInfo(data);
          setPolling(false);

          // Auto-redirect Nomod
          if (data.gateway === "NOMOD" && data.checkoutUrl) {
            window.location.href = data.checkoutUrl;
          }
          return;
        }
      }
      setPolling(false);
      setError("Payment gateway timed out. Please contact support.");
    };

    poll();
  }, [bookingId, step]);

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/bookings", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          fareId,
          supplier,
          passengers: [{
            type:      "ADULT",
            firstName: form.firstName,
            lastName:  form.lastName,
            gender:    form.gender,
            passportNumber: form.passportNumber || undefined,
            passportExpiry: form.passportExpiry || undefined,
          }],
          contactEmail:  form.email,
          contactPhone:  form.phone,
          paymentMethod: "GATEWAY",
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { bookingId: string };
      window.history.replaceState(null, "", `?bookingId=${data.bookingId}&fareId=${fareId}&supplier=${supplier}`);
      setStep("paying");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Booking failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleRazorpayPay() {
    if (!payInfo?.orderId || !payInfo.keyId) return;

    // Dynamically load Razorpay checkout script
    const script = document.createElement("script");
    script.src   = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => {
      const rzp = new (window as unknown as { Razorpay: new (opts: unknown) => { open(): void } }).Razorpay({
        key:          payInfo.keyId,
        order_id:     payInfo.orderId,
        amount:       Number(payInfo.totalAmount) * 100,
        currency:     payInfo.currency,
        name:         "POOMAS Traveldays",
        description:  "Flight Booking",
        handler:      () => { setStep("done"); },
        modal:        { ondismiss: () => {} },
      });
      rzp.open();
    };
    document.body.appendChild(script);
  }

  if (step === "done") {
    return (
      <div style={{ textAlign: "center", padding: "60px 0" }}>
        <div style={{ fontSize: 56, marginBottom: 16 }}>✅</div>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Payment Successful!</h2>
        <p style={{ color: "#6b7280", marginBottom: 24 }}>Your booking is confirmed. Check your email for the e-ticket.</p>
        <a href="/bookings" style={{ background: "#E31E24", color: "white", padding: "12px 28px", borderRadius: 8, textDecoration: "none", fontWeight: 600 }}>
          View Bookings →
        </a>
      </div>
    );
  }

  if (step === "paying") {
    return (
      <div style={{ maxWidth: 500, margin: "0 auto", paddingTop: 40 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24 }}>Complete Payment</h2>
        {polling && (
          <div style={{ background: "white", borderRadius: 12, padding: 32, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <p style={{ color: "#6b7280" }}>Setting up payment gateway…</p>
          </div>
        )}
        {payInfo && payInfo.gateway === "RAZORPAY" && (
          <div style={{ background: "white", borderRadius: 12, padding: 32, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, color: "#6b7280" }}>Total Amount</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#E31E24" }}>
                ₹{Number(payInfo.totalAmount).toLocaleString("en-IN")}
              </div>
            </div>
            <button
              onClick={handleRazorpayPay}
              style={{ width: "100%", background: "#E31E24", color: "white", border: "none", borderRadius: 8, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
            >
              Pay with Razorpay
            </button>
          </div>
        )}
        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: 16, color: "#b91c1c", marginTop: 16 }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  // Step: form
  return (
    <div style={{ maxWidth: 560, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 24, fontSize: 22, fontWeight: 700 }}>Passenger Details</h1>
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: 16, color: "#b91c1c", marginBottom: 20 }}>
          {error}
        </div>
      )}

      <form onSubmit={handleBook} style={{ background: "white", borderRadius: 12, padding: 28, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 20, paddingBottom: 12, borderBottom: "1px solid #f3f4f6" }}>Passenger 1 — Adult</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <Field label="First Name" required>
            <input required value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} style={iStyle} />
          </Field>
          <Field label="Last Name" required>
            <input required value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} style={iStyle} />
          </Field>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Field label="Gender" required>
            <select value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value as "M" | "F" }))} style={iStyle}>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </Field>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <Field label="Passport Number">
            <input value={form.passportNumber} onChange={(e) => setForm((f) => ({ ...f, passportNumber: e.target.value }))} placeholder="Optional" style={iStyle} />
          </Field>
          <Field label="Passport Expiry">
            <input type="date" value={form.passportExpiry} onChange={(e) => setForm((f) => ({ ...f, passportExpiry: e.target.value }))} style={iStyle} />
          </Field>
        </div>

        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "24px 0 16px", paddingTop: 16, borderTop: "1px solid #f3f4f6" }}>Contact Details</h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
          <Field label="Email" required>
            <input required type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} style={iStyle} />
          </Field>
          <Field label="Phone" required>
            <input required type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} style={iStyle} />
          </Field>
        </div>

        <button
          type="submit" disabled={submitting}
          style={{ width: "100%", background: "#E31E24", color: "white", border: "none", borderRadius: 8, padding: "14px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
        >
          {submitting ? "Processing…" : "Proceed to Payment"}
        </button>
      </form>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", display: "block", marginBottom: 6 }}>
        {label}{required && <span style={{ color: "#E31E24" }}> *</span>}
      </label>
      {children}
    </div>
  );
}

const iStyle: React.CSSProperties = {
  width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px",
  fontSize: 14, boxSizing: "border-box", outline: "none",
};

export default function CheckoutPage() {
  return (
    <Suspense fallback={<p style={{ color: "#6b7280" }}>Loading…</p>}>
      <CheckoutContent />
    </Suspense>
  );
}
