const WAYBACK_AVAILABILITY_API = "https://archive.org/wayback/available";
const USER_AGENT = "JustapediaArchiveBot/2.1 (https://justapedia.org; modern-web-client)";

export interface WaybackSnapshot {
  available: boolean;
  url: string;
  timestamp: string;
  status: string;
}

export async function checkWaybackAvailability(url: string, timestamp?: string): Promise<WaybackSnapshot | null> {
  try {
    const params = new URLSearchParams({ url });
    if (timestamp) {
      params.append("timestamp", timestamp.replace(/[^0-9]/g, ""));
    }

    const res = await fetch(`${WAYBACK_AVAILABILITY_API}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });

    if (!res.ok) return null;

    const data = await res.json();
    const snapshot = data?.archived_snapshots?.closest;

    if (snapshot && snapshot.available) {
      return {
        available: true,
        url: snapshot.url.replace(/^http:\/\//i, "https://"),
        timestamp: snapshot.timestamp,
        status: snapshot.status || "200",
      };
    }

    return null;
  } catch (err) {
    console.error(`Wayback availability check failed for ${url}:`, err);
    return null;
  }
}

export async function requestWaybackSave(url: string): Promise<{ success: boolean; saveUrl?: string; message: string }> {
  try {
    const saveUrl = `https://web.archive.org/save/${encodeURI(url)}`;
    // We send a non-blocking request to the save endpoint
    const res = await fetch(saveUrl, {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
    });

    if (res.ok || res.status === 302) {
      return {
        success: true,
        saveUrl,
        message: "Successfully submitted URL to the Wayback Machine for immediate archival.",
      };
    }

    return {
      success: false,
      saveUrl,
      message: `Wayback Machine returned HTTP ${res.status}. You can save it manually at ${saveUrl}`,
    };
  } catch (err: any) {
    return {
      success: false,
      saveUrl: `https://web.archive.org/save/${encodeURI(url)}`,
      message: `Request error: ${err.message}`,
    };
  }
}
