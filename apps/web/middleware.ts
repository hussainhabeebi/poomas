import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const slug = extractTenantSlug(host);

  const res = NextResponse.next();
  res.headers.set("x-tenant-slug", slug);
  res.headers.set("x-tenant-host", host);

  // Set a stable session cookie for SERP trial tracking
  if (!request.cookies.get("sid")) {
    res.cookies.set("sid", crypto.randomUUID(), {
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  }

  return res;
}

function extractTenantSlug(host: string): string {
  if (host.endsWith(".flypoomas.com")) {
    return host.split(".")[0];
  }
  if (host === "flypoomas.com" || host === "www.flypoomas.com") {
    return "poomas";
  }
  return host;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
