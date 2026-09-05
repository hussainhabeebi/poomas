"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";

export default function NomodPaymentResultPage() {
  const params = useSearchParams();
  const bookingId = params.get("bookingId") ?? "";
  const token = params.get("token") ?? "";
  const result = params.get("result");
  const [status, setStatus] = useState<"checking" | "success" | "pending" | "failed">(
    result === "failed" ? "failed" : "checking",
  );

  useEffect(() => {
    if (!bookingId || !token || result === "failed") return;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout>;

    async function check() {
      attempts += 1;
      try {
        const res = await fetch(`${API}/api/payments/${encodeURIComponent(bookingId)}`, {
          headers: { "x-tenant-slug": "poomas", "X-Checkout-Token": token },
          cache: "no-store",
        });
        const data = await res.json() as { payment?: { status?: string } };
        if (data.payment?.status === "SUCCESS") {
          setStatus("success");
          return;
        }
      } catch {}
      if (attempts < 20) {
        setStatus("pending");
        timer = setTimeout(check, 2500);
      } else {
        setStatus("pending");
      }
    }

    check();
    return () => clearTimeout(timer);
  }, [bookingId, token, result]);

  const successful = status === "success";
  const failed = status === "failed";

  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", display: "grid", placeItems: "center", padding: 20 }}>
      <section style={{ width: "100%", maxWidth: 480, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 18, padding: 28, textAlign: "center", boxShadow: "0 18px 45px rgba(15,23,42,.09)" }}>
        <div style={{ width: 64, height: 64, display: "grid", placeItems: "center", margin: "0 auto 18px", borderRadius: "50%", background: successful ? "#dcfce7" : failed ? "#fee2e2" : "#ede9fe", fontSize: 28 }}>
          {successful ? "✓" : failed ? "×" : "…"}
        </div>
        <h1 style={{ margin: "0 0 9px", color: "#0f172a", fontSize: 24 }}>
          {successful ? "Payment confirmed" : failed ? "Payment was not completed" : "Confirming your payment"}
        </h1>
        <p style={{ margin: "0 0 22px", color: "#64748b", lineHeight: 1.55, fontSize: 14 }}>
          {successful
            ? "Your payment has been received. We are processing the booking and will send the ticket after confirmation."
            : failed
              ? "No charge was confirmed. You can return to checkout and try again."
              : "Nomod has returned you to POOMAS. Keep this page open while we verify the payment securely."}
        </p>
        {successful ? (
          <a href="/" style={button}>Back to home</a>
        ) : (
          <a href={token ? `/checkout/${token}` : "/"} style={button}>{failed ? "Try payment again" : "Return to checkout"}</a>
        )}
        <div style={{ marginTop: 18, color: "#94a3b8", fontSize: 11 }}>Booking reference: {bookingId.slice(0, 12) || "Unavailable"}</div>
      </section>
    </main>
  );
}

const button: React.CSSProperties = {
  display: "inline-block", background: "#e31e24", color: "#fff", textDecoration: "none",
  borderRadius: 10, padding: "12px 20px", fontWeight: 800, fontSize: 14,
};
