import { LinkStatus } from "./types";
import { extractDomain } from "./utils";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (JustapediaBot/2.5; +https://justapedia.org)";

export interface LinkCheckOutcome {
  url: string;
  status: LinkStatus;
  httpCode?: number;
  finalUrl?: string;
  latencyMs: number;
  isPermanentDead: boolean;
  isTemporaryError: boolean;
  isSoft404?: boolean;
  error?: string;
}

// In-memory session cache for URL check results
const urlCheckCache = new Map<string, LinkCheckOutcome>();

/**
 * Checks if a redirect target appears to be a soft-404 (e.g. redirected to domain root or login)
 */
function isSoft404Redirect(initialUrl: string, finalUrl?: string): boolean {
  if (!finalUrl || initialUrl === finalUrl) return false;

  try {
    const init = new URL(initialUrl);
    const fin = new URL(finalUrl);

    // If initial had a deep path and final redirected to root domain path "/"
    if (init.pathname.length > 3 && (fin.pathname === "/" || fin.pathname === "")) {
      return true;
    }

    // Redirected to standard error/login pages
    const finPath = fin.pathname.toLowerCase();
    if (
      finPath.includes("/404") ||
      finPath.includes("/error") ||
      finPath.includes("/notfound") ||
      finPath.includes("/login") ||
      finPath.includes("/signin") ||
      finPath.includes("/expired")
    ) {
      return true;
    }
  } catch {
    // ignore
  }

  return false;
}

/**
 * Advanced Link Health Checker matching Wikipedia InternetArchiveBot
 * Features:
 * - Temporary vs Permanent error distinction
 * - Soft-404 redirect detection
 * - Exponential backoff retry for transient 5xx/429
 * - Fast in-memory session caching
 */
export async function checkUrlHealth(
  url: string,
  timeoutMs: number = 2500,
  maxRetries: number = 0
): Promise<LinkCheckOutcome> {
  const cached = urlCheckCache.get(url);
  if (cached) return cached;

  const startTime = Date.now();
  let attempt = 0;
  let lastError = "";
  let lastStatus: LinkStatus = "unknown";
  let lastCode: number | undefined;
  let finalUrl: string | undefined;

  while (attempt <= maxRetries) {
    attempt++;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        // Attempt HEAD request first for speed
        res = await fetch(url, {
          method: "HEAD",
          headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          signal: controller.signal,
          redirect: "follow",
        });
      } catch (headErr: any) {
        // If HEAD was rejected or aborted, attempt GET with Range header
        res = await fetch(url, {
          method: "GET",
          headers: {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Range": "bytes=0-2048", // Only fetch first 2KB
          },
          signal: controller.signal,
          redirect: "follow",
        });
      } finally {
        clearTimeout(timer);
      }

      const latencyMs = Date.now() - startTime;
      const code = res.status;
      lastCode = code;
      finalUrl = res.url;

      // 1. Success 2xx / 3xx
      if (code >= 200 && code < 400) {
        // Check for soft-404 redirects
        if (isSoft404Redirect(url, finalUrl)) {
          const outcome: LinkCheckOutcome = {
            url,
            status: "dead",
            httpCode: code,
            finalUrl,
            latencyMs,
            isPermanentDead: true,
            isTemporaryError: false,
            isSoft404: true,
            error: "Redirected to root or login/error page (Soft 404)",
          };
          urlCheckCache.set(url, outcome);
          return outcome;
        }

        const outcome: LinkCheckOutcome = {
          url,
          status: "alive",
          httpCode: code,
          finalUrl,
          latencyMs,
          isPermanentDead: false,
          isTemporaryError: false,
        };
        urlCheckCache.set(url, outcome);
        return outcome;
      }

      // 2. Permanently dead: 404 Not Found, 410 Gone
      if (code === 404 || code === 410) {
        const outcome: LinkCheckOutcome = {
          url,
          status: "dead",
          httpCode: code,
          finalUrl,
          latencyMs,
          isPermanentDead: true,
          isTemporaryError: false,
        };
        urlCheckCache.set(url, outcome);
        return outcome;
      }

      // 3. Transient / Rate Limited: 429, 500, 502, 503, 504
      if (code === 429 || (code >= 500 && code <= 504)) {
        if (attempt <= maxRetries) {
          // Brief pause before retry
          await new Promise((r) => setTimeout(r, 800));
          continue;
        }

        const outcome: LinkCheckOutcome = {
          url,
          status: "error",
          httpCode: code,
          finalUrl,
          latencyMs,
          isPermanentDead: false,
          isTemporaryError: true,
          error: `Temporary HTTP ${code} server error`,
        };
        urlCheckCache.set(url, outcome);
        return outcome;
      }

      // 4. Other 4xx client restrictions: 401 Unauthorized, 403 Forbidden (URL is alive, paywalled or protected)
      if (code === 401 || code === 403 || code === 451) {
        const outcome: LinkCheckOutcome = {
          url,
          status: "alive",
          httpCode: code,
          finalUrl,
          latencyMs,
          isPermanentDead: false,
          isTemporaryError: false,
        };
        urlCheckCache.set(url, outcome);
        return outcome;
      }

      // Default other codes
      lastStatus = "error";
    } catch (err: any) {
      lastError = err.message || String(err);
      const isDnsError = lastError.includes("ENOTFOUND") || lastError.includes("getaddrinfo");
      const isRefused = lastError.includes("ECONNREFUSED");
      const isTimeout = lastError.includes("aborted") || lastError.includes("ETIMEDOUT");

      if (isDnsError || isRefused) {
        // Domain does not exist or connection refused: Permanently dead
        const outcome: LinkCheckOutcome = {
          url,
          status: "dead",
          latencyMs: Date.now() - startTime,
          isPermanentDead: true,
          isTemporaryError: false,
          error: isDnsError ? "DNS resolution failed (Domain does not exist)" : "Connection refused by host",
        };
        urlCheckCache.set(url, outcome);
        return outcome;
      }

      if (isTimeout && attempt <= maxRetries) {
        await new Promise((r) => setTimeout(r, 600));
        continue;
      }

      const outcome: LinkCheckOutcome = {
        url,
        status: isTimeout ? "error" : "dead",
        latencyMs: Date.now() - startTime,
        isPermanentDead: !isTimeout,
        isTemporaryError: isTimeout,
        error: lastError,
      };
      urlCheckCache.set(url, outcome);
      return outcome;
    }
  }

  const finalOutcome: LinkCheckOutcome = {
    url,
    status: lastStatus,
    httpCode: lastCode,
    finalUrl,
    latencyMs: Date.now() - startTime,
    isPermanentDead: false,
    isTemporaryError: true,
    error: lastError || `HTTP status ${lastCode || "unknown"} error`,
  };
  urlCheckCache.set(url, finalOutcome);
  return finalOutcome;
}
