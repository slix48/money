import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/auth/tokens";

export function proxy(request: NextRequest) {
  if (!request.cookies.has(SESSION_COOKIE_NAME)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/overview/:path*",
    "/transactions/:path*",
    "/income/:path*",
    "/recurring/:path*",
    "/investments/:path*",
    "/goals/:path*",
    "/cash-flow/:path*",
    "/changes/:path*",
    "/ai/:path*",
    "/settings/:path*",
  ],
};
