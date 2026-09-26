"use client";

import { usePathname } from "next/navigation";

function flightSearchUrl() {
  // Match the existing popular-route search date rule without a dated link that expires.
  const date = new Date();
  date.setDate(date.getDate() + 14);
  const departureDate = date.toISOString().split("T")[0];
  return `/search?${new URLSearchParams({
    origin: "CCJ", destination: "DXB", departureDate,
    adults: "1", cabinClass: "ECONOMY", tripType: "ONEWAY",
  }).toString()}`;
}

export default function SiteNav() {
  const pathname = usePathname();
  const active = pathname === "/search" || pathname.startsWith("/search/") || pathname === "/book" || pathname.startsWith("/book/") || pathname === "/checkout" || pathname.startsWith("/checkout/")
    ? "flights"
    : pathname === "/hotels" || pathname.startsWith("/hotels/")
      ? "hotels"
      : pathname === "/trips" || pathname.startsWith("/trips/")
        ? "trips"
        : pathname === "/wallet" || pathname.startsWith("/wallet/")
          ? "wallet"
          : null;

  function navClass(item: string) {
    return active === item ? "nav-link nav-link-active" : "nav-link";
  }

  const accountIcon = (
    <svg className="site-account-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </svg>
  );

  const navItems = [
    { key: "flights", label: "Flights", href: flightSearchUrl(), icon: <><path d="m3 21 8-8-6-2-2 2-2-1 3-4 9 1 6-6a2 2 0 0 1 3 3l-6 6 1 9-4 3-1-2 2-2-2-6-8 8Z" /></> },
    { key: "hotels", label: "Hotels", href: "/hotels", icon: <><path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16M2 21h20M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1" /></> },
    { key: "trips", label: "My Trips", href: "/trips", icon: <><rect x="3" y="7" width="18" height="14" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18m-10 0v2h2v-2" /></> },
    { key: "wallet", label: "Wallet", href: "/wallet", icon: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 9h18m-5 6h2" /></> },
  ];

  function navigationItems() {
    return navItems.map(({ key, label, href, icon }) => (
      <a key={key} href={href} onClick={key === "flights" ? (event) => { event.currentTarget.href = flightSearchUrl(); } : undefined} className={navClass(key)} aria-current={active === key ? "page" : undefined}>
        <svg className="site-nav-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
        <span>{label}</span>
      </a>
    ));
  }

  return (
    <nav className="site-nav" aria-label="Main navigation">
      <div className="site-nav-links">{navigationItems()}</div>
      <a href="/account" className="nav-link home-account-link"><span className="site-account-icon-wrap">{accountIcon}</span><span>Account</span></a>
      <details className="home-mobile-menu">
        <summary aria-label="Navigation menu">
          <span className="home-mobile-menu-icon" aria-hidden="true"><i /><i /><i /></span>
          Menu
        </summary>
        <div className="home-mobile-menu-panel">
          {navigationItems()}
          <a href="/account" className="nav-link home-menu-account-link"><span className="site-account-icon-wrap">{accountIcon}</span><span>Account</span></a>
        </div>
      </details>
    </nav>
  );
}
