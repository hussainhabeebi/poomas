import SearchWidget from "./components/SearchWidget";
import HeroBanner from "./components/HeroBanner";
import PopularRoutes from "./components/PopularRoutes";

export default function HomePage() {
  return (
    <main>
      <HeroBanner banners={[]} />
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px" }}>
        <SearchWidget />
        <PopularRoutes routes={[]} />
      </section>
    </main>
  );
}
