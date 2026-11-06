import { NextRequest, NextResponse } from "next/server";
import { verifyUserSession, SessionPayload } from "./auth";
import { AuthUser } from "./types";

export interface GuardSuccess {
  authorized: true;
  user: AuthUser;
  session: SessionPayload;
  sessionToken: string;
}

export interface GuardFailure {
  authorized: false;
  response: NextResponse;
}

export type GuardResult = GuardSuccess | GuardFailure;

/**
 * Enterprise Role-Based Access Control (RBAC) Guard for Backend API Handlers
 * 
 * Enforces:
 * 1. Presence of authenticated session token (via Authorization: Bearer, Cookie, or explicit argument)
 * 2. Cryptographic signature and expiration verification
 * 3. MediaWiki permission validation: User MUST have 'bot' or 'sysop'/'administrator' privileges
 * 4. Automatic rejection with HTTP 401 (Unauthorized) or HTTP 403 (Forbidden)
 */
export async function requireAuthorizedUser(
  req: NextRequest,
  explicitToken?: string
): Promise<GuardResult> {
  let token = (explicitToken || "").trim();

  // 1. Extract from Authorization Bearer header
  if (!token) {
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }
  }

  // 2. Extract from HttpOnly session cookie
  if (!token) {
    const cookieVal = req.cookies.get("justapedia_session")?.value;
    if (cookieVal) {
      token = cookieVal.trim();
    }
  }

  // 3. Fallback: query param 'token' (for strictly controlled server redirects)
  if (!token) {
    const paramToken = req.nextUrl.searchParams.get("token");
    if (paramToken) {
      token = paramToken.trim();
    }
  }

  // Reject if unauthenticated
  if (!token) {
    return {
      authorized: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Authentication required",
          message: "Unauthorized: You must be logged in with a Justapedia Bot or Administrator account to access this resource.",
          code: "UNAUTHORIZED",
        },
        { status: 401 }
      ),
    };
  }

  // 4. Verify cryptographic session token & live MediaWiki credentials
  const verification = await verifyUserSession(token);
  if (!verification.valid || !verification.user || !verification.session) {
    return {
      authorized: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Session expired or invalid",
          message: verification.error || "Authentication failed: Your Justapedia session has expired or is invalid. Please log in again.",
          code: "SESSION_EXPIRED",
        },
        { status: 403 }
      ),
    };
  }

  // 5. Enforce Role-Based Access Control (RBAC): Bot or Administrator privileges required
  if (!verification.user.is_bot && !verification.user.is_admin) {
    return {
      authorized: false,
      response: NextResponse.json(
        {
          success: false,
          error: "Forbidden",
          message: `Access denied: Account @${verification.user.username} lacks required Bot or Administrator privileges on Justapedia.`,
          code: "FORBIDDEN",
        },
        { status: 403 }
      ),
    };
  }

  return {
    authorized: true,
    user: verification.user,
    session: verification.session,
    sessionToken: token,
  };
}
