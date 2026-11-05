import { LinkStatus } from "./types";
import { extractDomain } from "./utils";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 JustapediaBot/2.1";

export interface LinkCheckOutcome {
  status: LinkStatus;
  httpCode?: number;
  finalUrl?: string;
  latencyMs: number;
  error?: string;
}

export async function checkUrlHealth(url: string, timeoutMs: number = 7000): Promise<LinkCheckOutcome> {
  const startTime = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      // First attempt with HEAD for speed
      res = await fetch(url, {
        method: "HEAD",
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: controller.signal,
        redirect: "follow",
      });
    } catch (headErr) {
      // If HEAD is blocked or rejected, attempt lightweight GET
      res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: controller.signal,
        redirect: "follow",
      });
    } finally {
      clearTimeout(timer);
    }

    const latencyMs = Date.now() - startTime;
    const code = res.status;

    if (code >= 200 && code < 400) {
      return {
        status: "alive",
        httpCode: code,
        finalUrl: res.url,
        latencyMs,
      };
    }

    if (code === 404 || code === 410 || code >= 500) {
      return {
        status: "dead",
        httpCode: code,
        finalUrl: res.url,
        latencyMs,
      };
    }

    // Other 4xx client errors (e.g., 403 Forbidden, 401 Unauthorized might still be alive server-side)
    if (code === 403 || code === 401) {
      return {
        status: "alive", // server exists, just restricted
        httpCode: code,
        finalUrl: res.url,
        latencyMs,
      };
    }

    return {
      status: "dead",
      httpCode: code,
      finalUrl: res.url,
      latencyMs,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = err.name === "AbortError";
    const msg = isTimeout ? "Connection timed out" : err.message || "Failed to connect";

    return {
      status: "dead",
      latencyMs,
      error: msg,
    };
  }
}
