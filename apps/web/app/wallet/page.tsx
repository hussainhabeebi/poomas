"use client";
import { useEffect, useState, type FormEvent } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.flypoomas.com";

interface Tx { id: string; type: string; amount: string; note: string | null; createdAt: string }
interface Coupon { id: string; code: string; amount: string; status: string; expiresAt: string; redeemedAt: string | null }

const TX_LABEL: Record<string, string> = {
  BOOKING_BONUS: "Booking bonus", ADMIN_CREDIT: "Added by POOMAS", BOOKING_DEBIT: "Paid for booking",
  REFUND_CREDIT: "Refund", COUPON_DEBIT: "Coupon created", COUPON_CREDIT: "Coupon redeemed", COUPON_REFUND: "Coupon returned",
};
const DEBITS = new Set(["BOOKING_DEBIT", "COUPON_DEBIT"]);
const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", REDEEMED: "Used", CANCELLED: "Cancelled", EXPIRED: "Expired · refunded" };
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function readToken() {
  const m = document.cookie.match(/(?:^|;\s*)poomas_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export default function WalletPage() {
  const [token, setToken] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [couponAmount, setCouponAmount] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [busy, setBusy] = useState(false);

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}/api/profile/wallet${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "x-tenant-slug": "poomas", Authorization: `Bearer ${token ?? readToken()}` },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) { setToken(""); throw new Error("Please sign in again."); }
    if (!res.ok) throw new Error((data as any).error ?? `Something went wrong (${res.status})`);
    return data as T;
  }

  async function load() {
    try {
      const [w, cp] = await Promise.all([
        call<{ balance: number; transactions: Tx[] }>(""),
        call<{ coupons: Coupon[] }>("/coupons"),
      ]);
      setBalance(w.balance); setTransactions(w.transactions); setCoupons(cp.coupons);
    } catch (err: any) { setError(err.message); } finally { setLoading(false); }
  }

  useEffect(() => {
    const t = readToken();
    setToken(t);
    if (t) load(); else setLoading(false);
  }, []);

  async function createCoupon(e: FormEvent) {
    e.preventDefault();
    const amount = Number(couponAmount);
    if (!(amount >= 10)) { setError("Minimum coupon amount is ₹10."); return; }
    if (amount > balance) { setError("That's more than your wallet balance."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await call<{ coupon: { code: string } }>("/coupons", { method: "POST", body: JSON.stringify({ amount }) });
      setNotice(`Coupon ${r.coupon.code} created for ${inr(amount)}. Share it — it works once and expires in 30 days.`);
      setCouponAmount("");
      await load();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function cancelCoupon(c: Coupon) {
    if (!confirm(`Cancel coupon ${c.code}? ${inr(Number(c.amount))} goes back to your wallet.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await call(`/coupons/${c.id}/cancel`, { method: "POST" });
      setNotice(`Coupon ${c.code} cancelled; ${inr(Number(c.amount))} returned to your wallet.`);
      await load();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function redeem(e: FormEvent) {
    e.preventDefault();
    if (!redeemCode.trim()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await call<{ amount: number }>("/redeem", { method: "POST", body: JSON.stringify({ code: redeemCode.trim() }) });
      setNotice(`${inr(r.amount)} added to your wallet.`);
      setRedeemCode("");
      await load();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  function share(c: Coupon) {
    const text = `I've sent you ${inr(Number(c.amount))} on FlyPoomas! Redeem code ${c.code} at https://flypoomas.com/wallet before ${new Date(c.expiresAt).toLocaleDateString("en-IN")}.`;
    if (navigator.share) navigator.share({ text }).catch(() => {});
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  }

  if (loading) return <main className="page-container" style={{ padding: "40px 16px" }}>Loading wallet…</main>;

  if (!token) {
    return (
      <main className="page-container" style={{ padding: "40px 16px", maxWidth: 520 }}>
        <section style={card}>
          <h1 style={{ margin: "0 0 8px", fontSize: 22 }}>FlyPoomas Wallet</h1>
          <p style={{ color: "#64748b", margin: "0 0 18px" }}>Sign in to see your balance. Every confirmed booking earns you ₹50, and you can pay for flights with your wallet.</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href="/signup?next=/wallet" style={primaryBtn}>Create account</a>
            <a href="/login?next=/wallet" style={secondaryBtn}>Sign in</a>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page-container" style={{ padding: "24px 16px 48px", maxWidth: 760 }}>
      <section style={{ ...card, background: "linear-gradient(135deg,#E31E24,#9f1239)", color: "#fff", border: 0 }}>
        <p style={{ margin: 0, opacity: .85, fontSize: 13, fontWeight: 600 }}>Wallet balance</p>
        <p style={{ margin: "4px 0 6px", fontSize: 36, fontWeight: 800 }}>{inr(balance)}</p>
        <p style={{ margin: 0, opacity: .85, fontSize: 13 }}>+₹50 for every confirmed booking · usable when it covers the full fare</p>
      </section>

      {error && <div style={{ ...banner, background: "#FEE2E2", color: "#991B1B" }}>{error}</div>}
      {notice && <div style={{ ...banner, background: "#DCFCE7", color: "#166534" }}>{notice}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 14, marginTop: 14 }}>
        <section style={card}>
          <h2 style={h2}>Share balance</h2>
          <p style={muted}>Turn part of your balance into a one-time code for a friend. Unused codes return to you after 30 days.</p>
          <form onSubmit={createCoupon} style={{ display: "flex", gap: 8 }}>
            <input type="number" min="10" step="1" inputMode="numeric" placeholder="₹ amount" value={couponAmount} onChange={(e) => setCouponAmount(e.target.value)} style={input} />
            <button type="submit" disabled={busy || balance < 10} style={{ ...primaryBtn, opacity: busy || balance < 10 ? .6 : 1 }}>Create code</button>
          </form>
        </section>
        <section style={card}>
          <h2 style={h2}>Redeem a code</h2>
          <p style={muted}>Got a FlyPoomas wallet code from someone? Add it here.</p>
          <form onSubmit={redeem} style={{ display: "flex", gap: 8 }}>
            <input placeholder="PM-XXXXX-XXXXX" value={redeemCode} onChange={(e) => setRedeemCode(e.target.value.toUpperCase())} style={{ ...input, textTransform: "uppercase" }} />
            <button type="submit" disabled={busy} style={{ ...primaryBtn, opacity: busy ? .6 : 1 }}>Redeem</button>
          </form>
        </section>
      </div>

      {coupons.length > 0 && (
        <section style={{ ...card, marginTop: 14 }}>
          <h2 style={h2}>Your codes</h2>
          {coupons.map((c) => (
            <div key={c.id} style={rowStyle}>
              <span style={{ minWidth: 0 }}>
                <strong style={{ fontFamily: "monospace", fontSize: 15, letterSpacing: .5 }}>{c.code}</strong>
                <small style={{ display: "block", color: "#64748b" }}>
                  {inr(Number(c.amount))} · {STATUS_LABEL[c.status] ?? c.status}
                  {c.status === "ACTIVE" ? ` · expires ${new Date(c.expiresAt).toLocaleDateString("en-IN")}` : ""}
                </small>
              </span>
              {c.status === "ACTIVE" && (
                <span style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => share(c)} style={smallBtn}>Share</button>
                  <button onClick={() => cancelCoupon(c)} disabled={busy} style={{ ...smallBtn, color: "#991B1B" }}>Cancel</button>
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      <section style={{ ...card, marginTop: 14 }}>
        <h2 style={h2}>History</h2>
        {transactions.length === 0 ? <p style={muted}>No activity yet. Book a flight to earn your first ₹50.</p> : transactions.map((t) => (
          <div key={t.id} style={rowStyle}>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{TX_LABEL[t.type] ?? t.type}</span>
              <small style={{ display: "block", color: "#64748b" }}>{new Date(t.createdAt).toLocaleString("en-IN")}{t.note ? ` · ${t.note}` : ""}</small>
            </span>
            <strong style={{ color: DEBITS.has(t.type) ? "#b91c1c" : "#15803d", whiteSpace: "nowrap" }}>
              {DEBITS.has(t.type) ? "−" : "+"}{inr(Number(t.amount))}
            </strong>
          </div>
        ))}
      </section>
    </main>
  );
}

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 18 };
const h2: React.CSSProperties = { margin: "0 0 6px", fontSize: 16, fontWeight: 800, color: "#0f172a" };
const muted: React.CSSProperties = { margin: "0 0 12px", color: "#64748b", fontSize: 13 };
const banner: React.CSSProperties = { marginTop: 14, padding: "10px 14px", borderRadius: 10, fontSize: 14 };
const input: React.CSSProperties = { flex: 1, minWidth: 0, padding: "11px 12px", border: "1.5px solid #e2e8f0", borderRadius: 10, fontSize: 15, fontFamily: "inherit" };
const primaryBtn: React.CSSProperties = { background: "#E31E24", color: "#fff", border: 0, borderRadius: 10, padding: "11px 16px", fontWeight: 800, fontSize: 14, cursor: "pointer", textDecoration: "none", whiteSpace: "nowrap", fontFamily: "inherit" };
const secondaryBtn: React.CSSProperties = { ...primaryBtn, background: "#fff", color: "#0f172a", border: "1.5px solid #e2e8f0" };
const smallBtn: React.CSSProperties = { background: "#f1f5f9", border: 0, borderRadius: 8, padding: "7px 10px", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" };
const rowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "10px 0", borderTop: "1px solid #f1f5f9" };
