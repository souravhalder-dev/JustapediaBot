import fs from "fs";
import path from "path";

export interface ResolvedArticleRecord {
  title: string;
  normalizedTitle: string;
  resolvedAt: string;
  resolvedByBot: string;
  status: "verified_healthy" | "edited_and_resolved";
  revid?: number;
  summary?: string;
}

// In-memory registry of resolved articles
const resolvedArticlesMap = new Map<string, ResolvedArticleRecord>();

// Path for server-side persistence
const DATA_DIR = path.join(process.cwd(), ".data");
const RESOLVED_FILE = path.join(DATA_DIR, "resolved-articles.json");

// Load on initialization if file exists
function loadPersistedResolvedArticles(): void {
  try {
    if (fs.existsSync(RESOLVED_FILE)) {
      const raw = fs.readFileSync(RESOLVED_FILE, "utf-8");
      const list: ResolvedArticleRecord[] = JSON.parse(raw);
      if (Array.isArray(list)) {
        list.forEach((rec) => {
          if (rec.normalizedTitle) {
            resolvedArticlesMap.set(rec.normalizedTitle, rec);
          }
        });
      }
    }
  } catch (err) {
    // Graceful fallback to memory
  }
}

function persistResolvedArticles(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const list = Array.from(resolvedArticlesMap.values());
    fs.writeFileSync(RESOLVED_FILE, JSON.stringify(list, null, 2), "utf-8");
  } catch (err) {
    // Ignore filesystem persistence error in serverless environments
  }
}

// Initial load
loadPersistedResolvedArticles();

/**
 * Standardize title for case-insensitive and underscore/space-agnostic matching
 */
export function normalizeArticleTitle(title: string): string {
  return title.trim().replace(/_/g, " ").toLowerCase();
}

/**
 * Checks if an article has already been resolved (either verified healthy or edited & resolved)
 */
export function isArticleResolved(title: string): boolean {
  if (!title) return false;
  return resolvedArticlesMap.has(normalizeArticleTitle(title));
}

/**
 * Retrieves the resolution record for an article
 */
export function getResolvedArticleRecord(title: string): ResolvedArticleRecord | undefined {
  if (!title) return undefined;
  return resolvedArticlesMap.get(normalizeArticleTitle(title));
}

/**
 * Marks an article as permanently resolved across all bots
 */
export function markArticleResolved(
  record: Omit<ResolvedArticleRecord, "normalizedTitle">
): ResolvedArticleRecord {
  const norm = normalizeArticleTitle(record.title);
  const fullRecord: ResolvedArticleRecord = {
    ...record,
    normalizedTitle: norm,
  };
  resolvedArticlesMap.set(norm, fullRecord);
  persistResolvedArticles();
  return fullRecord;
}

/**
 * Returns all resolved articles
 */
export function getAllResolvedArticles(): ResolvedArticleRecord[] {
  return Array.from(resolvedArticlesMap.values());
}

/**
 * Clears the resolved articles cache (e.g. for re-auditing)
 */
export function clearAllResolvedArticles(): void {
  resolvedArticlesMap.clear();
  try {
    if (fs.existsSync(RESOLVED_FILE)) {
      fs.unlinkSync(RESOLVED_FILE);
    }
  } catch {
    // ignore
  }
}
