const NAV_ITEMS = [
  { href: "/dashboard",   label: "Dashboard"   },
  { href: "/search",      label: "Book Flights" },
  { href: "/bookings",    label: "My Bookings"  },
  { href: "/wallet",      label: "Wallet"       },
  { href: "/sub-agents",  label: "Sub-Agents"   },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <nav style={{
        width: 220, background: "#1a1a2e", color: "white",
        display: "flex", flexDirection: "column", padding: "24px 0",
        flexShrink: 0,
      }}>
        <div style={{ padding: "0 16px 24px" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="POOMAS Traveldays" height={32} style={{ display: "block" }} />
        </div>
        {NAV_ITEMS.map((item) => (
          <a
            key={item.href}
            href={item.href}
            style={{
              padding: "12px 20px", color: "#d1d5db", textDecoration: "none",
              fontSize: 14, display: "block", transition: "background 0.1s",
            }}
          >
            {item.label}
          </a>
        ))}
        <div style={{ marginTop: "auto" }}>
          <a href="/login" style={{ padding: "12px 20px", color: "#9ca3af", fontSize: 14, display: "block" }}>
            Sign Out
          </a>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ flex: 1, background: "#f9fafb", padding: 32, overflowY: "auto" }}>
        {children}
      </main>
    </div>
  );
}
