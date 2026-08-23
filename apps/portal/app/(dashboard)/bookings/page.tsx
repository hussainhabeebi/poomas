"use client";
import { useState, useEffect } from "react";

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  SEARCHED:        { bg: "#f3f4f6", color: "#6b7280" },
  HELD:            { bg: "#fef3c7", color: "#92400e" },
  PAYMENT_PENDING: { bg: "#fffbeb", color: "#d97706" },
  PAYMENT_FAILED:  { bg: "#fef2f2", color: "#b91c1c" },
  CONFIRMED:       { bg: "#ecfdf5", color: "#065f46" },
  TICKETED:        { bg: "#d1fae5", color: "#065f46" },
  CANCELLED:       { bg: "#f3f4f6", color: "#374151" },
  REFUND_PENDING:  { bg: "#ede9fe", color: "#5b21b6" },
  REFUNDED:        { bg: "#f5f3ff", color: "#6d28d9" },
  REISSUED:        { bg: "#ecfdf5", color: "#047857" },
};

interface Booking {
  id:          string;
  status:      string;
  origin:      string;
  destination: string;
  departureDate: string;
  adultCount:  number;
  childCount:  number;
  totalAmount: string;
  currency:    string;
  pnr:         string | null;
  supplier:    string;
  createdAt:   string;
}

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState<Booking | null>(null);

  useEffect(() => {
    fetch("/api/bookings")
      .then((r) => r.json())
      .then((data: { bookings: Booking[] }) => setBookings(data.bookings ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const currSym = (c: string) =>
    c === "INR" ? "₹" : c === "AED" ? "د.إ" : "$";

  return (
    <div>
      <h1 style={{ marginBottom: 24, fontSize: 22, fontWeight: 700 }}>My Bookings</h1>

      {loading && <p style={{ color: "#6b7280" }}>Loading…</p>}

      {!loading && bookings.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✈️</div>
          <p>No bookings yet. <a href="/search" style={{ color: "#E31E24" }}>Book your first flight →</a></p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {bookings.map((b) => {
          const sc = STATUS_COLORS[b.status] ?? { bg: "#f3f4f6", color: "#374151" };
          return (
            <div
              key={b.id}
              onClick={() => setSelected(b)}
              style={{
                background: "white", borderRadius: 12, padding: 20, cursor: "pointer",
                boxShadow: "0 1px 4px rgba(0,0,0,.08)", display: "flex", alignItems: "center", gap: 20,
                border: selected?.id === b.id ? "2px solid #E31E24" : "2px solid transparent",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {b.origin} → {b.destination}
                </div>
                <div style={{ color: "#6b7280", fontSize: 13, marginTop: 4 }}>
                  {new Date(b.departureDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                  &nbsp;·&nbsp; {b.adultCount + b.childCount} pax &nbsp;·&nbsp; {b.supplier}
                  {b.pnr && <> &nbsp;·&nbsp; PNR: <strong>{b.pnr}</strong></>}
                </div>
              </div>

              <span style={{ background: sc.bg, color: sc.color, borderRadius: 6, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
                {b.status.replace(/_/g, " ")}
              </span>

              <div style={{ textAlign: "right", minWidth: 100 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>
                  {currSym(b.currency)}{Number(b.totalAmount).toLocaleString("en-IN")}
                </div>
                <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                  {new Date(b.createdAt).toLocaleDateString("en-IN")}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail panel */}
      {selected && (
        <div style={{
          position: "fixed", right: 0, top: 0, bottom: 0, width: 400,
          background: "white", boxShadow: "-4px 0 24px rgba(0,0,0,.1)", padding: 32, overflowY: "auto",
          zIndex: 100,
        }}>
          <button
            onClick={() => setSelected(null)}
            style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", float: "right" }}
          >
            ✕
          </button>
          <h2 style={{ marginBottom: 24, fontSize: 18, fontWeight: 700 }}>Booking Detail</h2>

          <DetailRow label="Booking ID" value={selected.id} mono />
          <DetailRow label="PNR" value={selected.pnr ?? "—"} mono />
          <DetailRow label="Status" value={selected.status.replace(/_/g, " ")} />
          <DetailRow label="Route" value={`${selected.origin} → ${selected.destination}`} />
          <DetailRow label="Supplier" value={selected.supplier} />
          <DetailRow label="Amount" value={`${currSym(selected.currency)}${Number(selected.totalAmount).toLocaleString("en-IN")}`} />

          {(selected.status === "TICKETED" || selected.status === "CONFIRMED") && (
            <a
              href={`/api/eticket/${selected.id}`}
              target="_blank"
              style={{
                display: "block", textAlign: "center", background: "#E31E24", color: "white",
                padding: "12px", borderRadius: 8, textDecoration: "none", fontWeight: 600, marginTop: 24,
              }}
            >
              Download E-Ticket
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, fontFamily: mono ? "monospace" : "inherit" }}>{value}</div>
    </div>
  );
}
