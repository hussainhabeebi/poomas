"use client";

import { useState, useEffect } from "react";

const SLIDES = [
  {
    bg: "linear-gradient(135deg, #E31E24 0%, #F7941D 100%)",
    badge: "✈️ India & Gulf Specialist",
    title: "Find Your Perfect Flight",
    sub:   "Best fares. Instant booking. Trusted service.",
  },
  {
    bg: "linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)",
    badge: "🌟 Best Fare Guarantee",
    title: "Gulf Routes from ₹8,500",
    sub:   "Daily flights to Dubai, Abu Dhabi, Doha & more.",
  },
  {
    bg: "linear-gradient(135deg, #0f3460 0%, #533483 100%)",
    badge: "💼 Corporate & Group Travel",
    title: "Business Class Deals",
    sub:   "Upgrade your journey with exclusive rates.",
  },
];

export default function HeroBanner({ banners }: { banners: unknown[] }) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), 4500);
    return () => clearInterval(t);
  }, []);

  const slide = SLIDES[idx];

  return (
    <div className="hero" style={{ background: slide.bg }}>
      <div className="hero-inner">
        <div className="hero-badge">{slide.badge}</div>
        <h1 className="hero-title">{slide.title}</h1>
        <p  className="hero-subtitle">{slide.sub}</p>
        <div className="hero-dots">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              className={i === idx ? "hero-dot hero-dot-active" : "hero-dot"}
              onClick={() => setIdx(i)}
              aria-label={`Slide ${i + 1}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
