import { SignJWT, jwtVerify } from "jose";
import { AuthUser, LoginResponse } from "./types";
import { executeBridgeRequest } from "./justapedia-bridge";

const JUSTAPEDIA_API = "https://justapedia.org/api.php";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const JWT_SECRET_STRING = process.env.JWT_SECRET || "48faa3a54d28680a66104aa5c94df471a857b200";
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING);

const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

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
 * Format cookie dictionary into a standard Cookie header string without double-encoding
 */
export function formatCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
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
    const cookiePart = parts[0]?.trim();
    if (cookiePart) {
      const eqIdx = cookiePart.indexOf("=");
      if (eqIdx > 0) {
        const key = cookiePart.substring(0, eqIdx).trim();
        const val = cookiePart.substring(eqIdx + 1).trim();
        result[key] = val;
      }
    }
  }
  return result;
}

/**
 * Direct MediaWiki Credentials Flow (Username + Password / Bot Password)
 * Bypasses Cloudflare WAF using curl_cffi Chrome TLS impersonation.
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
    // Step 1: Obtain login token via Cloudflare-bypass bridge
    const tokenResp = await executeBridgeRequest<{
      query?: { tokens?: { logintoken?: string } };
    }>({
      method: "GET",
      params: { action: "query", meta: "tokens", type: "login", format: "json" },
    });

    if (tokenResp.status !== 200 || !tokenResp.data?.query?.tokens?.logintoken) {
      return {
        success: false,
        message: `Failed to retrieve login token from Justapedia MediaWiki API (HTTP ${tokenResp.status}): ${tokenResp.error || ""}`,
      };
    }

    const loginToken = tokenResp.data.query.tokens.logintoken;
    let accumulatedCookies: Record<string, string> = { ...tokenResp.cookies };

    // Step 2: POST login credentials via Cloudflare-bypass bridge
    const loginResp = await executeBridgeRequest<{
      login?: {
        result?: string;
        reason?: string;
        lgusername?: string;
      };
    }>({
      method: "POST",
      data: {
        action: "login",
        lgname: uname,
        lgpassword: passwd,
        lgtoken: loginToken,
        format: "json",
      },
      cookies: accumulatedCookies,
    });

    accumulatedCookies = { ...accumulatedCookies, ...loginResp.cookies };

    if (loginResp.status !== 200) {
      return {
        success: false,
        message: `Justapedia login request failed with HTTP ${loginResp.status}: ${loginResp.error || ""}`,
      };
    }

    const result = loginResp.data?.login?.result;
    if (result !== "Success") {
      let reason = loginResp.data?.login?.reason || result || "Unknown error";
      if (result === "WrongPass") {
        reason = "Incorrect password or bot password. Please verify your credentials.";
      } else if (result === "NotExists") {
        reason = `User account '${uname}' does not exist on Justapedia.`;
      } else if (result === "NeedToken") {
        reason = "Re-authentication token requested by Justapedia.";
      } else if (result === "Failed") {
        reason = loginResp.data?.login?.reason || "Authentication failed. Please verify your username and password or bot password.";
      }
      return {
        success: false,
        message: `Login failed: ${reason}`,
      };
    }

    const verifiedUsername = loginResp.data?.login?.lgusername || uname;

    // Step 3: Strictly verify authenticated identity and fetch userinfo via bridge
    const userResp = await executeBridgeRequest<{
      query?: {
        userinfo?: {
          id?: number;
          name?: string;
          anon?: string;
          editcount?: number;
          groups?: string[];
          rights?: string[];
        };
      };
    }>({
      method: "GET",
      params: {
        action: "query",
        meta: "userinfo",
        uiprop: "rights|groups|editcount",
        format: "json",
      },
      cookies: accumulatedCookies,
    });

    let editCount = 0;
    let userId: number | undefined;
    let groups: string[] = [];

    if (userResp.status === 200) {
      const uinfo = userResp.data?.query?.userinfo;
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

    // Live verify cookies against Justapedia Action API via bridge
    const userResp = await executeBridgeRequest<{
      query?: {
        userinfo?: {
          id?: number;
          name?: string;
          anon?: string;
          editcount?: number;
          groups?: string[];
          rights?: string[];
        };
      };
    }>({
      method: "GET",
      params: {
        action: "query",
        meta: "userinfo",
        uiprop: "rights|groups|editcount",
        format: "json",
      },
      cookies: session.cookies,
    });

    if (userResp.status !== 200) {
      return { valid: false, error: "Failed to communicate with Justapedia API." };
    }

    const uinfo = userResp.data?.query?.userinfo;

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
