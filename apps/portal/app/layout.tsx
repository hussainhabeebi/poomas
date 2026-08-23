import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "POOMAS Agent Portal",
  description: "Manage your bookings, wallet and sub-agents",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "POOMAS Agent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#1a1a2e",
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <style>{`
          *, *::before, *::after { box-sizing: border-box; }
          :root {
            --color-primary: #E31E24;
            --sidebar-bg:    #1a1a2e;
            --sidebar-w:     220px;
          }
          body { margin: 0; font-family: Inter, system-ui, -apple-system, sans-serif; -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent; }
          img  { max-width: 100%; display: block; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
