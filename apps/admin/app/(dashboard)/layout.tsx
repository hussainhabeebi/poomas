const NAV_ITEMS = [
  { href: "/dashboard",    label: "Overview",      icon: "📊" },
  { href: "/tenants",      label: "Tenants",       icon: "🏢" },
  { href: "/bookings",     label: "Bookings",      icon: "📋" },
  { href: "/agents",       label: "Agents",        icon: "👥" },
  { href: "/suppliers",    label: "Suppliers",     icon: "🔌" },
  { href: "/finance",      label: "Finance",       icon: "💰" },
  { href: "/integrations", label: "Integrations",  icon: "⚙️" },
];

export default function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        .admin-shell   { display: flex; min-height: 100vh; }
        .admin-sidebar {
          width: 240px;
          background: #1e293b;
          border-right: 1px solid #334155;
          display: flex;
          flex-direction: column;
          padding: 20px 0;
          flex-shrink: 0;
          position: sticky;
          top: 0;
          height: 100vh;
          overflow-y: auto;
        }
        .admin-sidebar-logo { padding: 0 16px 24px; }
        .admin-sidebar-logo img { height: 30px; width: auto; }
        .admin-sidebar-logo .role-badge {
          font-size: 11px;
          color: #64748b;
          margin-top: 6px;
        }
        .admin-nav-section { margin-bottom: 24px; }
        .admin-nav-section-title {
          padding: 4px 20px 8px;
          font-size: 11px;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .admin-nav-link {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 20px;
          color: #cbd5e1;
          text-decoration: none;
          font-size: 14px;
          border-left: 3px solid transparent;
          transition: background 0.15s, color 0.15s;
        }
        .admin-nav-link:hover { background: rgba(255,255,255,.05); color: white; }
        .admin-nav-link-icon { font-size: 16px; }
        .admin-main {
          flex: 1;
          background: #0f172a;
          padding: 32px;
          overflow-y: auto;
          min-width: 0;
        }
        .admin-bottom-nav {
          display: none;
          position: fixed;
          bottom: 0; left: 0; right: 0;
          background: #1e293b;
          border-top: 1px solid #334155;
          z-index: 100;
          padding: 0 env(safe-area-inset-right, 0) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 0);
          overflow-x: auto;
        }
        .admin-bottom-nav-inner {
          display: flex;
          align-items: stretch;
          min-width: max-content;
          width: 100%;
        }
        .admin-bottom-nav-link {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          padding: 10px 8px;
          text-decoration: none;
          color: #94a3b8;
          font-size: 10px;
          font-weight: 500;
          min-height: 56px;
          white-space: nowrap;
          transition: color 0.15s;
        }
        .admin-bottom-nav-link:active { color: #e31e24; }
        .admin-bottom-nav-icon { font-size: 18px; line-height: 1; }
        @media (max-width: 767px) {
          .admin-sidebar    { display: none; }
          .admin-bottom-nav { display: block; }
          .admin-main       { padding: 16px 16px 76px; }
        }
        @media (min-width: 768px) {
          .admin-main { padding: 28px 28px 40px; }
        }
      `}</style>

      <div className="admin-shell">
        {/* Desktop sidebar */}
        <nav className="admin-sidebar">
          <div className="admin-sidebar-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="POOMAS Admin" />
            <div className="role-badge">Super Admin</div>
          </div>

          <div className="admin-nav-section">
            <div className="admin-nav-section-title">Platform</div>
            {NAV_ITEMS.map((item) => (
              <a key={item.href} href={item.href} className="admin-nav-link">
                <span className="admin-nav-link-icon">{item.icon}</span>
                {item.label}
              </a>
            ))}
          </div>

          <div style={{ marginTop: "auto" }}>
            <a href="/login" className="admin-nav-link">
              <span className="admin-nav-link-icon">🚪</span>
              Sign Out
            </a>
          </div>
        </nav>

        {/* Main content */}
        <main className="admin-main">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="admin-bottom-nav">
        <div className="admin-bottom-nav-inner">
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href} className="admin-bottom-nav-link">
              <span className="admin-bottom-nav-icon">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </div>
      </nav>
    </>
  );
}
