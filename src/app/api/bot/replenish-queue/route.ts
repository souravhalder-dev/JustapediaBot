import { NextRequest, NextResponse } from "next/server";
import { isArticleResolved } from "@/lib/resolved-articles";

const JUSTAPEDIA_API = "https://justapedia.org/api.php";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const dynamic = "force-dynamic";

interface BotCategoryConfig {
  categories: string[];
}

const BOT_SOURCES: Record<string, BotCategoryConfig> = {
  "internet-bot": {
    categories: [
      "Category:All articles with dead external links",
      "Category:Articles with permanently dead external links",
      "Category:Articles with dead external links",
      "Category:Articles with bare URLs for citations",
    ],
  },
  "birth-update-bot": {
    categories: [
      "Category:Living people",
      "Category:Year of birth missing",
      "Category:Year of death missing",
    ],
  },
  "citation-verifier-bot": {
    categories: [
      "Category:All articles with bare URLs for citations",
      "Category:Articles with bare URLs for citations",
    ],
  },
  "category-maintenance-bot": {
    categories: [
      "Category:All uncategorized pages",
      "Category:Uncategorized",
    ],
  },
};

export async function GET(req: NextRequest) {
  try {
    const botId = req.nextUrl.searchParams.get("botId") || "internet-bot";
    const requestedLimit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
    const limit = Math.min(Math.max(requestedLimit, 10), 100);
    const customCategory = req.nextUrl.searchParams.get("category");

    const accumulatedArticles = new Set<string>();
    const sourcesUsed: string[] = [];

    // 1. If custom category provided or bot has defined categories, fetch from them
    const categoriesToTry: string[] = [];
    if (customCategory) {
      categoriesToTry.push(customCategory.startsWith("Category:") ? customCategory : `Category:${customCategory}`);
    }
    const defaultCats = BOT_SOURCES[botId]?.categories || [];
    for (const c of defaultCats) {
      if (!categoriesToTry.includes(c)) categoriesToTry.push(c);
    }

    for (const cat of categoriesToTry) {
      if (accumulatedArticles.size >= limit) break;

      try {
        const catUrl = `${JUSTAPEDIA_API}?action=query&list=categorymembers&cmtitle=${encodeURIComponent(cat)}&cmlimit=100&cmtype=page&format=json`;
        const res = await fetch(catUrl, {
          headers: { "User-Agent": USER_AGENT },
          cache: "no-store",
        });

        if (res.ok) {
          const data = await res.json();
          const members = data?.query?.categorymembers || [];
          let addedFromCat = 0;

          for (const m of members) {
            const title = m.title as string;
            if (!title) continue;
            // Strict duplicate guard: exclude any article that has already been resolved by any bot
            if (!isArticleResolved(title) && !accumulatedArticles.has(title)) {
              accumulatedArticles.add(title);
              addedFromCat++;
              if (accumulatedArticles.size >= limit) break;
            }
          }

          if (addedFromCat > 0) {
            sourcesUsed.push(`${cat} (${addedFromCat})`);
          }
        }
      } catch (catErr) {
        console.warn(`[REPLENISH] Error querying category ${cat}:`, catErr);
      }
    }

    // 2. If category search produced fewer than requested, replenish with random encyclopedia articles
    if (accumulatedArticles.size < limit) {
      try {
        const randomUrl = `${JUSTAPEDIA_API}?action=query&list=random&rnnamespace=0&rnlimit=50&format=json`;
        const res = await fetch(randomUrl, {
          headers: { "User-Agent": USER_AGENT },
          cache: "no-store",
        });

        if (res.ok) {
          const data = await res.json();
          const randomPages = data?.query?.random || [];
          let addedRandom = 0;

          for (const p of randomPages) {
            const title = p.title as string;
            if (!title) continue;
            if (!isArticleResolved(title) && !accumulatedArticles.has(title)) {
              accumulatedArticles.add(title);
              addedRandom++;
              if (accumulatedArticles.size >= limit) break;
            }
          }

          if (addedRandom > 0) {
            sourcesUsed.push(`Random Main Articles (${addedRandom})`);
          }
        }
      } catch (randErr) {
        console.warn("[REPLENISH] Error querying random articles:", randErr);
      }
    }

    // 3. Guaranteed fallback sample list if offline or API restricted
    if (accumulatedArticles.size === 0) {
      const fallbackList = [
        "Ada Lovelace",
        "Alan Turing",
        "Marie Curie",
        "Carl Sagan",
        "Stephen Hawking",
        "Richard Feynman",
        "Hypatia",
        "Grace Hopper",
        "Katherine Johnson",
        "Chien-Shiung Wu",
        "Barbara McClintock",
        "Charles Darwin",
        "Galileo Galilei",
        "Johannes Kepler",
        "Enrico Fermi",
        "Niels Bohr",
        "Max Planck",
        "Erwin Schrödinger",
        "Louis Pasteur",
        "Alexander Fleming",
      ];

      for (const t of fallbackList) {
        if (!isArticleResolved(t)) {
          accumulatedArticles.add(t);
        }
      }
      sourcesUsed.push("Curated Justapedia Articles");
    }

    const finalArticles = Array.from(accumulatedArticles);

    return NextResponse.json({
      success: true,
      botId,
      count: finalArticles.length,
      articles: finalArticles,
      sourcesUsed: sourcesUsed.join(", "),
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: `Failed to replenish queue: ${error.message}` },
      { status: 500 }
    );
  }
}
