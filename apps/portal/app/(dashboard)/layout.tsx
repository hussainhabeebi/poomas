const NAV_ITEMS = [
  { href: "/dashboard",  label: "Home",     icon: "🏠" },
  { href: "/search",     label: "Flights",  icon: "✈️" },
  { href: "/bookings",   label: "Bookings", icon: "📋" },
  { href: "/wallet",     label: "Wallet",   icon: "💳" },
  { href: "/sub-agents", label: "Agents",   icon: "👥" },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        .portal-shell   { display: flex; min-height: 100vh; }
        .portal-sidebar {
          width: var(--sidebar-w, 220px);
          background: var(--sidebar-bg, #1a1a2e);
          color: white;
          display: flex;
          flex-direction: column;
          padding: 20px 0;
          flex-shrink: 0;
          position: sticky;
          top: 0;
          height: 100vh;
          overflow-y: auto;
        }
        .portal-sidebar-logo { padding: 0 16px 20px; }
        .portal-sidebar-logo img { height: 30px; width: auto; }
        .sidebar-link {
          padding: 12px 20px;
          color: #9ca3af;
          text-decoration: none;
          font-size: 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          transition: background 0.15s, color 0.15s;
          border-left: 3px solid transparent;
        }
        .sidebar-link:hover { background: rgba(255,255,255,.07); color: white; }
        .sidebar-link-icon  { font-size: 16px; }
        .portal-main {
          flex: 1;
          background: #f9fafb;
          padding: 24px 16px 100px;
          min-width: 0;
        }
        .portal-bottom-nav {
          display: none;
          position: fixed;
          bottom: 0; left: 0; right: 0;
          background: white;
          border-top: 1px solid #e5e7eb;
          z-index: 100;
          padding: 0 env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
        }
        .portal-bottom-nav-inner {
          display: flex;
          align-items: stretch;
        }
        .bottom-nav-link {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 10px 4px;
          text-decoration: none;
          color: #6b7280;
          font-size: 10px;
          font-weight: 500;
          min-height: 56px;
          transition: color 0.15s;
        }
        .bottom-nav-link:active { color: var(--color-primary); }
        .bottom-nav-icon { font-size: 20px; line-height: 1; }
        @media (max-width: 767px) {
          .portal-sidebar     { display: none; }
          .portal-bottom-nav  { display: block; }
          .portal-main        { padding: 16px 16px 80px; }
        }
        @media (min-width: 768px) {
          .portal-main { padding: 28px 28px 40px; }
        }
      `}</style>

      <div className="portal-shell">
        {/* Desktop sidebar */}
        <nav className="portal-sidebar">
          <div className="portal-sidebar-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="POOMAS" />
          </div>
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href} className="sidebar-link">
              <span className="sidebar-link-icon">{item.icon}</span>
              {item.label}
            </a>
          ))}
          <div style={{ marginTop: "auto" }}>
            <a href="/login" className="sidebar-link">
              <span className="sidebar-link-icon">🚪</span>
              Sign Out
            </a>
          </div>
        </nav>

        {/* Main content */}
        <main className="portal-main">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="portal-bottom-nav">
        <div className="portal-bottom-nav-inner">
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href} className="bottom-nav-link">
              <span className="bottom-nav-icon">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </div>
      </nav>
    </>
  );
}
