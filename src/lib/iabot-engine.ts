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

  for (const item of linksToProcess) {
    stats.referencesChecked++;

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
            currentWikitext = currentWikitext.replace(item.citationTemplate.rawString, patched);
            stats.archiveLinksRepaired++;
            details.push(`Repaired broken archive on "${item.url}" -> ${replacement.url} (${newArchiveDate})`);
            continue;
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
            currentWikitext = currentWikitext.replace(item.citationTemplate.rawString, patched);
            stats.archiveLinksRepaired++;
            details.push(`Repaired corrupted archive-date in {{${item.citationTemplate.templateName}}} on "${item.url}" -> ${fixedDate}`);
            continue;
          }
        }
      } else {
        // Existing archive is healthy and date is valid; no modification needed
        continue;
      }
    }

    // ------------------------------------------------------------------------
    // CASE B: Check original URL health
    // ------------------------------------------------------------------------
    const health = await checkUrlHealth(item.url);

    // ------------------------------------------------------------------------
    // CASE C: URL is DEAD (404, 410, DNS fail, Connection refused, or soft 404)
    // ------------------------------------------------------------------------
    if (health.isPermanentDead) {
      stats.deadLinksDetected++;

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
            currentWikitext = currentWikitext.replace(item.citationTemplate.rawString, patched);
            // Remove obsolete {{dead link}} tag if it was placed after the template
            currentWikitext = removeDeadLinkTag(currentWikitext, patched);
            stats.archiveLinksAdded++;
            details.push(`Rescued dead link in {{${item.citationTemplate.templateName}}} on "${item.url}" with Wayback snapshot (${archiveDate})`);
          }
        } else if (item.linkType === "reference" || item.linkType === "external") {
          // 2. Patch Bare Reference or External Link with {{webarchive}}
          const webArchiveTag = ` {{webarchive |url=${snapshot.url} |date=${archiveDate}}}`;
          if (!item.rawString.includes("{{webarchive") && !item.rawString.includes("archive.org")) {
            const patched = `${item.rawString}${webArchiveTag}`;
            currentWikitext = currentWikitext.replace(item.rawString, patched);
            currentWikitext = removeDeadLinkTag(currentWikitext, patched);
            stats.archiveLinksAdded++;
            details.push(`Rescued dead link with {{webarchive}} on "${item.url}" (${archiveDate})`);
          }
        }
      } else if (tagUnrecoverableDead && !item.hasDeadTag) {
        // No archive snapshot exists anywhere on Wayback: Tag as unrecoverable dead link
        const tagged = tagDeadLink(item.rawString);
        if (tagged !== item.rawString) {
          currentWikitext = currentWikitext.replace(item.rawString, tagged);
          stats.unrecoverableLinksTagged++;
          details.push(`Tagged unrecoverable dead link on "${item.url}" with {{dead link}}`);
        }
      }
      continue;
    }

    // ------------------------------------------------------------------------
    // CASE D: URL is ALIVE -> Archive Working Links (if enabled)
    // ------------------------------------------------------------------------
    if (health.status === "alive" && archiveWorkingLinks && !item.hasArchive) {
      // 1. Request new snapshot via Wayback Save Page Now
      const saveRes = await requestWaybackSave(item.url);
      if (saveRes.success) {
        stats.newSnapshotsRequested++;
      }

      // 2. Look for existing or recent snapshot to add proactive archive
      const snapshot = await findBestWaybackSnapshot(item.url);
      if (snapshot && snapshot.available && item.citationTemplate) {
        const sampleDate = item.citationTemplate?.citationDate || item.citationTemplate?.accessDate;
        const archiveDate = formatWaybackDate(snapshot.timestamp, sampleDate);
        const patched = patchCitationTemplate(
          item.citationTemplate,
          snapshot.url,
          archiveDate,
          "live" // Set url-status=live for working reference
        );

        if (patched !== item.citationTemplate.rawString) {
          currentWikitext = currentWikitext.replace(item.citationTemplate.rawString, patched);
          stats.archiveLinksAdded++;
          details.push(`Archived working reference in {{${item.citationTemplate.templateName}}} on "${item.url}" (${archiveDate}, url-status=live)`);
        }
      }
    }
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
