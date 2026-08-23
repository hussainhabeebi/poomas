const NAV_SECTIONS = [
  {
    title: "Platform",
    items: [
      { href: "/dashboard",  label: "Overview"   },
      { href: "/tenants",    label: "Tenants"    },
      { href: "/bookings",   label: "Bookings"   },
      { href: "/agents",     label: "Agents"     },
      { href: "/suppliers",  label: "Suppliers"  },
      { href: "/finance",    label: "Finance"    },
    ],
  },
];

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <nav style={{
        width: 240, background: "#1e293b", borderRight: "1px solid #334155",
        display: "flex", flexDirection: "column", padding: "20px 0",
      }}>
        <div style={{ padding: "0 16px 24px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="POOMAS Traveldays" height={30} style={{ display: "block" }} />
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>Super Admin</div>
        </div>

        {NAV_SECTIONS.map((section) => (
          <div key={section.title} style={{ marginBottom: 24 }}>
            <div style={{
              padding: "4px 20px 8px", fontSize: 11, fontWeight: 600,
              color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em",
            }}>
              {section.title}
            </div>
            {section.items.map((item) => (
              <a
                key={item.href}
                href={item.href}
                style={{
                  display: "block", padding: "9px 20px",
                  color: "#cbd5e1", textDecoration: "none", fontSize: 14,
                  borderLeft: "3px solid transparent",
                }}
              >
                {item.label}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <main style={{ flex: 1, background: "#0f172a", padding: 32, overflowY: "auto" }}>
        {children}
      </main>
    </div>
  );
}
