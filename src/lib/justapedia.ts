const JUSTAPEDIA_API = "https://justapedia.org/api.php";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

export function parseJustapediaTitle(input: string): string {
  let cleaned = input.trim();
  try {
    if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) {
      const url = new URL(cleaned);
      if (url.hostname.includes("justapedia.org")) {
        if (url.pathname.startsWith("/wiki/")) {
          return decodeURIComponent(url.pathname.replace(/^\/wiki\//, "")).replace(/_/g, " ");
        }
        if (url.searchParams.has("title")) {
          return decodeURIComponent(url.searchParams.get("title")!).replace(/_/g, " ");
        }
        if (url.pathname.length > 1) {
          return decodeURIComponent(url.pathname.replace(/^\//, "")).replace(/_/g, " ");
        }
      }
    }
  } catch {
    // fallback to original string
  }
  return cleaned.replace(/_/g, " ");
}

export interface JustapediaPageData {
  pageId: number;
  title: string;
  wikitext: string;
  revisionId?: number;
  timestamp?: string;
  exists: boolean;
}

export async function fetchJustapediaPage(titleOrUrl: string): Promise<JustapediaPageData> {
  const pageTitle = parseJustapediaTitle(titleOrUrl);

  const params = new URLSearchParams({
    action: "query",
    prop: "revisions",
    titles: pageTitle,
    rvslots: "*",
    rvprop: "content|ids|timestamp",
    format: "json",
  });

  const response = await fetch(`${JUSTAPEDIA_API}?${params.toString()}`, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "application/json",
    },
    // Next.js cache setting
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Justapedia API returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const pages = data?.query?.pages;

  if (!pages) {
    throw new Error("Invalid response from Justapedia API");
  }

  const page = Object.values(pages)[0] as any;

  if (!page || page.missing !== undefined || page.pageid === undefined || page.pageid <= 0) {
    return {
      pageId: -1,
      title: pageTitle,
      wikitext: "",
      exists: false,
    };
  }

  const revision = page.revisions?.[0];
  const wikitext = revision?.slots?.main?.["*"] || revision?.["*"] || "";

  return {
    pageId: page.pageid,
    title: page.title,
    wikitext,
    revisionId: revision?.revid,
    timestamp: revision?.timestamp,
    exists: true,
  };
}

export async function searchJustapedia(query: string): Promise<Array<{ title: string; snippet?: string }>> {
  if (!query || query.trim().length === 0) return [];

  const params = new URLSearchParams({
    action: "query",
    list: "prefixsearch",
    pssearch: query.trim(),
    pslimit: "8",
    format: "json",
  });

  try {
    const response = await fetch(`${JUSTAPEDIA_API}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });

    if (!response.ok) return [];

    const data = await response.json();
    const searchResults = data?.query?.prefixsearch || [];

    return searchResults.map((item: any) => ({
      title: item.title,
    }));
  } catch (err) {
    console.error("Justapedia search error:", err);
    return [];
  }
}
