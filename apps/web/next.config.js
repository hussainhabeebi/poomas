import { setupDevPlatform } from "@cloudflare/next-on-pages/next-dev";

// CF Pages compatibility for local dev
if (process.env.NODE_ENV === "development") {
  await setupDevPlatform();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Cloudflare Pages runs Next.js at edge — all pages use Edge Runtime
  // Disable image optimization (CF Images handles this separately)
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
