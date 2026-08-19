import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/api"];

export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const path = new URL(request.url).pathname;

  const slug = host.endsWith(".poomas.in") ? host.split(".")[0] : host;

  const res = NextResponse.next();
  res.headers.set("x-tenant-slug", slug);

  // Portal requires authentication for all non-public routes
  if (PUBLIC_PATHS.some((p) => path.startsWith(p))) return res;

  const token = request.cookies.get("poomas_token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
