"use client";
import { Fragment, useState, useEffect } from "react";

interface SubAgent {
  id:           string;
  businessName: string;
  contactEmail: string;
  contactPhone: string;
  status:       string;
  createdAt:    string;
  walletBalance?:  number;
  walletCurrency?: string | null;
  markup?:         { type: "FLAT" | "PERCENTAGE"; value: number } | null;
}

type Panel = { id: string; kind: "markup" | "funds" } | null;

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  PENDING:   { bg: "#fffbeb", color: "#92400e" },
  APPROVED:  { bg: "#ecfdf5", color: "#065f46" },
  SUSPENDED: { bg: "#fef2f2", color: "#b91c1c" },
  REJECTED:  { bg: "#f3f4f6", color: "#6b7280" },
};

export default function SubAgentsPage() {
  const [agents, setAgents]     = useState<SubAgent[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm]         = useState({ businessName: "", contactEmail: "", contactPhone: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");
  const [panel, setPanel]           = useState<Panel>(null);
  const [markupForm, setMarkupForm] = useState({ type: "FLAT" as "FLAT" | "PERCENTAGE", value: "" });
  const [fundsForm, setFundsForm]   = useState({ direction: "TO_SUB" as "TO_SUB" | "TO_PARENT", amount: "" });
  const [rowBusy, setRowBusy]       = useState(false);
  const [rowMsg, setRowMsg]         = useState("");

  function reload() {
    return fetch("/api/agents/sub-agents")
      .then((r) => r.json())
      .then((data: { agents: SubAgent[] }) => setAgents(data.agents ?? []))
      .catch(console.error);
  }

  useEffect(() => {
    reload().finally(() => setLoading(false));
  }, []);

  async function rowAction(path: string, method: string, body: unknown, ok: string) {
    setRowBusy(true); setRowMsg("");
    try {
      const res = await fetch(`/api/agents/sub-agents/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({})) as { error?: string; message?: string };
      if (!res.ok) throw new Error(data.error ?? data.message ?? `Failed (${res.status})`);
      setRowMsg(ok); setPanel(null);
      await reload();
    } catch (err) {
      setRowMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setRowBusy(false);
    }
  }

  const fmt = (n: number, cur?: string | null) => {
    try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: cur ?? "INR", maximumFractionDigits: 2 }).format(n); } catch { return `${cur ?? ""} ${n}`; }
  };

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/agents/sub-agents/invite", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(form),
      });
      if (!res.ok) throw new Error(await res.text());
      const agent = await res.json() as SubAgent;
      setAgents((a) => [agent, ...a]);
      setShowForm(false);
      setForm({ businessName: "", contactEmail: "", contactPhone: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to invite");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Sub-Agents</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{ background: "#E31E24", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}
        >
          + Invite Sub-Agent
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleInvite} style={{
          background: "white", borderRadius: 12, padding: 24, marginBottom: 24,
          boxShadow: "0 1px 4px rgba(0,0,0,.08)",
        }}>
          <h2 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700 }}>Invite Sub-Agent</h2>
          {error && <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8, padding: 12, marginBottom: 16, color: "#b91c1c", fontSize: 13 }}>{error}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, marginBottom: 16 }}>
            {[
              { label: "Business Name", key: "businessName", type: "text" },
              { label: "Email",         key: "contactEmail", type: "email" },
              { label: "Phone",         key: "contactPhone", type: "tel" },
            ].map(({ label, key, type }) => (
              <div key={key}>
                <label style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, display: "block", marginBottom: 6 }}>{label}</label>
                <input
                  required type={type}
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  style={{ width: "100%", border: "1px solid #e5e7eb", borderRadius: 8, padding: "10px 12px", fontSize: 14, boxSizing: "border-box" }}
                />
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12 }}>
            <button type="submit" disabled={submitting} style={{ background: "#E31E24", color: "white", border: "none", borderRadius: 8, padding: "10px 24px", fontWeight: 600, cursor: "pointer" }}>
              {submitting ? "Sending…" : "Send Invitation"}
            </button>
            <button type="button" onClick={() => setShowForm(false)} style={{ background: "#f3f4f6", color: "#374151", border: "none", borderRadius: 8, padding: "10px 20px", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {rowMsg && <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: 10, marginBottom: 16, color: "#075985", fontSize: 13 }}>{rowMsg}</div>}
      {loading && <p style={{ color: "#6b7280" }}>Loading…</p>}

      {!loading && agents.length === 0 && (
        <div style={{ textAlign: "center", padding: "48px 0", color: "#6b7280", background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,.08)" }}>
          <p>No sub-agents yet. Invite one to expand your network.</p>
        </div>
      )}

      {agents.length > 0 && (
        <div style={{ background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,.08)", overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                {["Business Name", "Email", "Phone", "Status", "Wallet", "Markup", "Joined", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "12px 16px", fontSize: 11, textTransform: "uppercase", color: "#9ca3af", fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const sc = STATUS_COLORS[a.status] ?? { bg: "#f3f4f6", color: "#374151" };
                const open = panel?.id === a.id ? panel.kind : null;
                return (
                  <Fragment key={a.id}>
                  <tr style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "14px 16px", fontWeight: 600 }}>{a.businessName}</td>
                    <td style={{ padding: "14px 16px", color: "#374151", fontSize: 13 }}>{a.contactEmail}</td>
                    <td style={{ padding: "14px 16px", color: "#374151", fontSize: 13 }}>{a.contactPhone}</td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{ background: sc.bg, color: sc.color, borderRadius: 6, padding: "3px 8px", fontSize: 12, fontWeight: 700 }}>
                        {a.status}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", fontSize: 13, fontWeight: 600 }}>{fmt(a.walletBalance ?? 0, a.walletCurrency)}</td>
                    <td style={{ padding: "14px 16px", fontSize: 13 }}>
                      {a.markup ? (a.markup.type === "PERCENTAGE" ? `${a.markup.value}%` : fmt(a.markup.value, a.walletCurrency)) : <span style={{ color: "#9ca3af" }}>None</span>}
                    </td>
                    <td style={{ padding: "14px 16px", color: "#6b7280", fontSize: 13 }}>
                      {new Date(a.createdAt).toLocaleDateString("en-IN")}
                    </td>
                    <td style={{ padding: "14px 16px", whiteSpace: "nowrap" }}>
                      <button style={smallBtn} onClick={() => { setRowMsg(""); setMarkupForm({ type: a.markup?.type ?? "FLAT", value: a.markup ? String(a.markup.value) : "" }); setPanel(open === "markup" ? null : { id: a.id, kind: "markup" }); }}>Markup</button>
                      <button style={smallBtn} onClick={() => { setRowMsg(""); setFundsForm({ direction: "TO_SUB", amount: "" }); setPanel(open === "funds" ? null : { id: a.id, kind: "funds" }); }}>Funds</button>
                      {(a.status === "APPROVED" || a.status === "SUSPENDED") && (
                        <button style={smallBtn} disabled={rowBusy} onClick={() => rowAction(`${a.id}/status`, "PATCH", { status: a.status === "APPROVED" ? "SUSPENDED" : "APPROVED" }, a.status === "APPROVED" ? "Sub-agent suspended" : "Sub-agent resumed")}>
                          {a.status === "APPROVED" ? "Suspend" : "Resume"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr style={{ background: "#f9fafb" }}>
                      <td colSpan={8} style={{ padding: "14px 16px" }}>
                        {open === "markup" ? (
                          <form onSubmit={(e) => { e.preventDefault(); void rowAction(`${a.id}/markup`, "PUT", { type: markupForm.type, value: Number(markupForm.value || 0) }, "Markup saved"); }}
                            style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, color: "#374151" }}>Selling markup added to {a.businessName}&apos;s fares:</span>
                            <select value={markupForm.type} onChange={(e) => setMarkupForm((f) => ({ ...f, type: e.target.value as "FLAT" | "PERCENTAGE" }))} style={field}>
                              <option value="FLAT">Flat amount per booking</option>
                              <option value="PERCENTAGE">Percentage of fare</option>
                            </select>
                            <input type="number" min={0} step="0.01" placeholder={markupForm.type === "PERCENTAGE" ? "e.g. 3" : "e.g. 250"} value={markupForm.value} onChange={(e) => setMarkupForm((f) => ({ ...f, value: e.target.value }))} style={{ ...field, width: 120 }} />
                            <button type="submit" disabled={rowBusy} style={primaryBtn}>Save</button>
                            <small style={{ color: "#6b7280" }}>0 removes the markup.</small>
                          </form>
                        ) : (
                          <form onSubmit={(e) => { e.preventDefault(); void rowAction(`${a.id}/transfer`, "POST", { direction: fundsForm.direction, amount: Number(fundsForm.amount) }, fundsForm.direction === "TO_SUB" ? "Funds sent" : "Funds pulled back"); }}
                            style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                            <select value={fundsForm.direction} onChange={(e) => setFundsForm((f) => ({ ...f, direction: e.target.value as "TO_SUB" | "TO_PARENT" }))} style={field}>
                              <option value="TO_SUB">Send from my wallet to {a.businessName}</option>
                              <option value="TO_PARENT">Pull back from {a.businessName} to my wallet</option>
                            </select>
                            <input type="number" min={1} step="0.01" required placeholder="Amount" value={fundsForm.amount} onChange={(e) => setFundsForm((f) => ({ ...f, amount: e.target.value }))} style={{ ...field, width: 140 }} />
                            <button type="submit" disabled={rowBusy || !(Number(fundsForm.amount) > 0)} style={primaryBtn}>Transfer</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const smallBtn: React.CSSProperties = { background: "#f3f4f6", color: "#111827", border: "none", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", marginRight: 6 };
const field: React.CSSProperties = { border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 10px", fontSize: 13 };
const primaryBtn: React.CSSProperties = { background: "#E31E24", color: "white", border: "none", borderRadius: 8, padding: "8px 16px", fontWeight: 600, cursor: "pointer" };
