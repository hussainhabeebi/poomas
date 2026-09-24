const HERO_IMAGE = "https://images.unsplash.com/photo-1528690041201-a8217b45b970?auto=format&fit=crop&w=1600&q=72";

export default function HeroBanner() {
  return (
    <section className="hero hero-photo" aria-labelledby="home-hero-title">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={HERO_IMAGE}
        alt=""
        className="hero-photo-img"
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
      <div className="hero-shade" />
      <div className="hero-inner hero-copy">
        <div className="hero-badge">India ↔ Gulf and beyond</div>
        <h1 id="home-hero-title" className="hero-title">Find the right flight, faster.</h1>
        <p className="hero-subtitle">Compare fares, baggage and journey times in one search.</p>
        <a className="hero-cta" href="#flight-search">Search flights <span aria-hidden="true">→</span></a>
      </div>
    </section>
  );
}
