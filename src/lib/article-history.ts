import fs from "fs";
import path from "path";

export interface ArticleHistoryEntry {
  title: string;
  normalizedTitle: string;
  lastCheckedRevid: number;
  lastCheckedTimestamp: string;
  lastCheckedEpoch: number;
  resolvedByBot: string;
  status: "verified_healthy" | "edited_and_resolved" | "skipped_unchanged";
  issuesFound: number;
  issuesFixed: number;
  revidSaved?: number;
  diffUrl?: string;
  summary?: string;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const HISTORY_FILE = path.join(DATA_DIR, "article-history.json");
const LEGACY_RESOLVED_FILE = path.join(DATA_DIR, "resolved-articles.json");

// In-memory map for fast lookups: normalizedTitle -> ArticleHistoryEntry
const historyMap = new Map<string, ArticleHistoryEntry>();

function normalizeTitle(title: string): string {
  return title.trim().replace(/_/g, " ").toLowerCase();
}

/**
 * Load history from disk on module startup.
 * Migrates existing data from resolved-articles.json if present.
 */
function loadHistory(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // 1. Try loading main history file
    if (fs.existsSync(HISTORY_FILE)) {
      const raw = fs.readFileSync(HISTORY_FILE, "utf-8");
      const list: ArticleHistoryEntry[] = JSON.parse(raw);
      if (Array.isArray(list)) {
        list.forEach((entry) => {
          if (entry.normalizedTitle) {
            historyMap.set(entry.normalizedTitle, entry);
          }
        });
      }
    }

    // 2. Import legacy resolved-articles if not already in historyMap
    if (fs.existsSync(LEGACY_RESOLVED_FILE)) {
      const rawLegacy = fs.readFileSync(LEGACY_RESOLVED_FILE, "utf-8");
      const legacyList = JSON.parse(rawLegacy);
      if (Array.isArray(legacyList)) {
        legacyList.forEach((item: any) => {
          const norm = normalizeTitle(item.title || item.normalizedTitle || "");
          if (norm && !historyMap.has(norm)) {
            historyMap.set(norm, {
              title: item.title,
              normalizedTitle: norm,
              lastCheckedRevid: item.revid || 0,
              lastCheckedTimestamp: item.resolvedAt || new Date().toISOString(),
              lastCheckedEpoch: Date.now(),
              resolvedByBot: item.resolvedByBot || "internet-bot",
              status: item.status || "verified_healthy",
              issuesFound: item.issuesFound || 0,
              issuesFixed: item.issuesFixed || (item.status === "edited_and_resolved" ? 1 : 0),
              revidSaved: item.revid,
              summary: item.summary,
            });
          }
        });
      }
    }
  } catch (err) {
    console.warn("[ARTICLE HISTORY] Failed to load history from disk:", err);
  }
}

function persistHistory(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const list = Array.from(historyMap.values());
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(list, null, 2), "utf-8");

    // Also update legacy file for backwards compatibility
    const legacyList = list.map((e) => ({
      title: e.title,
      normalizedTitle: e.normalizedTitle,
      resolvedAt: e.lastCheckedTimestamp,
      resolvedByBot: e.resolvedByBot,
      status: e.status,
      revid: e.revidSaved || e.lastCheckedRevid,
      summary: e.summary,
    }));
    fs.writeFileSync(LEGACY_RESOLVED_FILE, JSON.stringify(legacyList, null, 2), "utf-8");
  } catch (err) {
    // Graceful fallback in serverless read-only filesystems
  }
}

// Initial load
loadHistory();

/**
 * Fast inspection to determine whether an article still requires archive links,
 * dead link rescue, or citation repairs.
 *
 * Checks for:
 * 1. Obsolete or active {{dead link}} templates.
 * 2. Corrupted or merged dates (e.g. "2013-05-14 24, 2019").
 * 3. Citation templates ({{cite web}}, {{cite news}}, etc.) lacking archive-url.
 * 4. Broken or unarchived references.
 */
export function articleNeedsArchival(wikitext: string): boolean {
  if (!wikitext || typeof wikitext !== "string") return false;

  // 1. Any {{dead link}} or {{deadlink}} template
  if (/\{\{\s*dead[ _]?link/i.test(wikitext)) {
    return true;
  }

  // 2. Corrupted or merged archive dates (e.g. "2013-05-14 24, 2019")
  if (/\|\s*archive-?date\s*=\s*\d{4}-\d{2}-\d{2}\s+\S+/i.test(wikitext)) {
    return true;
  }
  if (/\|\s*archive-?date\s*=[^|}\n]*\b(19\d\d|20\d\d)\b[^|}\n]*\b(19\d\d|20\d\d)\b/i.test(wikitext)) {
    return true;
  }

  // 3. Citation templates with external URLs lacking archive-url
  const tplRegex = /\{\{\s*([a-zA-Z0-9_ -]+)\s*\|([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\}/gi;
  let match: RegExpExecArray | null;
  while ((match = tplRegex.exec(wikitext)) !== null) {
    const rawTplName = match[1].trim().toLowerCase().replace(/_/g, " ");
    if (
      rawTplName.startsWith("cite ") ||
      rawTplName === "citation" ||
      rawTplName === "web reference"
    ) {
      const content = match[2];
      const hasUrl = /\|\s*(?:url|website)\s*=\s*https?:\/\//i.test(content);
      if (hasUrl) {
        const hasArchive = /\|\s*(?:archive-?url|archive_url)\s*=\s*https?:\/\//i.test(content);
        if (!hasArchive) {
          return true; // Still needs an archive link!
        }
      }
    }
  }

  // 4. Misplaced templates outside </ref> or duplicate consecutive tags needing single-pass resolution
  if (/<\/ref\s*>\s*\{\{(?:webarchive|dead[ _]?link|wayback)/i.test(wikitext)) {
    return true;
  }
  if (/(\{\{(?:webarchive|dead[ _]?link|wayback)[^}]*\}\})\s*(\{\{(?:webarchive|dead[ _]?link|wayback)[^}]*\}\})/i.test(wikitext)) {
    return true;
  }

  return false;
}

/**
 * Check if an article is eligible for bot inspection.
 *
 * Rules:
 * 1. If an article still needs archive links, dead link fixes, or citation repairs -> ELIGIBLE.
 * 2. If an article has already been properly fixed (all citations have archive links, zero dead links, zero issues) -> INELIGIBLE (skip, do not touch).
 * 3. If an article was modified on Justapedia (currentRevid > lastCheckedRevid) -> ELIGIBLE.
 */
export function isArticleEligibleForCheck(
  title: string,
  currentRevid?: number,
  wikitext?: string
): {
  eligible: boolean;
  reason?: string;
  previousEntry?: ArticleHistoryEntry;
} {
  if (!title) return { eligible: false, reason: "Invalid title" };

  const norm = normalizeTitle(title);
  const entry = historyMap.get(norm);

  // 1. Strict Duplicate Edit Shield:
  // If article was already checked or edited by the bot at this revision and hasn't been modified since
  if (entry && currentRevid && entry.lastCheckedRevid > 0 && currentRevid <= entry.lastCheckedRevid) {
    return {
      eligible: false,
      reason: `Article was already processed by ${entry.resolvedByBot} at revision #${entry.lastCheckedRevid} (${entry.status}). No new edits since last check.`,
      previousEntry: entry,
    };
  }

  // 2. If wikitext is available, inspect whether citations still need archive links or repairs:
  if (wikitext) {
    const needsWork = articleNeedsArchival(wikitext);
    if (needsWork) {
      // If the bot just edited and resolved this article, do NOT re-edit in a loop
      if (entry && entry.status === "edited_and_resolved" && currentRevid && currentRevid <= entry.lastCheckedRevid) {
        return {
          eligible: false,
          reason: `Article was already edited and resolved at revision #${entry.lastCheckedRevid}. Skipping to prevent duplicate edit loop.`,
          previousEntry: entry,
        };
      }

      return {
        eligible: true,
        reason: entry
          ? "Article was evaluated before, but citations still require archive links or dead link fixes."
          : "Article has citations requiring archive links or dead link repairs.",
        previousEntry: entry,
      };
    }

    // Article has zero dead links, all citations already have archive-urls, zero corruptions:
    if (entry) {
      return {
        eligible: false,
        reason: `Article is already properly fixed. All citations have archive links and zero dead links remain.`,
        previousEntry: entry,
      };
    }
  }

  if (!entry) {
    return { eligible: true }; // First time checking this article
  }

  // 3. If currentRevid is provided and greater than lastCheckedRevid
  if (currentRevid && entry.lastCheckedRevid > 0) {
    if (currentRevid > entry.lastCheckedRevid) {
      return {
        eligible: true,
        reason: `Article was modified on Justapedia (current rev #${currentRevid} > previous rev #${entry.lastCheckedRevid}). Re-evaluating.`,
        previousEntry: entry,
      };
    }
  }

  return {
    eligible: true,
    reason: "Inspecting wikitext to verify citation and archive completeness.",
    previousEntry: entry,
  };
}

/**
 * Record article evaluation and resolution in history database.
 */
export function recordArticleCheck(data: {
  title: string;
  revid: number;
  botId: string;
  status: "verified_healthy" | "edited_and_resolved" | "skipped_unchanged";
  issuesFound?: number;
  issuesFixed?: number;
  revidSaved?: number;
  diffUrl?: string;
  summary?: string;
}): ArticleHistoryEntry {
  const norm = normalizeTitle(data.title);
  const now = new Date();

  const entry: ArticleHistoryEntry = {
    title: data.title.trim(),
    normalizedTitle: norm,
    lastCheckedRevid: data.revidSaved || data.revid || 0,
    lastCheckedTimestamp: now.toLocaleTimeString() + " (" + now.toLocaleDateString() + ")",
    lastCheckedEpoch: now.getTime(),
    resolvedByBot: data.botId,
    status: data.status,
    issuesFound: data.issuesFound || 0,
    issuesFixed: data.issuesFixed || 0,
    revidSaved: data.revidSaved,
    diffUrl: data.diffUrl,
    summary: data.summary,
  };

  historyMap.set(norm, entry);
  persistHistory();
  return entry;
}

/**
 * Retrieve single article history entry
 */
export function getArticleHistoryEntry(title: string): ArticleHistoryEntry | undefined {
  return historyMap.get(normalizeTitle(title));
}

/**
 * Get paginated and filtered history for the dashboard
 */
export function getArticleHistoryList(options: {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}): {
  entries: ArticleHistoryEntry[];
  total: number;
  page: number;
  totalPages: number;
} {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(100, Math.max(1, options.limit || 50));
  const search = (options.search || "").toLowerCase().trim();
  const statusFilter = options.status;

  let all = Array.from(historyMap.values()).sort(
    (a, b) => b.lastCheckedEpoch - a.lastCheckedEpoch
  );

  if (search) {
    all = all.filter((e) => e.title.toLowerCase().includes(search));
  }

  if (statusFilter && statusFilter !== "all") {
    all = all.filter((e) => e.status === statusFilter);
  }

  const total = all.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const entries = all.slice(start, start + limit);

  return {
    entries,
    total,
    page,
    totalPages,
  };
}

/**
 * Clear history (operator utility)
 */
export function clearArticleHistory(): void {
  historyMap.clear();
  persistHistory();
}
