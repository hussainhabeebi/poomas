export default function DashboardPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Dashboard</h1>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 20 }}>
        <StatCard label="Wallet Balance" value="₹0.00" sub="Available credit: ₹0" color="#E31E24" />
        <StatCard label="Bookings This Month" value="0" sub="₹0 revenue" color="#F7941D" />
        <StatCard label="Commission Earned" value="₹0" sub="This month" color="#F5C518" />
        <StatCard label="Sub-Agents" value="0" sub="Active" color="#10B981" />
      </div>

      <section style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Recent Bookings</h2>
        <div style={{
          background: "white", borderRadius: 10, border: "1px solid #e5e7eb",
          padding: "40px", textAlign: "center", color: "#9ca3af",
        }}>
          No bookings yet. <a href="/search" style={{ color: "#E31E24" }}>Book your first flight →</a>
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{
      background: "white", borderRadius: 10, padding: "20px 24px",
      border: "1px solid #e5e7eb", borderLeft: `4px solid ${color}`,
    }}>
      <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: "#111827" }}>{value}</div>
      <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>{sub}</div>
    </div>
  );
}
