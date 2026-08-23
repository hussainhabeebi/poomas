import { headers } from "next/headers";
import SearchWidget from "./components/SearchWidget";
import HeroBanner from "./components/HeroBanner";
import PopularRoutes from "./components/PopularRoutes";

export default async function HomePage() {
  const headersList = await headers();
  const slug = headersList.get("x-tenant-slug") ?? "poomas";

  // Fetch tenant-specific homepage config (banners, popular routes)
  let homepageConfig = null;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/tenant/homepage`, {
      headers: { "x-tenant-slug": slug },
      next: { revalidate: 300 },
    });
    if (res.ok) homepageConfig = await res.json();
  } catch {}

  return (
    <main>
      <HeroBanner banners={(homepageConfig as any)?.banners ?? []} />
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "0 16px" }}>
        <SearchWidget />
        <PopularRoutes routes={(homepageConfig as any)?.popularRoutes ?? []} />
      </section>
    </main>
  );
}
