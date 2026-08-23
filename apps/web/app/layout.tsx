import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

async function getTenantBranding(slug: string) {
  // Fetch tenant config from API (cached at CF edge)
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/tenant/branding`, {
      headers: { "x-tenant-slug": slug },
      cache: "no-store",
    });
    if (res.ok) return res.json() as Promise<{
      name: string; primaryColor: string; secondaryColor: string; accentColor: string;
      logoUrl: string | null; faviconUrl: string | null; fontFamily: string;
      showPoweredBy: boolean; tagline: string | null;
    }>;
  } catch {}
  return null;
}

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const slug        = headersList.get("x-tenant-slug") ?? "poomas";
  const branding    = await getTenantBranding(slug);

  return {
    title:       branding?.name ?? "POOMAS Traveldays",
    description: branding?.tagline ?? "Book flights at best prices",
    icons:       { icon: branding?.faviconUrl ?? "/favicon.ico" },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = await headers();
  const slug     = headersList.get("x-tenant-slug") ?? "poomas";
  const branding = await getTenantBranding(slug);

  const primaryColor   = branding?.primaryColor   ?? "#E31E24";
  const secondaryColor = branding?.secondaryColor ?? "#F7941D";
  const accentColor    = branding?.accentColor    ?? "#F5C518";
  const fontFamily     = branding?.fontFamily     ?? "Inter";

  return (
    <html lang="en">
      <head>
        {/* CSS custom properties injected server-side — no client JS needed for theming */}
        <style>{`
          :root {
            --color-primary:   ${primaryColor};
            --color-secondary: ${secondaryColor};
            --color-accent:    ${accentColor};
            --font-body:       ${fontFamily}, system-ui, sans-serif;
          }
        `}</style>
        <link
          href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@400;500;600;700&display=swap`}
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
        {branding?.showPoweredBy && (
          <div style={{ textAlign: "center", padding: "8px", fontSize: "12px", color: "#666" }}>
            Powered by{" "}
            <a href="https://flypoomas.com" style={{ color: "var(--color-primary)" }}>
              POOMAS Traveldays
            </a>
          </div>
        )}
      </body>
    </html>
  );
}
