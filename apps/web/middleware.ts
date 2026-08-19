import { NextResponse, type NextRequest } from "next/server";

// Tenant resolution at the edge — injects tenant slug into request headers
// so server components can read it without re-deriving from hostname each time
export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const slug = extractTenantSlug(host);

  const res = NextResponse.next();
  res.headers.set("x-tenant-slug", slug);
  res.headers.set("x-tenant-host", host);

  return res;
}

function extractTenantSlug(host: string): string {
  if (host.endsWith(".poomas.in")) {
    return host.split(".")[0];
  }
  if (host === "poomas.in" || host === "www.poomas.in") {
    return "poomas";
  }
  // Custom domain — return the full host; API will resolve via DB
  return host;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
