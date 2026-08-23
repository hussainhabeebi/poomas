"use client";
import { useState } from "react";

/* ── Types ──────────────────────────────────────────────────────────────── */
type Env = "UAT" | "PRODUCTION";

interface IntegrationState {
  tripjackApiKey:    string;
  environment:       Env;
  tripsafeEnabled:   boolean;
  cabsEnabled:       boolean;
  saved:             boolean;
  saving:            boolean;
  error:             string;
}

/* ── Endpoint reference tables ──────────────────────────────────────────── */
const TRIPSAFE_APIS = [
  { name: "Search",           path: "/api/v1/tripsafe/search",            desc: "Fetch available TripSafe plans" },
  { name: "Review",           path: "/api/v1/tripsafe/review",            desc: "Coverage details & premium calculation" },
  { name: "Booking",          path: "/api/v1/tripsafe/booking",           desc: "Issue policies instantly" },
  { name: "Booking Details",  path: "/api/v1/tripsafe/booking/details",   desc: "Access issued policy information" },
  { name: "Amendment",        path: "/api/v1/tripsafe/amendment",         desc: "Manage policy modifications" },
  { name: "Cancellation",     path: "/api/v1/tripsafe/cancellation",      desc: "Process policy cancellations" },
  { name: "Embedded",         path: "/api/v1/tripsafe/embedded",          desc: "Issue policy using TripJack Flight ID" },
  { name: "Student",          path: "/api/v1/tripsafe/student",           desc: "Long-duration student travel insurance" },
  { name: "Annual Multi-Trip", path: "/api/v1/tripsafe/amt",             desc: "Unlimited 12-month travel coverage" },
];

const CABS_APIS = [
  { name: "Location Search",     path: "/api/v1/cabs/location/search",    desc: "Smart pickup & drop location search" },
  { name: "Lat/Long",            path: "/api/v1/cabs/location/latlng",    desc: "Geocoding for accurate fare calculation" },
  { name: "Quotes",              path: "/api/v1/cabs/quotes",             desc: "Available cab options and pricing" },
  { name: "Booking",             path: "/api/v1/cabs/booking",            desc: "Confirm cab bookings instantly" },
  { name: "Booking Details",     path: "/api/v1/cabs/booking/details",    desc: "Access booking & live tracking link" },
  { name: "Amendment Charges",   path: "/api/v1/cabs/amendment/charges",  desc: "Retrieve modification charges" },
  { name: "Cancellation",        path: "/api/v1/cabs/cancellation",       desc: "Manage booking cancellations" },
];

const TRIPSAFE_BENEFITS = [
  "Medical expense coverage via Aditya Birla Health Insurance",
  "Adventure sports activity coverage",
  "Passport loss & mugging protection",
  "Complimentary eSIM — valid in 175 countries, 500 MB free in 72 countries per traveller",
  "Complimentary baggage protection via Blue Ribbon Bags (₹330/pax value)",
  "24×7 claims assistance",
  "Trip delay, cancellation & accident coverage",
];

const CABS_FEATURES = [
  "Airport transfers — one-way & round trip",
  "Outstation inter-city transfers",
  "Local travel options",
  "Real-time fare discovery",
  "Live tracking link for every booking",
  "Smart location search with geocoding support",
];

/* ── Main component ─────────────────────────────────────────────────────── */
export default function IntegrationsPage() {
  const [state, setState] = useState<IntegrationState>({
    tripjackApiKey:  "",
    environment:     "UAT",
    tripsafeEnabled: false,
    cabsEnabled:     false,
    saved:           false,
    saving:          false,
    error:           "",
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setState((s) => ({ ...s, saving: true, error: "", saved: false }));

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/integrations/tripjack`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey:          state.tripjackApiKey,
          environment:     state.environment,
          tripsafeEnabled: state.tripsafeEnabled,
          cabsEnabled:     state.cabsEnabled,
        }),
      });
      if (!res.ok) throw new Error("Failed to save — check API connectivity");
      setState((s) => ({ ...s, saved: true }));
    } catch (err: any) {
      setState((s) => ({ ...s, error: err.message ?? "Save failed" }));
    } finally {
      setState((s) => ({ ...s, saving: false }));
    }
  }

  function set<K extends keyof IntegrationState>(key: K, val: IntegrationState[K]) {
    setState((s) => ({ ...s, [key]: val, saved: false }));
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", marginBottom: 8 }}>
        TripJack Integrations
      </h1>
      <p style={{ color: "#64748b", fontSize: 14, marginBottom: 28 }}>
        Configure TripJack ancillary APIs — travel insurance (TripSafe) and ground transfers (Cabs).
        Both services share the same <code style={codeStyle}>apiKey</code> header and environment.
      </p>

      {/* ── Global config card ──────────────────────────────────────────── */}
      <form onSubmit={handleSave}>
        <section style={card}>
          <SectionTitle>API Credentials</SectionTitle>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
            <div>
              <Label>TripJack API Key</Label>
              <input
                type="password"
                placeholder="Enter your TripJack API key"
                value={state.tripjackApiKey}
                onChange={(e) => set("tripjackApiKey", e.target.value)}
                style={inputStyle}
              />
              <p style={hint}>Used as the <code style={codeStyle}>apiKey</code> header for all TripJack requests.</p>
            </div>
            <div>
              <Label>Environment</Label>
              <select
                value={state.environment}
                onChange={(e) => set("environment", e.target.value as Env)}
                style={inputStyle}
              >
                <option value="UAT">UAT (Sandbox)</option>
                <option value="PRODUCTION">Production</option>
              </select>
              <p style={hint}>Switch to Production only after UAT certification is complete.</p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 24, marginTop: 20 }}>
            <Toggle
              label="Enable TripSafe"
              description="Travel insurance added to flight bookings"
              checked={state.tripsafeEnabled}
              onChange={(v) => set("tripsafeEnabled", v)}
              color="#6366f1"
            />
            <Toggle
              label="Enable Cabs"
              description="Ground transfers linked to itineraries"
              checked={state.cabsEnabled}
              onChange={(v) => set("cabsEnabled", v)}
              color="#0ea5e9"
            />
          </div>

          {state.error && (
            <div style={{ background: "#450a0a", color: "#fca5a5", padding: "10px 14px", borderRadius: 6, marginTop: 16, fontSize: 13 }}>
              {state.error}
            </div>
          )}

          <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <button
              type="submit"
              disabled={state.saving}
              style={{
                background: "#E31E24", color: "white", border: "none",
                borderRadius: 8, padding: "10px 24px", fontWeight: 700,
                fontSize: 14, cursor: "pointer", opacity: state.saving ? 0.7 : 1,
              }}
            >
              {state.saving ? "Saving…" : "Save Configuration"}
            </button>
            {state.saved && (
              <span style={{ color: "#4ade80", fontSize: 13, fontWeight: 500 }}>✓ Saved</span>
            )}
          </div>
        </section>

        {/* ── Cloudflare secrets note ──────────────────────────────────── */}
        <section style={{ ...card, borderColor: "#854d0e", background: "#1c1100", marginTop: 16 }}>
          <SectionTitle>Cloudflare Worker Secrets</SectionTitle>
          <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
            For production, set these secrets directly on the <strong style={{ color: "#fbbf24" }}>poomas-api</strong> Worker in
            the Cloudflare dashboard (Settings → Variables and Secrets):
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
            {[
              ["TRIPJACK_API_KEY", "Your TripJack API key"],
              ["TRIPJACK_ENV", "UAT or PRODUCTION"],
              ["TRIPSAFE_ENABLED", "true or false"],
              ["CABS_ENABLED", "true or false"],
            ].map(([key, desc]) => (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <code style={{ ...codeStyle, minWidth: 200 }}>{key}</code>
                <span style={{ color: "#64748b", fontSize: 13 }}>{desc}</span>
              </div>
            ))}
          </div>
        </section>
      </form>

      {/* ── TripSafe card ───────────────────────────────────────────────── */}
      <section style={{ ...card, marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#6366f1" }} />
          <SectionTitle>TripSafe — Travel Insurance</SectionTitle>
          <span style={{
            marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "3px 10px",
            borderRadius: 20, background: "#1e1b4b", color: "#a5b4fc", letterSpacing: ".04em",
          }}>
            Aditya Birla Health Insurance
          </span>
        </div>
        <p style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>
          30+ insurance and assistance benefits for every traveller. Adds a policy-issue step to the post-booking confirmation flow.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <SubTitle>Coverage Highlights</SubTitle>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {TRIPSAFE_BENEFITS.map((b) => (
                <li key={b} style={{ display: "flex", gap: 8, fontSize: 13, color: "#94a3b8" }}>
                  <span style={{ color: "#6366f1", flexShrink: 0 }}>✓</span> {b}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <SubTitle>Available Endpoints</SubTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {TRIPSAFE_APIS.map((a) => (
                <div key={a.name} style={{ background: "#0f172a", borderRadius: 6, padding: "8px 12px" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#e2e8f0" }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{a.desc}</div>
                  <code style={{ fontSize: 11, color: "#818cf8", marginTop: 2, display: "block" }}>{a.path}</code>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: "10px 14px", background: "#0f172a", borderRadius: 8, fontSize: 13, color: "#64748b" }}>
          <strong style={{ color: "#e2e8f0" }}>Base URLs — </strong>
          UAT: <code style={codeStyle}>https://uat.tripjack.com</code>
          &nbsp;·&nbsp;
          Production: <code style={codeStyle}>https://api.tripjack.com</code>
        </div>
      </section>

      {/* ── Cabs card ───────────────────────────────────────────────────── */}
      <section style={{ ...card, marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 4 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#0ea5e9" }} />
          <SectionTitle>Cabs — Ground Transfers</SectionTitle>
          <span style={{
            marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "3px 10px",
            borderRadius: 20, background: "#082f49", color: "#38bdf8", letterSpacing: ".04em",
          }}>
            Airport · Outstation · Local
          </span>
        </div>
        <p style={{ color: "#64748b", fontSize: 13, marginBottom: 16 }}>
          Real-time ground transport linked to your flight itinerary. Includes live tracking for every confirmed booking.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <SubTitle>Key Features</SubTitle>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {CABS_FEATURES.map((f) => (
                <li key={f} style={{ display: "flex", gap: 8, fontSize: 13, color: "#94a3b8" }}>
                  <span style={{ color: "#0ea5e9", flexShrink: 0 }}>✓</span> {f}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <SubTitle>Available Endpoints</SubTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {CABS_APIS.map((a) => (
                <div key={a.name} style={{ background: "#0f172a", borderRadius: 6, padding: "8px 12px" }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#e2e8f0" }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{a.desc}</div>
                  <code style={{ fontSize: 11, color: "#38bdf8", marginTop: 2, display: "block" }}>{a.path}</code>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16, padding: "10px 14px", background: "#0f172a", borderRadius: 8, fontSize: 13, color: "#64748b" }}>
          <strong style={{ color: "#e2e8f0" }}>Base URLs — </strong>
          UAT: <code style={codeStyle}>https://uat.tripjack.com</code>
          &nbsp;·&nbsp;
          Production: <code style={codeStyle}>https://api.tripjack.com</code>
        </div>
      </section>

      {/* ── Certification note ──────────────────────────────────────────── */}
      <section style={{ ...card, marginTop: 16, borderColor: "#166534", background: "#052e16" }}>
        <SectionTitle>Go-Live Process</SectionTitle>
        <p style={{ color: "#94a3b8", fontSize: 13, marginTop: 8, lineHeight: 1.6 }}>
          TripJack requires a structured UAT certification before switching to Production. Once integration
          is complete, contact TripJack onboarding to schedule the certification walkthrough.
          Environment switch from UAT → Production is controlled by the setting above.
        </p>
      </section>
    </div>
  );
}

/* ── Small shared components ────────────────────────────────────────────── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>{children}</h2>;
}
function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", textTransform: "uppercase",
      letterSpacing: ".05em", marginBottom: 10 }}>
      {children}
    </div>
  );
}
function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", marginBottom: 6 }}>{children}</div>;
}
function Toggle({ label, description, checked, onChange, color }: {
  label: string; description: string; checked: boolean;
  onChange: (v: boolean) => void; color: string;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      style={{
        flex: 1, background: checked ? `${color}22` : "#0f172a",
        border: `1px solid ${checked ? color : "#334155"}`,
        borderRadius: 10, padding: "14px 16px", cursor: "pointer",
        transition: "all .15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 600, color: checked ? "#f1f5f9" : "#94a3b8", fontSize: 14 }}>{label}</div>
        <div style={{
          width: 36, height: 20, borderRadius: 10, background: checked ? color : "#334155",
          position: "relative", transition: "background .15s",
        }}>
          <div style={{
            position: "absolute", top: 2, left: checked ? 18 : 2,
            width: 16, height: 16, borderRadius: "50%", background: "white",
            transition: "left .15s",
          }} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{description}</div>
    </div>
  );
}

/* ── Shared styles ──────────────────────────────────────────────────────── */
const card: React.CSSProperties = {
  background: "#1e293b", borderRadius: 12, padding: 24,
  border: "1px solid #334155",
};
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "10px 14px", background: "#0f172a",
  border: "1.5px solid #334155", borderRadius: 8,
  color: "#e2e8f0", fontSize: 14,
};
const hint: React.CSSProperties = { fontSize: 12, color: "#64748b", margin: "6px 0 0" };
const codeStyle: React.CSSProperties = {
  background: "#0f172a", padding: "1px 6px", borderRadius: 4,
  fontFamily: "monospace", fontSize: 12, color: "#94a3b8",
};
