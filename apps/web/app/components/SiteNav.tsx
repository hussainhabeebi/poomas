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

  return (
    <nav className="site-nav" aria-label="Main navigation">
      <a href="/search?origin=CCJ&destination=DXB&departureDate=2026-08-25&adults=1&cabinClass=ECONOMY&tripType=ONEWAY" className={navClass("flights")} aria-current={active === "flights" ? "page" : undefined}>Flights</a>
      <a href="/hotels" className={navClass("hotels")} aria-current={active === "hotels" ? "page" : undefined}>Hotels</a>
      <a href="/trips" className={navClass("trips")} aria-current={active === "trips" ? "page" : undefined}>My Trips</a>
      <a href="/wallet" className={navClass("wallet")} aria-current={active === "wallet" ? "page" : undefined}>Wallet</a>
      <a href="/account" className="nav-link home-account-link">Sign in / Account</a>
      <a href="/account" className="home-mobile-account-link" aria-label="Sign in / Account">Account</a>
      <details className="home-mobile-menu">
        <summary aria-label="Navigation menu">
          <span className="home-mobile-menu-icon" aria-hidden="true"><i /><i /><i /></span>
          Menu
        </summary>
        <div className="home-mobile-menu-panel">
          <a href="/search?origin=CCJ&destination=DXB&departureDate=2026-08-25&adults=1&cabinClass=ECONOMY&tripType=ONEWAY" className={navClass("flights")} aria-current={active === "flights" ? "page" : undefined}>Flights</a>
          <a href="/hotels" className={navClass("hotels")} aria-current={active === "hotels" ? "page" : undefined}>Hotels</a>
          <a href="/trips" className={navClass("trips")} aria-current={active === "trips" ? "page" : undefined}>My Trips</a>
          <a href="/wallet" className={navClass("wallet")} aria-current={active === "wallet" ? "page" : undefined}>Wallet</a>
          <a href="/account" className="nav-link">Sign in / Account</a>
        </div>
      </details>
    </nav>
  );
}
