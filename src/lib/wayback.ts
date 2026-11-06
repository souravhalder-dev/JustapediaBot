const WAYBACK_AVAILABILITY_API = "https://archive.org/wayback/available";
const WAYBACK_CDX_API = "https://web.archive.org/cdx/search/cdx";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 (JustapediaIABot/2.5; +https://justapedia.org)";

export interface WaybackSnapshot {
  available: boolean;
  url: string;
  timestamp: string; // 14-digit timestamp e.g. "20180412153022"
  status: string;
  originalUrl?: string;
}

export interface CDXRecord {
  urlkey: string;
  timestamp: string;
  original: string;
  mimetype: string;
  statuscode: string;
  digest: string;
  length: string;
}

// In-memory set to prevent duplicate Save Page Now requests in a session
const requestedArchiveUrls = new Set<string>();

/**
 * Parses any archive URL (Wayback Machine, Archive.today, WebCite) to extract original target URL and timestamp
 */
export function parseArchiveUrl(archiveUrl: string): {
  isArchive: boolean;
  service?: "wayback" | "archiveis" | "webcite" | "other";
  timestamp?: string;
  originalUrl?: string;
} {
  const trimmed = archiveUrl.trim();

  // Wayback Machine: https://web.archive.org/web/20180412153022/http://example.com
  const waybackMatch = trimmed.match(/^https?:\/\/web\.archive\.org\/web\/([0-9]{4,14})(?:[a-z_]+)?\/(https?:\/\/.+)$/i);
  if (waybackMatch) {
    return {
      isArchive: true,
      service: "wayback",
      timestamp: waybackMatch[1].padEnd(14, "0"),
      originalUrl: waybackMatch[2],
    };
  }

  // Archive.today / archive.is / archive.ph
  const archiveIsMatch = trimmed.match(/^https?:\/\/(?:archive\.(?:is|li|today|fo|md|ph)|yaot\.ee)\/(?:[0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]{6}\/)?(https?:\/\/.+)$/i);
  if (archiveIsMatch) {
    return {
      isArchive: true,
      service: "archiveis",
      originalUrl: archiveIsMatch[1],
    };
  }

  // WebCite: https://www.webcitation.org/query?url=... or /hash
  if (trimmed.includes("webcitation.org")) {
    const urlParam = trimmed.match(/[?&]url=([^&]+)/i);
    return {
      isArchive: true,
      service: "webcite",
      originalUrl: urlParam ? decodeURIComponent(urlParam[1]) : undefined,
    };
  }

  if (trimmed.includes("web.archive.org")) {
    return { isArchive: true, service: "wayback" };
  }

  return { isArchive: false };
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
] as const;

/**
 * Detect the date style of an existing citation parameter or sample string
 * Supports Month D, YYYY (MDY), D Month YYYY (DMY), and ISO YYYY-MM-DD
 * Defaults to the American format (Month Day, Year) supported by Template:Cite web
 */
export function detectDateFormat(sample?: string): "MDY" | "DMY" | "ISO" {
  if (!sample || typeof sample !== "string") return "MDY";
  const s = sample.trim();

  // Corrupted merged date check: e.g. "2013-05-14 24, 2019" -> MDY
  if (/^\d{4}-\d{2}-\d{2}\s+\d{1,2},\s*\d{4}$/.test(s)) return "MDY";

  // MDY: "June 24, 2019", "November 5, 2026" or "June 24 2019"
  if (/^[A-Za-z]+\s+\d{1,2},?\s+\d{4}$/.test(s)) return "MDY";

  // DMY: "24 June 2019", "5 November 2026"
  if (/^\d{1,2}\s+[A-Za-z]+\s+\d{4}$/.test(s)) return "DMY";

  // ISO: "2019-06-24", "2026-11-05"
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return "ISO";

  // Check if any English month name is present
  const monthRegex = new RegExp(`(?:${MONTH_NAMES.join("|")})`, "i");
  if (monthRegex.test(s)) {
    if (/^\d{1,2}\s+[A-Za-z]/.test(s)) return "DMY";
    return "MDY";
  }

  // Default to American format (e.g. November 5, 2026) for Template:Cite web
  return "MDY";
}

/**
 * Format 14-digit Wayback timestamp (e.g. 20180412153022) or ISO date to standard citation date format.
 * Defaults to the American format (MDY "Month Day, Year", e.g. "November 5, 2026")
 * supported by Justapedia Template:Cite web / CS1 guidelines.
 */
export function formatWaybackDate(timestamp: string, sampleDate?: string): string {
  const clean = String(timestamp).replace(/[^0-9]/g, "");
  if (clean.length < 8) return "";
  const year = parseInt(clean.substring(0, 4), 10);
  const month = parseInt(clean.substring(4, 6), 10);
  const day = parseInt(clean.substring(6, 8), 10);

  if (isNaN(year) || isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return "";
  }

  const monthName = MONTH_NAMES[month - 1];
  const isoDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const style = detectDateFormat(sampleDate);
  if (style === "DMY") {
    return `${day} ${monthName} ${year}`;
  }
  if (style === "ISO") {
    return isoDate;
  }
  // American format: "Month Day, Year" (e.g. "November 5, 2026" / "May 14, 2013")
  return `${monthName} ${day}, ${year}`;
}

/**
 * Formats a Date object, timestamp, or date string into the American format:
 * "Month Day, Year" (e.g. "November 5, 2026") as required by Template:Cite web
 */
export function formatAmericanDate(d?: Date | string): string {
  if (!d) {
    const now = new Date();
    return `${MONTH_NAMES[now.getUTCMonth()]} ${now.getUTCDate()}, ${now.getUTCFullYear()}`;
  }

  if (typeof d === "string") {
    const s = d.trim();
    // 1. Check Month D, YYYY
    const mdyMatch = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (mdyMatch) {
      const monthInput = mdyMatch[1];
      const monthIdx = MONTH_NAMES.findIndex((m) =>
        m.toLowerCase().startsWith(monthInput.toLowerCase().substring(0, 3))
      );
      const monthName = monthIdx !== -1 ? MONTH_NAMES[monthIdx] : monthInput;
      const day = parseInt(mdyMatch[2], 10);
      const year = mdyMatch[3];
      return `${monthName} ${day}, ${year}`;
    }

    // 2. Check D Month YYYY
    const dmyMatch = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (dmyMatch) {
      const day = parseInt(dmyMatch[1], 10);
      const monthInput = dmyMatch[2];
      const monthIdx = MONTH_NAMES.findIndex((m) =>
        m.toLowerCase().startsWith(monthInput.toLowerCase().substring(0, 3))
      );
      const monthName = monthIdx !== -1 ? MONTH_NAMES[monthIdx] : monthInput;
      const year = dmyMatch[3];
      return `${monthName} ${day}, ${year}`;
    }

    // 3. Check ISO YYYY-MM-DD
    const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const year = isoMatch[1];
      const monthIdx = parseInt(isoMatch[2], 10) - 1;
      const day = parseInt(isoMatch[3], 10);
      const monthName = MONTH_NAMES[monthIdx] || "January";
      return `${monthName} ${day}, ${year}`;
    }

    // 4. Digits only (Wayback timestamp e.g. 20261105120000)
    const digits = s.replace(/[^0-9]/g, "");
    if (digits.length >= 8) {
      const year = digits.substring(0, 4);
      const monthIdx = parseInt(digits.substring(4, 6), 10) - 1;
      const day = parseInt(digits.substring(6, 8), 10);
      const monthName = MONTH_NAMES[monthIdx] || "January";
      return `${monthName} ${day}, ${year}`;
    }
  } else if (d instanceof Date && !isNaN(d.getTime())) {
    return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }

  const fallback = new Date();
  return `${MONTH_NAMES[fallback.getUTCMonth()]} ${fallback.getUTCDate()}, ${fallback.getUTCFullYear()}`;
}

/**
 * Standardize timestamp to 14 digits (YYYYMMDDHHMMSS)
 */
export function normalizeTimestamp(rawDateOrTimestamp: string): string {
  const digits = rawDateOrTimestamp.replace(/[^0-9]/g, "");
  if (digits.length >= 14) return digits.substring(0, 14);
  if (digits.length >= 8) return digits.substring(0, 8).padEnd(14, "0");

  // Attempt parse from date string e.g. "April 12, 2018"
  const parsed = Date.parse(rawDateOrTimestamp);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    const y = String(d.getUTCFullYear()).padStart(4, "0");
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}${m}${day}000000`;
  }

  return "";
}

const waybackAvailabilityCache = new Map<string, WaybackSnapshot | null>();

/**
 * Check Wayback availability using the fast /wayback/available endpoint
 */
export async function checkWaybackAvailability(url: string, timestamp?: string): Promise<WaybackSnapshot | null> {
  const cacheKey = `${url}__${timestamp || ""}`;
  if (waybackAvailabilityCache.has(cacheKey)) {
    return waybackAvailabilityCache.get(cacheKey) || null;
  }
  try {
    const params = new URLSearchParams({ url });
    if (timestamp) {
      params.append("timestamp", timestamp.replace(/[^0-9]/g, ""));
    }

    const res = await fetch(`${WAYBACK_AVAILABILITY_API}?${params.toString()}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      waybackAvailabilityCache.set(cacheKey, null);
      return null;
    }

    const data = await res.json();
    const snapshot = data?.archived_snapshots?.closest;

    if (snapshot && snapshot.available) {
      const snapObj: WaybackSnapshot = {
        available: true,
        url: snapshot.url.replace(/^http:\/\//i, "https://"),
        timestamp: snapshot.timestamp,
        status: String(snapshot.status || "200"),
        originalUrl: url,
      };
      waybackAvailabilityCache.set(cacheKey, snapObj);
      return snapObj;
    }

    waybackAvailabilityCache.set(cacheKey, null);
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Search Wayback CDX Server API for comprehensive historical snapshots
 * Matches Wikipedia IABot CDX querying capability
 */
export async function searchWaybackCDX(
  url: string,
  options?: {
    from?: string;
    to?: string;
    limit?: number;
    matchType?: "exact" | "prefix" | "host" | "domain";
  }
): Promise<CDXRecord[]> {
  try {
    const params = new URLSearchParams({
      url,
      output: "json",
      fl: "urlkey,timestamp,original,mimetype,statuscode,digest,length",
      filter: "statuscode:200", // Only accept valid 200 HTTP responses
      collapse: "digest",      // Deduplicate identical captures
      limit: String(options?.limit || 15),
    });

    if (options?.from) params.append("from", options.from);
    if (options?.to) params.append("to", options.to);
    if (options?.matchType) params.append("matchType", options.matchType);

    const res = await fetch(`${WAYBACK_CDX_API}?${params.toString()}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data) || data.length <= 1) return [];

    // First row is header: ["urlkey","timestamp","original","mimetype","statuscode","digest","length"]
    const rows = data.slice(1);
    return rows.map((r: any[]) => ({
      urlkey: r[0],
      timestamp: r[1],
      original: r[2],
      mimetype: r[3],
      statuscode: r[4],
      digest: r[5],
      length: r[6],
    }));
  } catch {
    return [];
  }
}

/**
 * Find the optimal historical snapshot for a URL:
 * 1. If preferredDate/accessDate given: find closest valid snapshot in CDX.
 * 2. Fall back to fast availability API.
 */
export async function findBestWaybackSnapshot(
  url: string,
  preferredDate?: string
): Promise<WaybackSnapshot | null> {
  const normTargetTimestamp = preferredDate ? normalizeTimestamp(preferredDate) : "";

  // 1. Fast Availability API query with timestamp (~200ms)
  const fastSnapshot = await checkWaybackAvailability(url, normTargetTimestamp || undefined);
  if (fastSnapshot && fastSnapshot.available) {
    return fastSnapshot;
  }

  // 2. Fallback to CDX query if availability returned no snapshot
  if (normTargetTimestamp) {
    const cdxRecords = await searchWaybackCDX(url, { limit: 10 });
    if (cdxRecords.length > 0) {
      const targetNum = parseInt(normTargetTimestamp.substring(0, 8), 10);
      let bestRecord = cdxRecords[0];
      let smallestDiff = Infinity;

      for (const rec of cdxRecords) {
        const recNum = parseInt(rec.timestamp.substring(0, 8), 10);
        const diff = Math.abs(recNum - targetNum);
        if (diff < smallestDiff) {
          smallestDiff = diff;
          bestRecord = rec;
        }
      }

      if (bestRecord) {
        const snapshotUrl = `https://web.archive.org/web/${bestRecord.timestamp}/${bestRecord.original}`;
        return {
          available: true,
          url: snapshotUrl,
          timestamp: bestRecord.timestamp,
          status: bestRecord.statuscode,
          originalUrl: bestRecord.original,
        };
      }
    }
  }

  // 3. Fallback CDX search without date filter
  const fallbackCDX = await searchWaybackCDX(url, { limit: 5 });
  if (fallbackCDX.length > 0) {
    const latest = fallbackCDX[fallbackCDX.length - 1];
    return {
      available: true,
      url: `https://web.archive.org/web/${latest.timestamp}/${latest.original}`,
      timestamp: latest.timestamp,
      status: latest.statuscode,
      originalUrl: latest.original,
    };
  }

  return null;
}

/**
 * Validate an archive snapshot to ensure it is alive and not a broken archive redirect
 */
const archiveValidationCache = new Map<string, boolean>();

export async function validateArchiveSnapshot(snapshotUrl: string): Promise<boolean> {
  const cached = archiveValidationCache.get(snapshotUrl);
  if (cached !== undefined) return cached;

  const parsed = parseArchiveUrl(snapshotUrl);
  if (parsed.isArchive && parsed.timestamp && parsed.timestamp.length >= 8 && parsed.originalUrl) {
    archiveValidationCache.set(snapshotUrl, true);
    return true;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);

    const res = await fetch(snapshotUrl, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);

    const valid = res.status === 200 || res.status === 301 || res.status === 302;
    archiveValidationCache.set(snapshotUrl, valid);
    return valid;
  } catch {
    if (parsed.isArchive && parsed.originalUrl) {
      archiveValidationCache.set(snapshotUrl, true);
      return true;
    }
    archiveValidationCache.set(snapshotUrl, false);
    return false;
  }
}

/**
 * Repair a broken or malformed Wayback Machine URL by finding a healthy replacement snapshot
 */
export async function repairBrokenArchiveUrl(
  brokenArchiveUrl: string,
  originalUrlFallback?: string
): Promise<WaybackSnapshot | null> {
  const parsed = parseArchiveUrl(brokenArchiveUrl);
  const targetUrl = parsed.originalUrl || originalUrlFallback;

  if (!targetUrl) return null;

  // Search CDX for alternative valid snapshots
  const records = await searchWaybackCDX(targetUrl, { limit: 10 });
  if (records.length === 0) return null;

  // Pick the newest valid snapshot
  const best = records[records.length - 1];
  const newArchiveUrl = `https://web.archive.org/web/${best.timestamp}/${best.original}`;

  // If identical to the broken URL, it's not a repair
  if (newArchiveUrl === brokenArchiveUrl) return null;

  return {
    available: true,
    url: newArchiveUrl,
    timestamp: best.timestamp,
    status: best.statuscode,
    originalUrl: best.original,
  };
}

/**
 * Submit URL to Wayback Save Page Now to archive working references
 */
export async function requestWaybackSave(url: string): Promise<{ success: boolean; saveUrl: string; message: string }> {
  const saveUrl = `https://web.archive.org/save/${encodeURI(url)}`;

  if (requestedArchiveUrls.has(url)) {
    return {
      success: true,
      saveUrl,
      message: "URL was already submitted to Wayback Machine in this session.",
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(saveUrl, {
      method: "GET",
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    clearTimeout(timer);

    requestedArchiveUrls.add(url);

    if (res.ok || res.status === 302 || res.status === 200) {
      return {
        success: true,
        saveUrl,
        message: "Successfully queued URL on the Wayback Machine Save Page Now service.",
      };
    }

    return {
      success: false,
      saveUrl,
      message: `Wayback returned HTTP ${res.status}.`,
    };
  } catch (err: any) {
    return {
      success: false,
      saveUrl,
      message: `Save request note: ${err.message}`,
    };
  }
}
