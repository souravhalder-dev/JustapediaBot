import { fetchJustapediaPage } from "./justapedia";
import {
  extractLinksFromWikitext,
  patchCitationTemplate,
  removeDeadLinkTag,
  tagDeadLink,
  ParsedItem,
} from "./parser";
import { checkUrlHealth, LinkCheckOutcome } from "./link-checker";
import {
  findBestWaybackSnapshot,
  formatWaybackDate,
  validateArchiveSnapshot,
  repairBrokenArchiveUrl,
  requestWaybackSave,
  parseArchiveUrl,
  WaybackSnapshot,
} from "./wayback";

export interface IABotRunOptions {
  archiveWorkingLinks?: boolean;
  repairBrokenArchives?: boolean;
  tagUnrecoverableDead?: boolean;
  maxLinksPerPage?: number;
  useSandbox?: boolean;
}

export interface IABotStats {
  referencesChecked: number;
  deadLinksDetected: number;
  archiveLinksAdded: number;
  archiveLinksRepaired: number;
  newSnapshotsRequested: number;
  unrecoverableLinksTagged: number;
  articlesModified: number;
}

export interface IABotProcessResult {
  title: string;
  modified: boolean;
  originalWikitext: string;
  fixedWikitext: string;
  summary: string;
  stats: IABotStats;
  details: string[];
}

function isMalformedArchiveDate(dateStr?: string): boolean {
  if (!dateStr || dateStr.trim().length === 0) return true;
  const s = dateStr.trim();
  // Check if multiple years exist e.g. "2013-05-14 24, 2019"
  const yearMatches = s.match(/\b(19\d\d|20\d\d)\b/g);
  if (yearMatches && yearMatches.length > 1) return true;
  // Check if contains ISO date followed by extra characters
  if (/^\d{4}-\d{2}-\d{2}\s+\S+/.test(s)) return true;
  return false;
}

/**
 * Wikipedia InternetArchiveBot Replicated Core Processing Engine for Justapedia
 * Follows Wikipedia IABot's full decision-making matrix and workflows.
 */
export async function processArticleWithIABot(
  title: string,
  options: IABotRunOptions = {}
): Promise<IABotProcessResult> {
  const {
    archiveWorkingLinks = false,
    repairBrokenArchives = true,
    tagUnrecoverableDead = true,
    maxLinksPerPage = 12,
  } = options;

  const stats: IABotStats = {
    referencesChecked: 0,
    deadLinksDetected: 0,
    archiveLinksAdded: 0,
    archiveLinksRepaired: 0,
    newSnapshotsRequested: 0,
    unrecoverableLinksTagged: 0,
    articlesModified: 0,
  };

  const details: string[] = [];

  const page = await fetchJustapediaPage(title);
  if (!page.exists || !page.wikitext.trim()) {
    return {
      title,
      modified: false,
      originalWikitext: "",
      fixedWikitext: "",
      summary: "",
      stats,
      details: [`Page "${title}" does not exist or has empty wikitext on Justapedia.`],
    };
  }

  const originalWikitext = page.wikitext;
  let currentWikitext = originalWikitext;

  // 1. Extract all citation templates, references, and external links
  const links = extractLinksFromWikitext(currentWikitext);
  const linksToProcess = links.slice(0, maxLinksPerPage);

  interface LinkItemFix {
    target: string;
    replacement: string;
    statType: "added" | "repaired" | "tagged";
    detail: string;
    removeDeadTag?: boolean;
  }

  // 2. Process all references in parallel with Promise.all for high-performance bot execution
  const results = await Promise.all(
    linksToProcess.map(async (item): Promise<LinkItemFix | null> => {
      // ------------------------------------------------------------------------
      // CASE A: Citation already has an archive link -> Check for repair & date integrity
      // ------------------------------------------------------------------------
      if (item.citationTemplate?.archiveUrl && repairBrokenArchives) {
        const existingArchive = item.citationTemplate.archiveUrl;
        const existingArchiveDate = item.citationTemplate.archiveDate;
        const isAlive = await validateArchiveSnapshot(existingArchive);

        if (!isAlive) {
          // Attempt to repair broken archive by finding alternative CDX capture
          const replacement = await repairBrokenArchiveUrl(existingArchive, item.url);
          if (replacement && replacement.available) {
            const sampleDate = item.citationTemplate?.citationDate || item.citationTemplate?.accessDate;
            const newArchiveDate = formatWaybackDate(replacement.timestamp, sampleDate);
            const patched = patchCitationTemplate(
              item.citationTemplate,
              replacement.url,
              newArchiveDate,
              "dead"
            );

            if (patched !== item.citationTemplate.rawString) {
              return {
                target: item.citationTemplate.rawString,
                replacement: patched,
                statType: "repaired",
                detail: `Repaired broken archive on "${item.url}" -> ${replacement.url} (${newArchiveDate})`,
              };
            }
          }
        } else if (isMalformedArchiveDate(existingArchiveDate)) {
          // Existing archive URL is alive, but archive-date is corrupted (e.g. merged "2013-05-14 24, 2019") or missing
          const parsedArch = parseArchiveUrl(existingArchive);
          let fixedDate = "";
          const sampleDate = item.citationTemplate?.citationDate || item.citationTemplate?.accessDate || existingArchiveDate;
          if (parsedArch.timestamp) {
            fixedDate = formatWaybackDate(parsedArch.timestamp, sampleDate);
          } else {
            const snap = await findBestWaybackSnapshot(item.url, sampleDate);
            if (snap && snap.available) {
              fixedDate = formatWaybackDate(snap.timestamp, sampleDate);
            }
          }

          if (fixedDate) {
            const patched = patchCitationTemplate(
              item.citationTemplate,
              existingArchive,
              fixedDate,
              item.citationTemplate.urlStatus || "dead"
            );

            if (patched !== item.citationTemplate.rawString) {
              return {
                target: item.citationTemplate.rawString,
                replacement: patched,
                statType: "repaired",
                detail: `Repaired corrupted archive-date in {{${item.citationTemplate.templateName}}} on "${item.url}" -> ${fixedDate}`,
              };
            }
          }
        }
        return null;
      }

      // ------------------------------------------------------------------------
      // CASE A.2: Bare reference or external link ALREADY HAS an archive link
      // ------------------------------------------------------------------------
      if (item.hasArchive && (item.linkType === "reference" || item.linkType === "external")) {
        if (item.linkType === "reference") {
          const refOpenMatch = item.rawString.match(/^<ref(?:\s+[^>]*)?>/i);
          const refCloseIdx = item.rawString.indexOf("</ref>");
          if (refOpenMatch && refCloseIdx !== -1) {
            const refOpen = refOpenMatch[0];
            let inner = item.rawString.substring(refOpen.length, refCloseIdx);
            const trailing = item.rawString.substring(refCloseIdx + 6);

            // Find best existing webarchive from trailing or inner
            const waMatch =
              trailing.match(/\{\{\s*webarchive\s*\|[^{}]*\}\}/i) ||
              inner.match(/\{\{\s*webarchive\s*\|[^{}]*\}\}/i);
            const waTag = waMatch ? waMatch[0].trim() : "";

            // Strip any obsolete {{dead link}} templates
            inner = inner.replace(/\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/gi, "").trim();

            // Clean any inner webarchive to prevent duplicates
            inner = inner.replace(/\s*\{\{\s*webarchive\s*\|[^{}]*\}\}/gi, "").trim();

            if (waTag) {
              inner = `${inner} ${waTag}`;
            }

            const patched = `${refOpen}${inner}</ref>`;
            if (patched !== item.rawString) {
              return {
                target: item.rawString,
                replacement: patched,
                statType: "repaired",
                detail: `Cleaned up reference on "${item.url}": removed obsolete {{dead link}} and consolidated archive inside <ref>`,
                removeDeadTag: true,
              };
            }
          }
        }
        return null;
      }

      // ------------------------------------------------------------------------
      // CASE B: Determine URL health (Fast path: if already tagged {{dead link}}, skip HTTP ping)
      // ------------------------------------------------------------------------
      let isDead = item.hasDeadTag;
      let isAlive = false;

      if (!isDead) {
        const health = await checkUrlHealth(item.url);
        isDead = health.isPermanentDead;
        isAlive = health.status === "alive";
      }

      // ------------------------------------------------------------------------
      // CASE C: URL is DEAD (tagged dead, 404, 410, DNS fail, or soft 404)
      // ------------------------------------------------------------------------
      if (isDead) {
        // Search Wayback Machine CDX API for best snapshot (matching citation date if present)
        const targetDate = item.citationDate || item.accessDate;
        const snapshot = await findBestWaybackSnapshot(item.url, targetDate);

        if (snapshot && snapshot.available) {
          const sampleDate = item.citationTemplate?.archiveDate || item.citationTemplate?.citationDate || item.citationTemplate?.accessDate || targetDate;
          const archiveDate = formatWaybackDate(snapshot.timestamp, sampleDate);

          if (item.citationTemplate) {
            // 1. Patch Citation Template ({{cite web}}, {{cite news}}, etc.)
            const patched = patchCitationTemplate(
              item.citationTemplate,
              snapshot.url,
              archiveDate,
              "dead"
            );

            if (patched !== item.citationTemplate.rawString) {
              return {
                target: item.citationTemplate.rawString,
                replacement: patched,
                statType: "added",
                detail: `Rescued dead link in {{${item.citationTemplate.templateName}}} on "${item.url}" with Wayback snapshot (${archiveDate})`,
                removeDeadTag: true,
              };
            }
          } else if (item.linkType === "reference") {
            // 2. Patch Bare Reference: {{webarchive}} MUST be placed INSIDE <ref>, before </ref>
            const refOpenMatch = item.rawString.match(/^<ref(?:\s+[^>]*)?>/i);
            const refCloseIdx = item.rawString.indexOf("</ref>");

            if (refOpenMatch && refCloseIdx !== -1) {
              const refOpen = refOpenMatch[0];
              let inner = item.rawString.substring(refOpen.length, refCloseIdx);

              // Strip any dead link tags from inner
              inner = inner.replace(/\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/gi, "").trim();

              // Clean any inner webarchive to prevent duplicates
              inner = inner.replace(/\s*\{\{\s*webarchive\s*\|[^{}]*\}\}/gi, "").trim();

              // Add {{webarchive}} inside <ref>, before </ref>
              const webArchiveTag = `{{webarchive |url=${snapshot.url} |date=${archiveDate}}}`;
              const patched = `${refOpen}${inner} ${webArchiveTag}</ref>`;

              if (patched !== item.rawString) {
                return {
                  target: item.rawString,
                  replacement: patched,
                  statType: "added",
                  detail: `Rescued dead link with {{webarchive}} on "${item.url}" (${archiveDate}) inside <ref>`,
                  removeDeadTag: true,
                };
              }
            }
            return null;
          } else if (item.linkType === "external") {
            // 3. Patch External Link: Add {{webarchive}} after link
            let cleanRaw = item.rawString.replace(/\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/gi, "").trim();
            const webArchiveTag = ` {{webarchive |url=${snapshot.url} |date=${archiveDate}}}`;
            const patched = `${cleanRaw}${webArchiveTag}`;

            if (patched !== item.rawString) {
              return {
                target: item.rawString,
                replacement: patched,
                statType: "added",
                detail: `Rescued external link with {{webarchive}} on "${item.url}" (${archiveDate})`,
                removeDeadTag: true,
              };
            }
            return null;
          }
        } else if (tagUnrecoverableDead && !item.hasDeadTag && !item.hasArchive) {
          // No archive snapshot exists anywhere on Wayback: Tag as unrecoverable dead link
          const tagged = tagDeadLink(item.rawString);
          if (tagged !== item.rawString) {
            return {
              target: item.rawString,
              replacement: tagged,
              statType: "tagged",
              detail: `Tagged unrecoverable dead link on "${item.url}" with {{dead link}}`,
            };
          }
        }
        return null;
      }

      // ------------------------------------------------------------------------
      // CASE D: URL is ALIVE -> Archive Working Links (if enabled)
      // ------------------------------------------------------------------------
      if (isAlive && archiveWorkingLinks && !item.hasArchive) {
        requestWaybackSave(item.url).catch(() => {});
        const targetDate = item.citationDate || item.accessDate;
        const snapshot = await findBestWaybackSnapshot(item.url, targetDate);
        if (snapshot && snapshot.available && item.citationTemplate) {
          const sampleDate = item.citationTemplate.archiveDate || item.citationTemplate.citationDate || item.citationTemplate.accessDate || targetDate;
          const archiveDate = formatWaybackDate(snapshot.timestamp, sampleDate);
          const patched = patchCitationTemplate(
            item.citationTemplate,
            snapshot.url,
            archiveDate,
            "live"
          );
          if (patched !== item.citationTemplate.rawString) {
            return {
              target: item.citationTemplate.rawString,
              replacement: patched,
              statType: "added",
              detail: `Archived live reference in {{${item.citationTemplate.templateName}}} on "${item.url}" with Wayback snapshot (${archiveDate})`,
            };
          }
        }
      }

      return null;
    })
  );

  // Apply all patches in memory
  stats.referencesChecked = linksToProcess.length;
  for (const res of results) {
    if (!res) continue;
    if (res.statType === "added") {
      stats.archiveLinksAdded++;
      stats.deadLinksDetected++;
    }
    if (res.statType === "repaired") {
      stats.archiveLinksRepaired++;
    }
    if (res.statType === "tagged") {
      stats.unrecoverableLinksTagged++;
      stats.deadLinksDetected++;
    }
    details.push(res.detail);

    if (currentWikitext.includes(res.target)) {
      currentWikitext = currentWikitext.replace(res.target, res.replacement);
      if (res.removeDeadTag) {
        currentWikitext = removeDeadLinkTag(currentWikitext, res.replacement);
      }
    }
  }

  // Deduplicate and consolidate any trailing or misplaced archive and dead link templates in the entire wikitext
  const cleanedDuplicates = cleanupWikitextDuplicateTemplates(currentWikitext);
  if (cleanedDuplicates !== currentWikitext) {
    currentWikitext = cleanedDuplicates;
    details.push("Cleaned up duplicate archive and dead link templates and consolidated references inside <ref>");
  }

  // --------------------------------------------------------------------------
  // Summary & Modification Verification
  // --------------------------------------------------------------------------
  const isModified = currentWikitext !== originalWikitext;
  if (isModified) {
    stats.articlesModified = 1;
  }

  // Generate official Wikipedia InternetArchiveBot edit summary
  const summaryParts: string[] = [];
  if (stats.archiveLinksAdded > 0) {
    summaryParts.push(`Rescued ${stats.archiveLinksAdded} source${stats.archiveLinksAdded > 1 ? "s" : ""}`);
  }
  if (stats.archiveLinksRepaired > 0) {
    summaryParts.push(`Repaired ${stats.archiveLinksRepaired} archive link${stats.archiveLinksRepaired > 1 ? "s" : ""}`);
  }
  if (stats.unrecoverableLinksTagged > 0) {
    summaryParts.push(`Tagged ${stats.unrecoverableLinksTagged} dead link${stats.unrecoverableLinksTagged > 1 ? "s" : ""}`);
  }
  if (stats.newSnapshotsRequested > 0) {
    summaryParts.push(`Archived ${stats.newSnapshotsRequested} live link${stats.newSnapshotsRequested > 1 ? "s" : ""}`);
  }

  const editSummary = summaryParts.length > 0
    ? `InternetArchiveBot: ${summaryParts.join("; ")}`
    : `InternetArchiveBot: Verified reference integrity (no changes required)`;

  return {
    title,
    modified: isModified,
    originalWikitext,
    fixedWikitext: currentWikitext,
    summary: editSummary,
    stats,
    details: details.length > 0 ? details : [`All ${stats.referencesChecked} reference(s) checked on "${title}" are healthy.`],
  };
}

/**
 * Deduplicate and clean misplaced archive and dead link templates in wikitext:
 * 1. Move any {{webarchive}} or {{wayback}} sitting outside </ref> back inside <ref>
 * 2. Strip obsolete {{dead link}} templates inside or outside references that already have archives
 * 3. Move misplaced {{dead link}} outside </ref> back inside <ref>
 * 4. Strip {{dead link}} immediately before or after {{webarchive}} / {{wayback}}
 * 5. Deduplicate multiple {{webarchive}} or {{dead link}} inside the same <ref> tag
 * 6. Deduplicate consecutive duplicate templates anywhere in the article
 */
export function cleanupWikitextDuplicateTemplates(wikitext: string): string {
  let cleaned = wikitext;

  // 1. Move misplaced {{webarchive}} / {{wayback}} outside </ref> back inside <ref>
  const refOutsideWaRegex = /(<ref(?:\s+[^>]*)?>)([\s\S]*?)(<\/ref\s*>)((?:\s*\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\})+)/gi;
  cleaned = cleaned.replace(refOutsideWaRegex, (_match, refOpen, inner, refClose, trailingWa) => {
    let cleanInner = inner.replace(/\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/gi, "").trim();
    const firstWaMatch = trailingWa.match(/\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\}/i);
    const waTag = firstWaMatch ? firstWaMatch[0].trim() : "";
    if (!/\{\{\s*(?:webarchive|wayback)/i.test(cleanInner) && waTag) {
      cleanInner = `${cleanInner} ${waTag}`;
    }
    return `${refOpen}${cleanInner}${refClose}`;
  });

  // 2. Move misplaced {{dead link}} outside </ref> back inside <ref> (or strip if ref has archive)
  const refOutsideDlRegex = /(<ref(?:\s+[^>]*)?>)([\s\S]*?)(<\/ref\s*>)((?:\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\})+)/gi;
  cleaned = cleaned.replace(refOutsideDlRegex, (_match, refOpen, inner, refClose, trailingDl) => {
    const hasArchive = /\|\s*(?:archive-?url|archive_url)\s*=\s*https?:\/\/|\{\{\s*(?:webarchive|wayback)/i.test(inner);
    if (hasArchive) {
      return `${refOpen}${inner}${refClose}`;
    }
    const firstDl = trailingDl.match(/\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/i);
    const dlTag = firstDl ? firstDl[0].trim() : "";
    let cleanInner = inner.replace(/\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/gi, "").trim();
    if (dlTag && !/\{\{\s*dead[ _]?link/i.test(cleanInner)) {
      cleanInner = `${cleanInner} ${dlTag}`;
    }
    return `${refOpen}${cleanInner}${refClose}`;
  });

  // 3. Strip dead link immediately before or after webarchive / wayback anywhere
  cleaned = cleaned.replace(
    /\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}\s*(\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\})/gi,
    "$1"
  );
  cleaned = cleaned.replace(
    /(\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\})\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/gi,
    "$1"
  );

  // 4. Inside every <ref ...> ... </ref>, sanitize and consolidate
  const singleRefRegex = /(<ref(?:\s+[^>]*)?>)([\s\S]*?)(<\/ref\s*>)/gi;
  cleaned = cleaned.replace(singleRefRegex, (_match, refOpen, inner, refClose) => {
    const hasArchive = /\|\s*(?:archive-?url|archive_url)\s*=\s*https?:\/\/|\{\{\s*(?:webarchive|wayback)/i.test(inner);
    if (hasArchive) {
      // Strip any {{dead link}} inside ref
      inner = inner.replace(/\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/gi, "");
    }

    // Deduplicate multiple {{dead link}} inside ref: keep at most one
    const dlMatches = inner.match(/\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/gi);
    if (dlMatches && dlMatches.length > 1) {
      const firstDl = dlMatches[0];
      inner = inner.replace(/\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/gi, "");
      inner = `${inner.trim()} ${firstDl}`;
    }

    // Deduplicate multiple {{webarchive}} or {{wayback}} inside ref: keep at most one
    const waMatches = inner.match(/\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\}/gi);
    if (waMatches && waMatches.length > 1) {
      const firstWa = waMatches[0];
      inner = inner.replace(/\s*\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\}/gi, "");
      inner = `${inner.trim()} ${firstWa}`;
    }

    return `${refOpen}${inner}${refClose}`;
  });

  // 5. Clean any consecutive identical templates in main body text
  cleaned = cleaned.replace(/(\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}\s*)\1+/gi, "$1");
  cleaned = cleaned.replace(/(\{\{\s*(?:webarchive|wayback)\s*\|[^{}]*\}\}\s*)\1+/gi, "$1");

  return cleaned;
}

// Backwards-compatible alias
export const cleanupWikitextDuplicateArchives = cleanupWikitextDuplicateTemplates;
