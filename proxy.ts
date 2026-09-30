import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Next.js 16 Proxy (formerly `middleware.ts`).
 *
 * Responsibilities:
 *  1. Refresh the Supabase auth session on every matched request.
 *  2. Guard protected routes (`/app/*`, `/settings`) — redirect unauthenticated
 *     users to `/login`, preserving the intended destination.
 *  3. Redirect already-authenticated users away from `/login` and `/signup`.
 *
 * Note: This is a convenience/UX layer. Authorization is ALSO enforced
 * server-side inside protected pages and (in future) Server Actions, because
 * proxy matchers can be bypassed by refactors.
 */

const PROTECTED_PREFIXES = ["/app", "/settings"];

/**
 * `/forgot-password` and `/reset-password` are deliberately ABSENT from this
 * list, and that is load-bearing rather than an oversight:
 *
 *  - `/reset-password` is reached from a recovery link, so the person IS signed
 *    in by the time they arrive (the callback exchanged the one-time code for a
 *    session). Listing it as an auth route would bounce them straight to /app
 *    and the form would never render.
 *  - `/forgot-password` is useful to somebody who is already signed in, and
 *    gating it would only stop a legitimate password change.
 *
 * Adding either route here breaks password recovery. Both pages do their own
 * session checks instead.
 */
const AUTH_ROUTES = ["/login", "/signup"];

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const { pathname } = request.nextUrl;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
  const isAuthRoute = AUTH_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );

  // Unauthenticated user trying to reach a protected route.
  if (isProtected && !userId) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Authenticated user trying to reach login/signup.
  if (isAuthRoute && userId) {
    const appUrl = request.nextUrl.clone();
    appUrl.pathname = "/app";
    appUrl.search = "";
    return NextResponse.redirect(appUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     * - common static asset extensions
     */
    "/((?!api|_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};