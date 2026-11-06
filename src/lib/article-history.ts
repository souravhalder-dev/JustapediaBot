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
 * Check if an article is eligible for bot inspection.
 *
 * Rule:
 * 1. If never checked before -> ELIGIBLE.
 * 2. If checked before and currentRevid <= lastCheckedRevid -> INELIGIBLE (skip, no changes detected).
 * 3. If checked before but currentRevid > lastCheckedRevid -> ELIGIBLE (article was modified on Justapedia).
 */
export function isArticleEligibleForCheck(
  title: string,
  currentRevid?: number
): {
  eligible: boolean;
  reason?: string;
  previousEntry?: ArticleHistoryEntry;
} {
  if (!title) return { eligible: false, reason: "Invalid title" };

  const norm = normalizeTitle(title);
  const entry = historyMap.get(norm);

  if (!entry) {
    return { eligible: true }; // First time checking this article
  }

  // If currentRevid is provided, compare with last checked revid
  if (currentRevid && entry.lastCheckedRevid > 0) {
    if (currentRevid <= entry.lastCheckedRevid) {
      return {
        eligible: false,
        reason: `Article already evaluated at rev #${entry.lastCheckedRevid} (${entry.status === "verified_healthy" ? "verified clean" : "edited & resolved"}). No subsequent revisions found on Justapedia.`,
        previousEntry: entry,
      };
    }
    // Article has a newer revision ID on Justapedia! Re-evaluate it.
    return {
      eligible: true,
      reason: `Article was modified on Justapedia (current rev #${currentRevid} > previous rev #${entry.lastCheckedRevid}). Re-evaluating.`,
      previousEntry: entry,
    };
  }

  // If no currentRevid was passed, default to ineligible if already recorded
  return {
    eligible: false,
    reason: `Article was already processed on ${entry.lastCheckedTimestamp} by ${entry.resolvedByBot}.`,
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
