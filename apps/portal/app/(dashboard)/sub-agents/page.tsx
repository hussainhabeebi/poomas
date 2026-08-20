"use client";
export const runtime = "edge";

import { useState, useEffect } from "react";

interface SubAgent {
  id:           string;
  businessName: string;
  contactEmail: string;
  contactPhone: string;
  status:       string;
  createdAt:    string;
}

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

  useEffect(() => {
    fetch("/api/agents/sub-agents")
      .then((r) => r.json())
      .then((data: { agents: SubAgent[] }) => setAgents(data.agents ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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
                {["Business Name", "Email", "Phone", "Status", "Joined"].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "12px 16px", fontSize: 11, textTransform: "uppercase", color: "#9ca3af", fontWeight: 700 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const sc = STATUS_COLORS[a.status] ?? { bg: "#f3f4f6", color: "#374151" };
                return (
                  <tr key={a.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "14px 16px", fontWeight: 600 }}>{a.businessName}</td>
                    <td style={{ padding: "14px 16px", color: "#374151", fontSize: 13 }}>{a.contactEmail}</td>
                    <td style={{ padding: "14px 16px", color: "#374151", fontSize: 13 }}>{a.contactPhone}</td>
                    <td style={{ padding: "14px 16px" }}>
                      <span style={{ background: sc.bg, color: sc.color, borderRadius: 6, padding: "3px 8px", fontSize: 12, fontWeight: 700 }}>
                        {a.status}
                      </span>
                    </td>
                    <td style={{ padding: "14px 16px", color: "#6b7280", fontSize: 13 }}>
                      {new Date(a.createdAt).toLocaleDateString("en-IN")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
