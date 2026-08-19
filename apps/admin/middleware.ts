import { NextResponse, type NextRequest } from "next/server";

// Admin panel is protected by Cloudflare Access (zero-trust) at the infrastructure layer.
// This middleware adds a secondary application-level auth check using the CF-Access-JWT header
// that Access injects into all requests that pass through it.
export function middleware(request: NextRequest) {
  const cfJwt    = request.headers.get("CF-Access-Jwt-Assertion");
  const loginPath = "/login";
  const path      = new URL(request.url).pathname;

  if (path === loginPath) return NextResponse.next();

  // CF Access JWT — injected by Cloudflare Access tunnel. If missing, redirect to CF login.
  // In local dev (no CF Access), fallback to cookie-based auth.
  const isDev = process.env.NODE_ENV === "development";

  if (!isDev && !cfJwt) {
    // CF Access will handle the redirect to its login page automatically.
    // This catches any requests that somehow bypass CF Access.
    return NextResponse.redirect(new URL(loginPath, request.url));
  }

  if (isDev) {
    const token = request.cookies.get("poomas_admin_token")?.value;
    if (!token && path !== loginPath) {
      return NextResponse.redirect(new URL(loginPath, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
