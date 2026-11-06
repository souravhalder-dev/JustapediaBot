import {
  isArticleEligibleForCheck,
  recordArticleCheck,
  getArticleHistoryEntry,
  getArticleHistoryList,
  clearArticleHistory,
  ArticleHistoryEntry,
} from "./article-history";

export type { ArticleHistoryEntry };

export interface ResolvedArticleRecord {
  title: string;
  normalizedTitle: string;
  resolvedAt: string;
  resolvedByBot: string;
  status: "verified_healthy" | "edited_and_resolved";
  revid?: number;
  summary?: string;
}

export function normalizeArticleTitle(title: string): string {
  return title.trim().replace(/_/g, " ").toLowerCase();
}

/**
 * Checks if an article has already been resolved and has not been modified since.
 */
export function isArticleResolved(title: string, currentRevid?: number): boolean {
  const check = isArticleEligibleForCheck(title, currentRevid);
  return !check.eligible;
}

export function getResolvedArticleRecord(title: string): ResolvedArticleRecord | undefined {
  const entry = getArticleHistoryEntry(title);
  if (!entry) return undefined;
  return {
    title: entry.title,
    normalizedTitle: entry.normalizedTitle,
    resolvedAt: entry.lastCheckedTimestamp,
    resolvedByBot: entry.resolvedByBot,
    status: entry.status === "edited_and_resolved" ? "edited_and_resolved" : "verified_healthy",
    revid: entry.revidSaved || entry.lastCheckedRevid,
    summary: entry.summary,
  };
}

export function markArticleResolved(record: {
  title: string;
  resolvedAt?: string;
  resolvedByBot: string;
  status: "verified_healthy" | "edited_and_resolved";
  revid?: number;
  summary?: string;
}): ResolvedArticleRecord {
  const entry = recordArticleCheck({
    title: record.title,
    revid: record.revid || 0,
    botId: record.resolvedByBot,
    status: record.status,
    revidSaved: record.revid,
    summary: record.summary,
  });

  return {
    title: entry.title,
    normalizedTitle: entry.normalizedTitle,
    resolvedAt: entry.lastCheckedTimestamp,
    resolvedByBot: entry.resolvedByBot,
    status: entry.status === "edited_and_resolved" ? "edited_and_resolved" : "verified_healthy",
    revid: entry.revidSaved,
    summary: entry.summary,
  };
}

export function getAllResolvedArticles(): ResolvedArticleRecord[] {
  const list = getArticleHistoryList({ limit: 1000 });
  return list.entries.map((e) => ({
    title: e.title,
    normalizedTitle: e.normalizedTitle,
    resolvedAt: e.lastCheckedTimestamp,
    resolvedByBot: e.resolvedByBot,
    status: e.status === "edited_and_resolved" ? "edited_and_resolved" : "verified_healthy",
    revid: e.revidSaved || e.lastCheckedRevid,
    summary: e.summary,
  }));
}

export function clearAllResolvedArticles(): void {
  clearArticleHistory();
}
