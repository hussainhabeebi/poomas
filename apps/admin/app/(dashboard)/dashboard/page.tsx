async function getPlatformStats() {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/admin/dashboard`, {
      headers: { Authorization: `Bearer ${process.env.ADMIN_API_TOKEN ?? ""}` },
      cache: "no-store",
    });
    if (res.ok) return res.json() as Promise<{ bookings: number; tenants: number; agents: number }>;
  } catch {}
  return { bookings: 0, tenants: 0, agents: 0 };
}

export default async function AdminDashboard() {
  const stats = await getPlatformStats();

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6, color: "white" }}>
        Platform Overview
      </h1>
      <p style={{ color: "#64748b", marginBottom: 32 }}>
        All tenants · All suppliers · All regions
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 20 }}>
        <AdminStat label="Total Bookings" value={stats.bookings} color="#E31E24" />
        <AdminStat label="Active Tenants" value={stats.tenants}  color="#F7941D" />
        <AdminStat label="Registered Agents" value={stats.agents} color="#F5C518" />
      </div>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ color: "white", fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
          Quick Actions
        </h2>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <ActionButton href="/tenants/new" label="+ New Tenant" />
          <ActionButton href="/suppliers"   label="Manage Suppliers" />
          <ActionButton href="/finance"     label="Finance Reports" />
        </div>
      </section>
    </div>
  );
}

function AdminStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: "#1e293b", borderRadius: 10, padding: "20px 24px",
      border: `1px solid #334155`, borderTop: `3px solid ${color}`,
    }}>
      <div style={{ fontSize: 13, color: "#64748b", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 700, color: "white" }}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function ActionButton({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} style={{
      background: "#E31E24", color: "white", borderRadius: 8,
      padding: "10px 20px", textDecoration: "none", fontWeight: 600, fontSize: 14,
    }}>
      {label}
    </a>
  );
}
