import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const JWT_SECRET_STRING = process.env.JWT_SECRET || "48faa3a54d28680a66104aa5c94df471a857b200";
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING);

// Allowed administrative or bot groups
const AUTHORIZED_GROUPS = new Set([
  "bot",
  "copyviobot",
  "sysop",
  "administrator",
  "interface-admin",
  "bureaucrat",
  "root",
  "communitytrustee",
  "executivecommittee",
]);

// Core rights indicating bot or administrator status
const AUTHORIZED_RIGHTS = new Set([
  "bot",
  "protect",
  "editprotected",
  "delete",
  "bigdelete",
  "block",
  "editinterface",
]);

/**
 * Global Edge Security Middleware
 * Completely shields all bot features, dashboards, and API endpoints from unauthorized users.
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 1. Extract session token from HttpOnly cookie or Authorization header
  let token = req.cookies.get("justapedia_session")?.value;

  if (!token) {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }
  }

  // 2. Reject if token is missing
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          success: false,
          error: "Authentication required",
          message: "Unauthorized: You must be logged in with a Justapedia Bot or Administrator account to access this resource.",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      );
    }

    // Redirect unauthenticated page requests to homepage login gate
    const loginUrl = new URL("/", req.url);
    loginUrl.searchParams.set("auth", "required");
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 3. Cryptographically verify JWT session token & RBAC claims
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);

    if (!payload || !payload.sub) {
      throw new Error("Invalid session claims.");
    }

    const groups: string[] = Array.isArray(payload.groups) ? payload.groups : [];
    const rights: string[] = Array.isArray(payload.rights) ? payload.rights : [];

    const isBot =
      groups.some((g) => typeof g === "string" && AUTHORIZED_GROUPS.has(g.toLowerCase())) ||
      rights.some((r) => typeof r === "string" && r.toLowerCase() === "bot");

    const isAdmin =
      groups.some((g) => typeof g === "string" && AUTHORIZED_GROUPS.has(g.toLowerCase()) && g.toLowerCase() !== "bot") ||
      rights.some((r) => typeof r === "string" && AUTHORIZED_RIGHTS.has(r.toLowerCase()));

    // Strict RBAC: Must be Bot or Administrator
    if (!isBot && !isAdmin) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          {
            success: false,
            error: "Forbidden",
            message: `Access denied: Account @${payload.sub} lacks required Bot or Administrator privileges.`,
            code: "FORBIDDEN",
          },
          { status: 403 }
        );
      }
      const forbiddenUrl = new URL("/", req.url);
      forbiddenUrl.searchParams.set("auth", "forbidden");
      return NextResponse.redirect(forbiddenUrl);
    }

    // Authorized! Proceed with request
    return NextResponse.next();
  } catch (err: any) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          success: false,
          error: "Session expired or invalid",
          message: "Authentication failed: Session token invalid or expired. Please re-authenticate.",
          code: "SESSION_EXPIRED",
        },
        { status: 401 }
      );
    }

    const expiredUrl = new URL("/", req.url);
    expiredUrl.searchParams.set("auth", "expired");
    return NextResponse.redirect(expiredUrl);
  }
}

/**
 * Configure which routes are strictly protected by the middleware
 */
export const config = {
  matcher: [
    // Dedicated Bot Dashboards
    "/bots/:path*",
    // Internal Tools & Settings
    "/analyzer/:path*",
    "/inspector/:path*",
    "/domains/:path*",
    "/settings/:path*",
    // All Bot Operations & Analysis APIs
    "/api/bot/:path*",
    "/api/analyze/:path*",
    "/api/check-url/:path*",
    "/api/save-archive/:path*",
    "/api/search/:path*",
  ],
};
