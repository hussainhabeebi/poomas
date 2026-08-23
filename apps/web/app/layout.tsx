import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "POOMAS Traveldays",
  description: "Book flights at best prices",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          :root {
            --color-primary:   #E31E24;
            --color-secondary: #F7941D;
            --color-accent:    #F5C518;
            --font-body:       Inter, system-ui, sans-serif;
          }
        `}</style>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body style={{ fontFamily: "var(--font-body)" }}>
        <header style={{
          display: "flex", alignItems: "center",
          padding: "10px 24px",
          background: "white",
          borderBottom: "1px solid #e5e7eb",
          position: "sticky", top: 0, zIndex: 50,
        }}>
          <a href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="POOMAS Traveldays" height={38} style={{ display: "block" }} />
          </a>
        </header>
        {children}
      </body>
    </html>
  );
}
