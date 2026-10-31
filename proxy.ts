import { NextResponse, type NextRequest } from "next/server";
import { AUTH_COOKIE, passToken } from "./lib/auth";

/**
 * Optional team passcode. Set APP_PASSCODE (e.g. in Vercel) and everyone must
 * enter it once per device. Without APP_PASSCODE the app is open (fine on localhost).
 */
export async function proxy(req: NextRequest) {
  const code = process.env.APP_PASSCODE?.trim();
  const { pathname } = req.nextUrl;
  if (!code) {
    // No passcode configured (e.g. on your own computer): the lock screen never shows.
    if (pathname === "/login") return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }
  if (pathname === "/login" || pathname === "/api/login") return NextResponse.next();
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  if (token && token === (await passToken(code))) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Locked. Enter the team passcode first." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/|manifest.webmanifest|opengraph-image|twitter-image|robots.txt|sitemap.xml).*)"],
};
