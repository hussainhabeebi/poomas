interface Banner { imageUrl: string; title: string; subtitle?: string; linkUrl?: string; }

export default function HeroBanner({ banners }: { banners: Banner[] }) {
  const banner = banners[0];
  return (
    <div className="hero">
      <div>
        <h1 className="hero-title">{banner?.title ?? "Find Your Perfect Flight"}</h1>
        <p className="hero-subtitle">{banner?.subtitle ?? "Best fares. Instant booking. Trusted service."}</p>
      </div>
    </div>
  );
}
