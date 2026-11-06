import { spawn } from "child_process";
import path from "path";

export interface BridgeRequest {
  url?: string;
  method?: "GET" | "POST";
  data?: Record<string, any>;
  params?: Record<string, any>;
  cookies?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface BridgeResponse<T = any> {
  status: number;
  data?: T;
  text?: string;
  cookies: Record<string, string>;
  headers: Record<string, string>;
  error?: string;
}

const BRIDGE_URL = "http://127.0.0.1:5005";
const SCRIPT_PATH = path.join(process.cwd(), "scripts", "justapedia_bridge.py");

// In serverless environments (Vercel, AWS), daemon & python subprocess are not present.
// Bypass them instantly to eliminate multi-second connection timeouts.
const IS_SERVERLESS = Boolean(process.env.VERCEL || process.env.AWS_REGION || process.env.VERCEL_ENV);
let localDaemonFailed = IS_SERVERLESS;
let pythonCliFailed = IS_SERVERLESS;

/**
 * Direct Node.js fetch fallback (used in serverless environments like Vercel where Python is unavailable).
 */
async function executeDirectFetch<T>(req: BridgeRequest): Promise<BridgeResponse<T>> {
  const url = req.url || "https://justapedia.org/api.php";
  const method = (req.method || "GET").toUpperCase();
  const cookies = req.cookies || {};
  const cookieHeader = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://justapedia.org",
    "Referer": "https://justapedia.org/",
    ...req.headers,
  };
  if (cookieHeader) {
    headers["Cookie"] = cookieHeader;
  }

  let finalUrl = url;
  if (req.params && Object.keys(req.params).length > 0) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(req.params)) {
      sp.append(k, String(v));
    }
    finalUrl = `${url}?${sp.toString()}`;
  }

  let body: string | undefined = undefined;
  if (method === "POST" && req.data) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(req.data)) {
      sp.append(k, String(v));
    }
    body = sp.toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  try {
    const res = await fetch(finalUrl, {
      method,
      headers,
      body,
      cache: "no-store",
    });

    const text = await res.text();
    let data: T | undefined = undefined;
    try {
      data = JSON.parse(text);
    } catch {}

    const responseCookies: Record<string, string> = {};
    const rawSetCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie") || ""];
    for (const c of rawSetCookie) {
      if (c) {
        const parts = c.split(";")[0].split("=");
        if (parts.length >= 2) {
          responseCookies[parts[0].trim()] = parts.slice(1).join("=").trim();
        }
      }
    }

    return {
      status: res.status,
      data,
      text,
      cookies: responseCookies,
      headers: Object.fromEntries(res.headers.entries()),
      error: res.ok ? undefined : `HTTP ${res.status}: ${text.slice(0, 100)}`,
    };
  } catch (err: any) {
    return {
      status: 500,
      cookies: {},
      headers: {},
      error: `Direct fetch error: ${err.message}`,
    };
  }
}

/**
 * Execute Justapedia API request bypassing Cloudflare WAF via curl_cffi Chrome impersonation.
 * 1. Tries local fast microservice (127.0.0.1:5005) for <100ms response.
 * 2. Tries Python subprocess fallback (curl_cffi Chrome impersonation).
 * 3. Transparently falls back to direct fetch for serverless environments (e.g. Vercel).
 */
export async function executeBridgeRequest<T = any>(
  req: BridgeRequest
): Promise<BridgeResponse<T>> {
  // 1. Fast direct fetch for serverless or when local daemons are unavailable
  if (localDaemonFailed && pythonCliFailed) {
    return executeDirectFetch<T>(req);
  }

  // 2. Try local daemon service for speed (~50-400ms)
  if (!localDaemonFailed) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);

      const daemonResp = await fetch(BRIDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (daemonResp.ok) {
        const json: BridgeResponse<T> = await daemonResp.json();
        return json;
      } else {
        localDaemonFailed = true;
      }
    } catch {
      localDaemonFailed = true;
    }
  }

  // 3. Direct Python subprocess fallback (local environments only)
  if (!pythonCliFailed) {
    const cliPromise = new Promise<BridgeResponse<T> | null>((resolve) => {
      try {
        const py = spawn("python", [SCRIPT_PATH]);
        let stdout = "";
        let stderr = "";

        py.on("error", () => {
          pythonCliFailed = true;
          resolve(null);
        });

        py.stdout.on("data", (d) => (stdout += d));
        py.stderr.on("data", (d) => (stderr += d));

        py.on("close", (code) => {
          if (code !== 0) {
            pythonCliFailed = true;
            resolve(null);
            return;
          }

          try {
            const parsed: BridgeResponse<T> = JSON.parse(stdout);
            resolve(parsed);
          } catch {
            pythonCliFailed = true;
            resolve(null);
          }
        });

        py.stdin.write(JSON.stringify(req));
        py.stdin.end();
      } catch {
        pythonCliFailed = true;
        resolve(null);
      }
    });

    const cliResult = await cliPromise;
    if (cliResult) {
      return cliResult;
    }
  }

  // 4. Fallback to direct fetch
  return executeDirectFetch<T>(req);
}
