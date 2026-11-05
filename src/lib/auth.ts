import { SignJWT, jwtVerify } from "jose";
import { AuthUser, LoginResponse } from "./types";

const JUSTAPEDIA_API = "https://justapedia.org/api.php";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (JustapediaBotSuite/2.0)";
const JWT_SECRET_STRING = process.env.JWT_SECRET || "justapedia-secure-jwt-signing-key-2025-suite-archivebot";
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING);

export interface SessionPayload {
  sub: string;
  userid?: number;
  editcount?: number;
  groups?: string[];
  auth_type: "credentials" | "oauth";
  cookies: Record<string, string>;
  iat?: number;
  exp?: number;
}

/**
 * Format cookie dictionary into a standard Cookie header string
 */
export function formatCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("; ");
}

/**
 * Parse Set-Cookie header strings into a key-value record
 */
export function parseSetCookies(setCookieHeaders: string[] | string | null): Record<string, string> {
  const result: Record<string, string> = {};
  if (!setCookieHeaders) return result;

  const headerList = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  for (const header of headerList) {
    const parts = header.split(";");
    const firstPart = parts[0]?.trim();
    if (firstPart) {
      const eqIdx = firstPart.indexOf("=");
      if (eqIdx > 0) {
        const key = decodeURIComponent(firstPart.substring(0, eqIdx).trim());
        const val = decodeURIComponent(firstPart.substring(eqIdx + 1).trim());
        result[key] = val;
      }
    }
  }
  return result;
}

/**
 * Direct MediaWiki Credentials Flow (Username + Password / Bot Password)
 * Matches Birth Update Bot auth_service.py exactly.
 */
export async function loginToJustapedia(username: string, password: string): Promise<LoginResponse> {
  const uname = (username || "").trim();
  const passwd = (password || "").trim();

  if (!uname || !passwd) {
    return {
      success: false,
      message: "Please provide both Justapedia username and password.",
    };
  }

  try {
    let accumulatedCookies: Record<string, string> = {};

    // Step 1: Obtain login token
    const tokenUrl = `${JUSTAPEDIA_API}?action=query&meta=tokens&type=login&format=json`;
    const tokenResp = await fetch(tokenUrl, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      cache: "no-store",
    });

    if (!tokenResp.ok) {
      return {
        success: false,
        message: `Justapedia API returned HTTP ${tokenResp.status} during token fetch.`,
      };
    }

    // Capture initial cookies (e.g. session id)
    const rawSetCookies1 = tokenResp.headers.getSetCookie ? tokenResp.headers.getSetCookie() : tokenResp.headers.get("set-cookie");
    accumulatedCookies = { ...accumulatedCookies, ...parseSetCookies(rawSetCookies1) };

    const tokenData = await tokenResp.json();
    const loginToken = tokenData?.query?.tokens?.logintoken;

    if (!loginToken) {
      return {
        success: false,
        message: "Failed to retrieve login token from Justapedia MediaWiki API.",
      };
    }

    // Step 2: POST login credentials
    const loginFormData = new URLSearchParams();
    loginFormData.append("action", "login");
    loginFormData.append("lgname", uname);
    loginFormData.append("lgpassword", passwd);
    loginFormData.append("lgtoken", loginToken);
    loginFormData.append("format", "json");

    const loginResp = await fetch(JUSTAPEDIA_API, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": formatCookieHeader(accumulatedCookies),
      },
      body: loginFormData.toString(),
      cache: "no-store",
    });

    if (!loginResp.ok) {
      return {
        success: false,
        message: `Justapedia login request failed with HTTP ${loginResp.status}`,
      };
    }

    // Capture authenticated cookies
    const rawSetCookies2 = loginResp.headers.getSetCookie ? loginResp.headers.getSetCookie() : loginResp.headers.get("set-cookie");
    accumulatedCookies = { ...accumulatedCookies, ...parseSetCookies(rawSetCookies2) };

    const loginData = await loginResp.json();
    const result = loginData?.login?.result;

    if (result !== "Success") {
      let reason = loginData?.login?.reason || result || "Unknown error";
      if (result === "WrongPass") {
        reason = "Incorrect password or bot password. Please verify your credentials.";
      } else if (result === "NotExists") {
        reason = `User account '${uname}' does not exist on Justapedia.`;
      } else if (result === "NeedToken") {
        reason = "Re-authentication token requested by Justapedia.";
      }
      return {
        success: false,
        message: `Login failed: ${reason}`,
      };
    }

    const verifiedUsername = loginData?.login?.lgusername || uname;

    // Step 3: Strictly verify authenticated identity and fetch userinfo
    const userInfoUrl = `${JUSTAPEDIA_API}?action=query&meta=userinfo&uiprop=rights|groups|editcount&format=json`;
    const userResp = await fetch(userInfoUrl, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Cookie": formatCookieHeader(accumulatedCookies),
      },
      cache: "no-store",
    });

    let editCount = 0;
    let userId: number | undefined;
    let groups: string[] = [];

    if (userResp.ok) {
      const userData = await userResp.json();
      const uinfo = userData?.query?.userinfo;
      if (uinfo && !uinfo.anon && uinfo.name) {
        userId = uinfo.id;
        editCount = uinfo.editcount || 0;
        groups = uinfo.groups || [];
      }
    }

    // Step 4: Issue signed stateless JWT session token
    const token = await new SignJWT({
      sub: verifiedUsername,
      userid: userId,
      editcount: editCount,
      groups: groups,
      auth_type: "credentials",
      cookies: accumulatedCookies,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(JWT_SECRET);

    const user: AuthUser = {
      logged_in: true,
      username: verifiedUsername,
      userid: userId,
      editcount: editCount,
      groups: groups,
      auth_type: "credentials",
      userContributionsUrl: `https://justapedia.org/Special:Contributions/${encodeURIComponent(verifiedUsername)}`,
      userProfileUrl: `https://justapedia.org/User:${encodeURIComponent(verifiedUsername)}`,
    };

    return {
      success: true,
      message: `Successfully logged in as ${verifiedUsername}`,
      session_token: token,
      username: verifiedUsername,
      auth_type: "credentials",
      user,
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Authentication error: ${err.message || String(err)}`,
    };
  }
}

/**
 * Verify session token and retrieve live Justapedia profile
 */
export async function verifyUserSession(sessionToken: string): Promise<{ valid: boolean; user?: AuthUser; session?: SessionPayload; error?: string }> {
  if (!sessionToken) {
    return { valid: false, error: "Missing session token." };
  }

  try {
    const { payload } = await jwtVerify(sessionToken, JWT_SECRET);
    const session = payload as unknown as SessionPayload;

    if (!session.sub || !session.cookies) {
      return { valid: false, error: "Invalid session claims." };
    }

    // Live verify cookies against Justapedia Action API
    const userInfoUrl = `${JUSTAPEDIA_API}?action=query&meta=userinfo&uiprop=rights|groups|editcount&format=json`;
    const userResp = await fetch(userInfoUrl, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
        "Cookie": formatCookieHeader(session.cookies),
      },
      cache: "no-store",
    });

    if (!userResp.ok) {
      return { valid: false, error: "Failed to communicate with Justapedia API." };
    }

    const userData = await userResp.json();
    const uinfo = userData?.query?.userinfo;

    if (!uinfo || uinfo.anon || !uinfo.name) {
      return { valid: false, error: "Session expired on Justapedia. Please log in again." };
    }

    const liveUsername = uinfo.name;

    const user: AuthUser = {
      logged_in: true,
      username: liveUsername,
      userid: uinfo.id,
      editcount: uinfo.editcount || 0,
      groups: uinfo.groups || [],
      rights: uinfo.rights || [],
      auth_type: session.auth_type,
      userContributionsUrl: `https://justapedia.org/Special:Contributions/${encodeURIComponent(liveUsername)}`,
      userProfileUrl: `https://justapedia.org/User:${encodeURIComponent(liveUsername)}`,
    };

    return {
      valid: true,
      user,
      session,
    };
  } catch (err: any) {
    return {
      valid: false,
      error: `Token verification failed: ${err.message || String(err)}`,
    };
  }
}
