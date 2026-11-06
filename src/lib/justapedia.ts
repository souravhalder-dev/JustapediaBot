import { executeBridgeRequest } from "./justapedia-bridge";

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

  let data: any = null;
  try {
    const response = await fetch(`${JUSTAPEDIA_API}?${params.toString()}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      cache: "no-store",
    });

    if (response.ok) {
      data = await response.json();
    }
  } catch (fetchErr) {
    console.warn(`[JUSTAPEDIA FETCH] Direct fetch error for ${pageTitle}, falling back to bridge:`, fetchErr);
  }

  // Cloudflare fallback via curl_cffi Chrome bridge
  if (!data?.query?.pages) {
    const bridgeResp = await executeBridgeRequest<any>({
      method: "GET",
      params: Object.fromEntries(params.entries()),
    });
    if (bridgeResp.status === 200 && bridgeResp.data) {
      data = bridgeResp.data;
    } else {
      throw new Error(`Justapedia API returned HTTP ${bridgeResp.status || 500}: ${bridgeResp.error || "Unable to reach Justapedia API"}`);
    }
  }
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

/**
 * Fetch member articles of any Justapedia category (e.g. Category:All articles with dead external links)
 * Matches Wikipedia IABot category crawling workflow
 */
export async function fetchCategoryMembers(
  categoryTitle: string,
  limit: number = 50,
  cmcontinue?: string
): Promise<{ members: string[]; cmcontinue?: string }> {
  let cat = categoryTitle.trim();
  if (!cat.toLowerCase().startsWith("category:")) {
    cat = `Category:${cat}`;
  }

  const params = new URLSearchParams({
    action: "query",
    list: "categorymembers",
    cmtitle: cat,
    cmlimit: String(Math.min(limit, 100)),
    cmtype: "page",
    format: "json",
  });

  if (cmcontinue) {
    params.append("cmcontinue", cmcontinue);
  }

  try {
    let data: any = null;
    const response = await fetch(`${JUSTAPEDIA_API}?${params.toString()}`, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });

    if (response.ok) {
      data = await response.json();
    } else {
      const bridgeResp = await executeBridgeRequest<any>({
        method: "GET",
        params: Object.fromEntries(params.entries()),
      });
      if (bridgeResp.status === 200 && bridgeResp.data) {
        data = bridgeResp.data;
      }
    }

    if (!data) return { members: [] };

    const membersList = data?.query?.categorymembers || [];
    const nextContinue = data?.continue?.cmcontinue;

    const titles = membersList.map((m: any) => m.title as string);
    return {
      members: titles,
      cmcontinue: nextContinue,
    };
  } catch {
    return { members: [] };
  }
}

/**
 * Fetch articles embedding/transcluding a Justapedia template (e.g. Template:Dead link)
 */
export async function fetchTemplateTransclusions(
  templateTitle: string = "Template:Dead link",
  limit: number = 50,
  eicontinue?: string
): Promise<{ members: string[]; eicontinue?: string }> {
  let tpl = templateTitle.trim();
  if (!tpl.toLowerCase().startsWith("template:")) {
    tpl = `Template:${tpl}`;
  }

  const params = new URLSearchParams({
    action: "query",
    list: "embeddedin",
    eititle: tpl,
    eilimit: String(Math.min(limit, 100)),
    einamespace: "0", // Main article namespace only
    format: "json",
  });

  if (eicontinue) {
    params.append("eicontinue", eicontinue);
  }

  try {
    const response = await fetch(`${JUSTAPEDIA_API}?${params.toString()}`, {
      headers: DEFAULT_HEADERS,
      cache: "no-store",
    });

    if (response.ok) {
      const data = await response.json();
      const list = data?.query?.embeddedin || [];
      return {
        members: list.map((m: any) => m.title as string),
        eicontinue: data?.continue?.eicontinue,
      };
    }
  } catch (err) {
    console.error("[TEMPLATE TRANSCLUSIONS ERROR]", err);
  }
  return { members: [] };
}
