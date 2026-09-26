"use client";

import { usePathname } from "next/navigation";

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

  return (
    <nav className="site-nav" aria-label="Main navigation">
      <a href="/" className={navClass("flights")} aria-current={active === "flights" ? "page" : undefined}>Flights</a>
      <a href="/hotels" className={navClass("hotels")} aria-current={active === "hotels" ? "page" : undefined}>Hotels</a>
      <a href="/trips" className={navClass("trips")} aria-current={active === "trips" ? "page" : undefined}>My Trips</a>
      <a href="/wallet" className={navClass("wallet")} aria-current={active === "wallet" ? "page" : undefined}>Wallet</a>
      <a href="/account" className="nav-link home-account-link">{accountIcon}<span>Account</span></a>
      <a href="/account" className="home-mobile-account-link" aria-label="Account">{accountIcon}<span>Account</span></a>
      <details className="home-mobile-menu">
        <summary aria-label="Navigation menu">
          <span className="home-mobile-menu-icon" aria-hidden="true"><i /><i /><i /></span>
          Menu
        </summary>
        <div className="home-mobile-menu-panel">
          <a href="/" className={navClass("flights")} aria-current={active === "flights" ? "page" : undefined}>Flights</a>
          <a href="/hotels" className={navClass("hotels")} aria-current={active === "hotels" ? "page" : undefined}>Hotels</a>
          <a href="/trips" className={navClass("trips")} aria-current={active === "trips" ? "page" : undefined}>My Trips</a>
          <a href="/wallet" className={navClass("wallet")} aria-current={active === "wallet" ? "page" : undefined}>Wallet</a>
          <a href="/account" className="nav-link">Sign in / Account</a>
        </div>
      </details>
    </nav>
  );
}
