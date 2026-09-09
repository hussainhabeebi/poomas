"use client";

import { useEffect, useRef, useState } from "react";

const SLIDES = [
  {
    image: "https://images.unsplash.com/photo-1528690041201-a8217b45b970?auto=format&fit=crop&w=1600&q=72",
    source: "https://unsplash.com/photos/burj-khalifa-dubai-UQ_61DeiHss",
    eyebrow: "India ↔ Gulf specialists",
    title: "Your next journey starts here",
    sub: "Compare live fares, share passenger details securely and complete your booking in minutes.",
    cta: "Search live flights",
  },
  {
    image: "https://images.unsplash.com/photo-1678609040604-18b458a420ff?auto=format&fit=crop&w=1600&q=72",
    source: "https://unsplash.com/photos/the-wing-of-an-airplane-flying-above-the-clouds--01Xl8gIg1E",
    eyebrow: "Smart flight comparison",
    title: "Three better choices. Zero confusion.",
    sub: "See the best overall, lowest fare and fastest journey—with baggage and duration included.",
    cta: "Find my best flight",
  },
  {
    image: "https://images.unsplash.com/photo-1637299401827-a4216dc1561b?auto=format&fit=crop&w=1600&q=72",
    source: "https://unsplash.com/photos/a-view-of-a-city-from-a-distance-Jyl0z4kAutI",
    eyebrow: "Travel beyond borders",
    title: "Gulf, India and the world",
    sub: "Book confidently with secure checkout, WhatsApp updates and human support when you need it.",
    cta: "Explore destinations",
  },
];

export default function HeroBanner({ banners }: { banners: unknown[] }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const touchX = useRef<number | null>(null);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => setIdx((i) => (i + 1) % SLIDES.length), 6000);
    return () => window.clearInterval(timer);
  }, [paused]);

  function move(delta: number) {
    setIdx((i) => (i + delta + SLIDES.length) % SLIDES.length);
  }

  const slide = SLIDES[idx];

  return (
    <section
      className="hero hero-photo"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const distance = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
        if (Math.abs(distance) > 45) move(distance > 0 ? -1 : 1);
        touchX.current = null;
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={slide.image}
        src={slide.image}
        alt=""
        className="hero-photo-img"
        loading={idx === 0 ? "eager" : "lazy"}
        fetchPriority={idx === 0 ? "high" : "auto"}
      />
      <div className="hero-shade" />
      <button className="hero-arrow hero-arrow-left" onClick={() => move(-1)} aria-label="Previous offer">‹</button>
      <div className="hero-inner hero-copy">
        <div className="hero-badge">{slide.eyebrow}</div>
        <h1 className="hero-title">{slide.title}</h1>
        <p className="hero-subtitle">{slide.sub}</p>
        <a className="hero-cta" href="#flight-search">{slide.cta} <span>→</span></a>
        <div className="hero-dots">
          {SLIDES.map((_, i) => (
            <button key={i} className={i === idx ? "hero-dot hero-dot-active" : "hero-dot"}
              onClick={() => setIdx(i)} aria-label={`Show travel offer ${i + 1}`} />
          ))}
        </div>
        <a className="hero-credit" href={slide.source} target="_blank" rel="noreferrer">Photo on Unsplash</a>
      </div>
      <button className="hero-arrow hero-arrow-right" onClick={() => move(1)} aria-label="Next offer">›</button>
    </section>
  );
}
