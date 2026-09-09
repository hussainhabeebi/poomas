import SearchWidget from "./components/SearchWidget";
import HeroBanner from "./components/HeroBanner";
import PopularRoutes from "./components/PopularRoutes";

const benefits = [
  { icon: "⚡", title: "Live fare comparison", text: "Compare bookable fares from connected airline suppliers." },
  { icon: "🧳", title: "Baggage made clear", text: "See duration, stops and baggage before choosing." },
  { icon: "📷", title: "Scan your passport", text: "Gemini can securely prefill passenger details for review." },
  { icon: "💬", title: "WhatsApp updates", text: "Continue your booking and receive ticket updates in chat." },
];

const steps = [
  ["01", "Search", "Tell us your route and travel date."],
  ["02", "Compare", "Choose from the best, cheapest and fastest flights."],
  ["03", "Confirm", "Scan passports or enter passenger details manually."],
  ["04", "Pay & fly", "Pay securely and receive your ticket."],
];

export default function HomePage() {
  return (
    <main>
      <HeroBanner banners={[]} />
      <section id="flight-search" className="home-shell search-overlap">
        <div className="section-kicker">Live flight search</div>
        <SearchWidget />
      </section>

      <section className="home-shell">
        <div className="section-heading-row">
          <div>
            <div className="section-kicker">Popular now</div>
            <h2 className="home-title">Routes travellers are checking</h2>
          </div>
          <a href="#flight-search" className="text-link">Custom search →</a>
        </div>
        <PopularRoutes routes={[]} />
      </section>

      <section className="home-shell benefits-section">
        <div className="section-kicker">Built for easier booking</div>
        <h2 className="home-title">Less form-filling. More confidence.</h2>
        <div className="benefit-grid">
          {benefits.map((item) => (
            <article className="benefit-card" key={item.title}>
              <span className="benefit-icon">{item.icon}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="journey-section">
        <div className="home-shell">
          <div className="section-kicker light">Simple from search to ticket</div>
          <h2 className="home-title light">Your booking, step by step</h2>
          <div className="journey-grid">
            {steps.map(([number, title, text]) => (
              <article className="journey-card" key={number}>
                <span>{number}</span><h3>{title}</h3><p>{text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="home-shell">
        <div className="wa-cta">
          <div>
            <div className="section-kicker light">Need help choosing?</div>
            <h2>Continue with our travel assistant</h2>
            <p>Share your route on WhatsApp and move directly from flight selection to secure checkout.</p>
          </div>
          <a href="https://wa.me/" aria-label="Continue on WhatsApp">Continue on WhatsApp <span>→</span></a>
        </div>
      </section>
    </main>
  );
}
