"use client";
export const runtime = "edge";

import { useState, useEffect } from "react";

interface WalletData {
  balance:     string;
  creditLimit: string;
  currency:    string;
}

interface WalletTx {
  id:            string;
  type:          string;
  amount:        string;
  balanceBefore: string;
  balanceAfter:  string;
  bookingId:     string | null;
  note:          string | null;
  createdAt:     string;
}

const TX_COLORS: Record<string, string> = {
  TOPUP:             "#16a34a",
  BOOKING_DEBIT:     "#dc2626",
  REFUND_CREDIT:     "#2563eb",
  COMMISSION_CREDIT: "#7c3aed",
  ADJUSTMENT:        "#d97706",
  SUBSCRIPTION_DEBIT: "#dc2626",
};

export default function WalletPage() {
  const [wallet, setWallet]   = useState<WalletData | null>(null);
  const [txns, setTxns]       = useState<WalletTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [topupAmt, setTopupAmt] = useState("");
  const [topupLoading, setTopupLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/wallet").then((r) => r.json()),
      fetch("/api/wallet/transactions").then((r) => r.json()),
    ]).then(([w, t]: [{ wallet: WalletData }, { transactions: WalletTx[] }]) => {
      setWallet(w.wallet);
      setTxns(t.transactions ?? []);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function handleTopup(e: React.FormEvent) {
    e.preventDefault();
    setTopupLoading(true);
    try {
      const res = await fetch("/api/wallet/topup", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ amount: Number(topupAmt) }),
      });
      const data = await res.json() as { checkoutUrl?: string; orderId?: string };
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    } finally {
      setTopupLoading(false);
    }
  }

  const currSym = (c: string) =>
    c === "INR" ? "₹" : c === "AED" ? "د.إ" : "$";

  if (loading) return <p style={{ color: "#6b7280" }}>Loading…</p>;

  const sym = currSym(wallet?.currency ?? "INR");

  return (
    <div>
      <h1 style={{ marginBottom: 24, fontSize: 22, fontWeight: 700 }}>Wallet</h1>

      {/* Balance cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16, marginBottom: 32 }}>
        <StatCard label="Current Balance"  value={`${sym}${Number(wallet?.balance ?? 0).toLocaleString("en-IN")}`}  accent="#16a34a" />
        <StatCard label="Credit Limit"     value={`${sym}${Number(wallet?.creditLimit ?? 0).toLocaleString("en-IN")}`} accent="#2563eb" />
        <StatCard label="Available"        value={`${sym}${(Number(wallet?.balance ?? 0) + Number(wallet?.creditLimit ?? 0)).toLocaleString("en-IN")}`} accent="#7c3aed" />
      </div>

      {/* Top-up form */}
      <div style={{ background: "white", borderRadius: 12, padding: 24, marginBottom: 32, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
        <h2 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700 }}>Add Funds</h2>
        <form onSubmit={handleTopup} style={{ display: "flex", gap: 12 }}>
          <div style={{ display: "flex", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", flex: 1, maxWidth: 300 }}>
            <span style={{ padding: "10px 14px", background: "#f9fafb", borderRight: "1px solid #e5e7eb", color: "#6b7280", fontWeight: 700 }}>
              {sym}
            </span>
            <input
              type="number" min={100} required
              placeholder="Enter amount"
              value={topupAmt}
              onChange={(e) => setTopupAmt(e.target.value)}
              style={{ flex: 1, border: "none", padding: "10px 14px", fontSize: 14, outline: "none" }}
            />
          </div>
          <button
            type="submit" disabled={topupLoading}
            style={{ background: "#E31E24", color: "white", border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 600, cursor: "pointer" }}
          >
            {topupLoading ? "Processing…" : "Add Funds"}
          </button>
        </form>
      </div>

      {/* Transaction history */}
      <div style={{ background: "white", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
        <h2 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700 }}>Transaction History</h2>

        {txns.length === 0 && <p style={{ color: "#6b7280" }}>No transactions yet.</p>}

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #f3f4f6" }}>
              {["Date", "Type", "Amount", "Balance After", "Note"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 11, textTransform: "uppercase", color: "#9ca3af" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txns.map((tx) => (
              <tr key={tx.id} style={{ borderBottom: "1px solid #f9fafb" }}>
                <td style={tdStyle}>{new Date(tx.createdAt).toLocaleDateString("en-IN")}</td>
                <td style={tdStyle}>
                  <span style={{ color: TX_COLORS[tx.type] ?? "#374151", fontWeight: 600, fontSize: 12 }}>
                    {tx.type.replace(/_/g, " ")}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: tx.type.includes("DEBIT") ? "#dc2626" : "#16a34a", fontWeight: 700 }}>
                  {tx.type.includes("DEBIT") ? "−" : "+"}{sym}{Number(tx.amount).toLocaleString("en-IN")}
                </td>
                <td style={tdStyle}>{sym}{Number(tx.balanceAfter).toLocaleString("en-IN")}</td>
                <td style={{ ...tdStyle, color: "#6b7280" }}>{tx.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: "white", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,.08)", borderLeft: `4px solid ${accent}` }}>
      <div style={{ fontSize: 12, color: "#9ca3af", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#111827" }}>{value}</div>
    </div>
  );
}

const tdStyle: React.CSSProperties = { padding: "12px 12px", fontSize: 13, color: "#374151" };
