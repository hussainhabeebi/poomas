import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const slug = extractTenantSlug(host);

  // Read or generate a stable session ID for SERP trial tracking
  const sid = request.cookies.get("sid")?.value ?? crypto.randomUUID();

  // Forward extra headers into the request so server components can read them
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-tenant-slug", slug);
  requestHeaders.set("x-tenant-host", host);
  requestHeaders.set("x-session-id", sid);

  const res = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Persist session cookie if newly generated
  if (!request.cookies.get("sid")) {
    res.cookies.set("sid", sid, {
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
