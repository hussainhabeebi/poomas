import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "POOMAS Traveldays",
  description: "Book flights at best prices — India, Gulf & beyond",
  icons: { icon: "/favicon.ico", apple: "/logo.svg" },
  manifest: "/manifest.json",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "POOMAS" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#E31E24",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://images.unsplash.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://images.unsplash.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <header className="site-header">
          <a href="/" className="site-logo-link">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="POOMAS Traveldays" height={34} className="site-logo" />
          </a>
          <nav className="site-nav">
            <a href="/search?origin=CCJ&destination=DXB&departureDate=2026-08-25&adults=1&cabinClass=ECONOMY&tripType=ONEWAY" className="nav-link">Flights</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
