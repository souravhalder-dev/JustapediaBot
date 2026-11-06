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
  isConfirmedAccessible: boolean; // Confirmed 200-399 and genuinely accessible to readers
  isConfirmedDead: boolean;       // Confirmed 404, 410, DNS fail, or soft-404
  isInconclusive: boolean;        // Timeout, 401/403/451, 5xx, or network error
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
 * Inspect error to check if it is DNS failure, timeout, or network glitch.
 */
function inspectError(err: any): { isDns: boolean; isTimeout: boolean; message: string } {
  const msg = (err?.message || String(err)).toLowerCase();
  const causeCode = (err?.cause?.code || "").toLowerCase();
  const causeMsg = (err?.cause?.message || "").toLowerCase();
  const name = (err?.name || "").toLowerCase();
  const causeName = (err?.cause?.name || "").toLowerCase();

  const isDns =
    causeCode === "enotfound" ||
    causeMsg.includes("enotfound") ||
    causeMsg.includes("getaddrinfo") ||
    msg.includes("enotfound") ||
    msg.includes("getaddrinfo");

  const isTimeout =
    name === "aborterror" ||
    causeName === "aborterror" ||
    msg.includes("abort") ||
    msg.includes("timeout") ||
    causeMsg.includes("timeout") ||
    causeCode === "etimedout";

  return { isDns, isTimeout, message: msg };
}

/**
 * Performs a single HTTP request with its own dedicated AbortController and timeout.
 */
async function fetchWithTimeout(
  url: string,
  method: "HEAD" | "GET",
  timeoutMs: number
): Promise<{ status?: number; finalUrl?: string; error?: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (method === "GET") {
      headers["Range"] = "bytes=0-4096";
    }

    const res = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
      redirect: "follow",
    });

    clearTimeout(timer);
    return { status: res.status, finalUrl: res.url };
  } catch (err: any) {
    clearTimeout(timer);
    return { error: err };
  }
}

/**
 * Advanced Link Health Checker following official InternetArchiveBot guidelines.
 *
 * InternetArchiveBot rules:
 * 1. A link is ACCESSIBLE (ALIVE) if it returns HTTP 2xx or 3xx (unless soft-404).
 * 2. Paywalls and access restrictions (HTTP 401, 403, 451) are INCONCLUSIVE / NOT CONFIRMED DEAD.
 * 3. A link is ONLY CONFIRMED PERMANENTLY DEAD if:
 *    - It returns HTTP 404 Not Found or 410 Gone on both HEAD and GET, verified on retry.
 *    - Domain DNS resolution fails (ENOTFOUND / NXDOMAIN) on multiple attempts.
 *    - Confirmed soft-404 redirect.
 * 4. Timeouts, 5xx server errors, rate limits (429), and connection resets are INCONCLUSIVE.
 *    They MUST NEVER cause tags to be added or removed.
 */
export async function checkUrlHealth(
  url: string,
  timeoutMs: number = 10000,
  maxRetries: number = 1
): Promise<LinkCheckOutcome> {
  const cached = urlCheckCache.get(url);
  if (cached) return cached;

  // Archive URLs are archives, return alive immediately
  if (
    url.includes("web.archive.org") ||
    url.includes("archive.today") ||
    url.includes("archive.is") ||
    url.includes("webcitation.org")
  ) {
    const outcome: LinkCheckOutcome = {
      url,
      status: "alive",
      httpCode: 200,
      latencyMs: 1,
      isPermanentDead: false,
      isTemporaryError: false,
      isConfirmedAccessible: true,
      isConfirmedDead: false,
      isInconclusive: false,
    };
    urlCheckCache.set(url, outcome);
    return outcome;
  }

  const startTime = Date.now();
  let lastCode: number | undefined;
  let finalUrl: string | undefined;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Pause briefly before retry
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    const currentTimeout = timeoutMs + attempt * 5000;

    // 1. Try HEAD request first
    let head = await fetchWithTimeout(url, "HEAD", currentTimeout);
    let code = head.status;
    finalUrl = head.finalUrl;

    // 2. If HEAD succeeded with 2xx / 3xx
    if (code && code >= 200 && code < 400) {
      if (isSoft404Redirect(url, finalUrl)) {
        // Soft 404 redirect confirmed
        const outcome: LinkCheckOutcome = {
          url,
          status: "dead",
          httpCode: code,
          finalUrl,
          latencyMs: Date.now() - startTime,
          isPermanentDead: true,
          isTemporaryError: false,
          isSoft404: true,
          isConfirmedAccessible: false,
          isConfirmedDead: true,
          isInconclusive: false,
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
        latencyMs: Date.now() - startTime,
        isPermanentDead: false,
        isTemporaryError: false,
        isConfirmedAccessible: true,
        isConfirmedDead: false,
        isInconclusive: false,
      };
      urlCheckCache.set(url, outcome);
      return outcome;
    }

    // 3. If HEAD returned 401, 403, 451: Page is restricted/paywalled
    // Not confirmed dead, but NOT confirmed publicly accessible. Treat as inconclusive.
    if (code === 401 || code === 403 || code === 451) {
      const outcome: LinkCheckOutcome = {
        url,
        status: "alive",
        httpCode: code,
        finalUrl,
        latencyMs: Date.now() - startTime,
        isPermanentDead: false,
        isTemporaryError: false,
        isConfirmedAccessible: false, // Access restricted, do NOT change status based on this
        isConfirmedDead: false,       // Do NOT tag as dead
        isInconclusive: true,
        error: `HTTP ${code} access restricted / paywall`,
      };
      urlCheckCache.set(url, outcome);
      return outcome;
    }

    // 4. In ALL OTHER CASES (HEAD returned 404, 405, 500, error, or timed out):
    // Fallback to GET request with Range header
    const getResult = await fetchWithTimeout(url, "GET", currentTimeout + 2000);
    const getCode = getResult.status;
    if (getResult.finalUrl) finalUrl = getResult.finalUrl;

    if (getCode) {
      lastCode = getCode;

      // GET succeeded with 2xx / 3xx -> CONFIRMED ACCESSIBLE
      if (getCode >= 200 && getCode < 400) {
        if (isSoft404Redirect(url, finalUrl)) {
          const outcome: LinkCheckOutcome = {
            url,
            status: "dead",
            httpCode: getCode,
            finalUrl,
            latencyMs: Date.now() - startTime,
            isPermanentDead: true,
            isTemporaryError: false,
            isSoft404: true,
            isConfirmedAccessible: false,
            isConfirmedDead: true,
            isInconclusive: false,
            error: "Redirected to root or login/error page (Soft 404)",
          };
          urlCheckCache.set(url, outcome);
          return outcome;
        }

        const outcome: LinkCheckOutcome = {
          url,
          status: "alive",
          httpCode: getCode,
          finalUrl,
          latencyMs: Date.now() - startTime,
          isPermanentDead: false,
          isTemporaryError: false,
          isConfirmedAccessible: true,
          isConfirmedDead: false,
          isInconclusive: false,
        };
        urlCheckCache.set(url, outcome);
        return outcome;
      }

      // GET returned 401, 403, 451 -> restricted/paywall
      if (getCode === 401 || getCode === 403 || getCode === 451) {
        const outcome: LinkCheckOutcome = {
          url,
          status: "alive",
          httpCode: getCode,
          finalUrl,
          latencyMs: Date.now() - startTime,
          isPermanentDead: false,
          isTemporaryError: false,
          isConfirmedAccessible: false,
          isConfirmedDead: false,
          isInconclusive: true,
          error: `HTTP ${getCode} access restricted / paywall`,
        };
        urlCheckCache.set(url, outcome);
        return outcome;
      }

      // GET returned 404 or 410 -> candidate permanently dead
      if (getCode === 404 || getCode === 410) {
        if (attempt < maxRetries) {
          continue; // Verify on next attempt
        }
        const outcome: LinkCheckOutcome = {
          url,
          status: "dead",
          httpCode: getCode,
          finalUrl,
          latencyMs: Date.now() - startTime,
          isPermanentDead: true,
          isTemporaryError: false,
          isConfirmedAccessible: false,
          isConfirmedDead: true,
          isInconclusive: false,
          error: `HTTP ${getCode} confirmed on multiple checks`,
        };
        urlCheckCache.set(url, outcome);
        return outcome;
      }

      // GET returned 429 or 5xx -> transient server error
      if (getCode === 429 || (getCode >= 500 && getCode <= 504)) {
        if (attempt < maxRetries) continue;
        const outcome: LinkCheckOutcome = {
          url,
          status: "error",
          httpCode: getCode,
          finalUrl,
          latencyMs: Date.now() - startTime,
          isPermanentDead: false,
          isTemporaryError: true,
          isConfirmedAccessible: false,
          isConfirmedDead: false,
          isInconclusive: true,
          error: `Temporary HTTP ${getCode} server error`,
        };
        urlCheckCache.set(url, outcome);
        return outcome;
      }
    } else if (getResult.error) {
      // GET threw an error
      const errInfo = inspectError(getResult.error);
      lastError = errInfo.message;

      // DNS error (ENOTFOUND) -> domain does not exist
      if (errInfo.isDns) {
        if (attempt < maxRetries) continue;
        const outcome: LinkCheckOutcome = {
          url,
          status: "dead",
          latencyMs: Date.now() - startTime,
          isPermanentDead: true,
          isTemporaryError: false,
          isConfirmedAccessible: false,
          isConfirmedDead: true,
          isInconclusive: false,
          error: "DNS resolution failed (Domain does not exist)",
        };
        urlCheckCache.set(url, outcome);
        return outcome;
      }

      // Timeouts and network errors -> transient, retry
      if (attempt < maxRetries) continue;
    }
  }

  // Inconclusive fallback (timeout, 5xx, or network error)
  // NEVER mark inconclusive errors as permanently dead or change status!
  const finalOutcome: LinkCheckOutcome = {
    url,
    status: "error",
    httpCode: lastCode,
    finalUrl,
    latencyMs: Date.now() - startTime,
    isPermanentDead: false,
    isTemporaryError: true,
    isConfirmedAccessible: false,
    isConfirmedDead: false,
    isInconclusive: true,
    error: lastError || `Inconclusive after checks (HTTP ${lastCode || "unknown"})`,
  };
  urlCheckCache.set(url, finalOutcome);
  return finalOutcome;
}

/**
 * Clear the URL check cache (useful between cycles)
 */
export function clearUrlCheckCache(): void {
  urlCheckCache.clear();
}
