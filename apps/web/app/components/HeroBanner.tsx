interface Banner {
  imageUrl:   string;
  title:      string;
  subtitle?:  string;
  linkUrl?:   string;
}

export default function HeroBanner({ banners }: { banners: Banner[] }) {
  const banner = banners[0];

  return (
    <div style={{
      background: `linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%)`,
      minHeight: 280,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "48px 16px 80px",
      textAlign: "center",
    }}>
      {banner ? (
        <div style={{ color: "white" }}>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700 }}>{banner.title}</h1>
          {banner.subtitle && <p style={{ margin: "8px 0 0", fontSize: 18, opacity: 0.9 }}>{banner.subtitle}</p>}
        </div>
      ) : (
        <div style={{ color: "white" }}>
          <h1 style={{ margin: 0, fontSize: 36, fontWeight: 700 }}>Find Your Perfect Flight</h1>
          <p style={{ margin: "8px 0 0", fontSize: 18, opacity: 0.9 }}>Best fares. Instant booking. Trusted service.</p>
        </div>
      )}
    </div>
  );
}
