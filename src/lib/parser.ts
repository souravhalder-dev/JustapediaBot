import { extractDomain } from "./utils";
import { parseArchiveUrl, formatWaybackDate, formatAmericanDate } from "./wayback";
import { ExtractedLink } from "./types";

export function formatArchiveDate(timestamp: string, sampleDate?: string): string {
  return formatWaybackDate(timestamp, sampleDate);
}

export function formatAccessDate(d?: Date | string): string {
  return formatAmericanDate(d);
}

export function generateFixedWikitext(
  originalWikitext: string,
  links: ExtractedLink[]
): { fixedWikitext: string; hasModifications: boolean } {
  let fixedWikitext = originalWikitext;
  let hasModifications = false;

  for (const link of links) {
    if (link.proposedFix && link.proposedFix.action !== "none" && link.proposedFix.newString) {
      if (fixedWikitext.includes(link.rawString)) {
        fixedWikitext = fixedWikitext.replace(link.rawString, link.proposedFix.newString);
        hasModifications = true;
      }
    }
  }

  return { fixedWikitext, hasModifications };
}

export interface CitationTemplate {
  rawString: string;
  templateName: string;
  startIndex: number;
  endIndex: number;
  params: Record<string, string>;
  paramSpacing: string; // e.g. " " if "| url = " or "" if "|url="
  url?: string;
  archiveUrl?: string;
  archiveDate?: string;
  urlStatus?: "live" | "dead" | "unfit" | "usurped";
  hasArchive: boolean;
  hasDeadTag: boolean;
  citationDate?: string;
  accessDate?: string;
}

export interface ParsedItem {
  id: string;
  url: string;
  domain: string;
  linkType: "template" | "reference" | "external";
  templateName?: string;
  rawString: string;
  hasArchive: boolean;
  hasDeadTag: boolean;
  startIndex: number;
  endIndex: number;
  citationTemplate?: CitationTemplate;
  citationDate?: string;
  accessDate?: string;
}

// All citation templates supported by Wikipedia & Justapedia
export const SUPPORTED_CITATION_TEMPLATES = new Set([
  "cite web",
  "cite news",
  "cite journal",
  "cite book",
  "cite magazine",
  "cite report",
  "cite press release",
  "cite interview",
  "cite conference",
  "cite paper",
  "cite speech",
  "cite podcast",
  "cite av media",
  "cite video",
  "cite map",
  "citation",
]);

function normalizeTemplateName(name: string): string {
  return name.trim().toLowerCase().replace(/_/g, " ");
}

function isValidHttpUrl(str: string): boolean {
  return /^https?:\/\/[^\s<>"'\]]+$/i.test(str.trim());
}

/**
 * Parses individual parameters inside a MediaWiki template:
 * Handles nested templates and pipes correctly.
 */
export function parseTemplateParameters(paramString: string): {
  params: Record<string, string>;
  paramSpacing: string;
  order: string[];
} {
  const params: Record<string, string> = {};
  const order: string[] = [];
  let paramSpacing = " ";

  let current = "";
  let depth = 0;

  const tokens: string[] = [];
  for (let i = 0; i < paramString.length; i++) {
    const char = paramString[i];
    const nextChar = paramString[i + 1] || "";

    if (char === "{" && nextChar === "{") {
      depth += 2;
      current += "{{";
      i++;
      continue;
    }
    if (char === "}" && nextChar === "}") {
      depth = Math.max(0, depth - 2);
      current += "}}";
      i++;
      continue;
    }
    if (char === "[" && nextChar === "[") {
      depth += 2;
      current += "[[";
      i++;
      continue;
    }
    if (char === "]" && nextChar === "]") {
      depth = Math.max(0, depth - 2);
      current += "]]";
      i++;
      continue;
    }

    if (char === "|" && depth === 0) {
      tokens.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim().length > 0) {
    tokens.push(current);
  }

  tokens.forEach((token) => {
    const eqIdx = token.indexOf("=");
    if (eqIdx > 0) {
      const rawKey = token.substring(0, eqIdx);
      const rawVal = token.substring(eqIdx + 1);

      if (rawKey.endsWith(" ")) {
        paramSpacing = " ";
      } else {
        paramSpacing = "";
      }

      const key = rawKey.trim().toLowerCase();
      const val = rawVal.trim();
      params[key] = val;
      order.push(key);
    }
  });

  return { params, paramSpacing, order };
}

/**
 * Extracts all references, citation templates, and external links from wikitext
 */
export function extractLinksFromWikitext(wikitext: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seenUrls = new Set<string>();

  // 1. Match citation templates: {{cite ... |url=...}}
  const templateRegex = /\{\{\s*([a-zA-Z0-9_ -]+)\s*\|([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\}/gi;
  let match: RegExpExecArray | null;

  while ((match = templateRegex.exec(wikitext)) !== null) {
    const rawString = match[0];
    const rawTplName = match[1];
    const normTplName = normalizeTemplateName(rawTplName);

    if (SUPPORTED_CITATION_TEMPLATES.has(normTplName)) {
      const { params, paramSpacing } = parseTemplateParameters(match[2]);
      let url = params["url"] || params["website"] || "";

      // Handle archive-url parameter aliases
      const archiveUrl = params["archive-url"] || params["archiveurl"] || params["archive_url"];
      const archiveDate = params["archive-date"] || params["archivedate"] || params["archive_date"];
      const urlStatus = (params["url-status"] || params["dead-url"] || params["deadurl"]) as any;

      // Un-mangle if the original URL is itself an archive URL (e.g. web.archive.org in url parameter)
      if (url && isValidHttpUrl(url)) {
        const parsedArch = parseArchiveUrl(url);
        if (parsedArch.isArchive && parsedArch.originalUrl) {
          url = parsedArch.originalUrl;
        }

        const citationDate = params["date"] || params["publication-date"] || params["year"];
        const accessDate = params["access-date"] || params["accessdate"];

        // Check if {{dead link}} is attached to or immediately follows this template/ref
        const postString = wikitext.substring(match.index + rawString.length, match.index + rawString.length + 350);
        const hasDeadTag =
          /\{\{\s*dead[ _]?link/i.test(postString) ||
          /\{\{\s*dead[ _]?link/i.test(rawString) ||
          urlStatus === "dead";

        const hasArchive =
          Boolean(archiveUrl) ||
          /\{\{\s*webarchive/i.test(postString) ||
          /web\.archive\.org/i.test(url) ||
          /archive\.today/i.test(url);

        const citationTpl: CitationTemplate = {
          rawString,
          templateName: rawTplName.trim(),
          startIndex: match.index,
          endIndex: match.index + rawString.length,
          params,
          paramSpacing,
          url,
          archiveUrl,
          archiveDate,
          urlStatus,
          hasArchive,
          hasDeadTag,
          citationDate,
          accessDate,
        };

        items.push({
          id: `tpl-${items.length + 1}`,
          url,
          domain: extractDomain(url),
          linkType: "template",
          templateName: rawTplName.trim(),
          rawString,
          hasArchive,
          hasDeadTag,
          startIndex: match.index,
          endIndex: match.index + rawString.length,
          citationTemplate: citationTpl,
          citationDate,
          accessDate,
        });

        seenUrls.add(url);
      }
    }
  }

  // 2. Match <ref> tags containing URLs that were not matched as templates
  const refRegex = /<ref(?:\s+[^>]*)?>([\s\S]*?)<\/ref>/gi;
  while ((match = refRegex.exec(wikitext)) !== null) {
    const rawString = match[0];
    const refContent = match[1];

    // Check for any misplaced trailing {{webarchive}} or {{dead link}} templates immediately following </ref>
    const postRefSlice = wikitext.substring(match.index + rawString.length, match.index + rawString.length + 800);
    const trailingTemplatesMatch = postRefSlice.match(/^((?:\s*\{\{\s*(?:webarchive|dead[ _]?link)[^{}]*\}\})+)/i);
    const trailingTemplates = trailingTemplatesMatch ? trailingTemplatesMatch[1] : "";
    const fullClusterString = `${rawString}${trailingTemplates}`;

    // Find any bracketed [http... Title] or bare URLs inside the ref
    const urlInRefRegex = /\[?(https?:\/\/[^\s\]"'>]+)(?:\s+([^\]]+))?\]?/gi;
    let refUrlMatch: RegExpExecArray | null;

    while ((refUrlMatch = urlInRefRegex.exec(refContent)) !== null) {
      let url = refUrlMatch[1].trim();
      if (isValidHttpUrl(url) && !seenUrls.has(url)) {
        // Un-mangle if archive
        const parsedArch = parseArchiveUrl(url);
        if (parsedArch.isArchive && parsedArch.originalUrl) {
          url = parsedArch.originalUrl;
        }

        const hasArchive =
          /\{\{\s*webarchive/i.test(refContent) ||
          /\{\{\s*webarchive/i.test(trailingTemplates) ||
          /web\.archive\.org/i.test(url) ||
          /archive\.today/i.test(url);
        const hasDeadTag =
          /\{\{\s*dead[ _]link/i.test(refContent) ||
          /\{\{\s*dead[ _]link/i.test(trailingTemplates);

        items.push({
          id: `ref-${items.length + 1}`,
          url,
          domain: extractDomain(url),
          linkType: "reference",
          rawString: fullClusterString,
          hasArchive,
          hasDeadTag,
          startIndex: match.index,
          endIndex: match.index + fullClusterString.length,
        });
        seenUrls.add(url);
      }
    }

    if (trailingTemplates) {
      refRegex.lastIndex = match.index + fullClusterString.length;
    }
  }

  // 3. Match External links section: "* [http... Label]"
  const extLinkSectionRegex = /==\s*External links\s*==([\s\S]*?)(?=(?:\n==|\n\[\[Category:|$))/i;
  const extMatch = extLinkSectionRegex.exec(wikitext);
  if (extMatch) {
    const sectionContent = extMatch[1];
    const lineRegex = /^\s*\*\s*\[(https?:\/\/[^\s\]]+)\s*([^\]]*)\](.*)$/gm;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = lineRegex.exec(sectionContent)) !== null) {
      let url = lineMatch[1].trim();
      const rawString = lineMatch[0];
      if (isValidHttpUrl(url) && !seenUrls.has(url)) {
        const hasArchive = /\{\{\s*webarchive/i.test(rawString) || /web\.archive\.org/i.test(url);
        const hasDeadTag = /\{\{\s*dead[ _]link/i.test(rawString);

        items.push({
          id: `ext-${items.length + 1}`,
          url,
          domain: extractDomain(url),
          linkType: "external",
          rawString,
          hasArchive,
          hasDeadTag,
          startIndex: extMatch.index + lineMatch.index,
          endIndex: extMatch.index + lineMatch.index + rawString.length,
        });
        seenUrls.add(url);
      }
    }
  }

  return items;
}

/**
 * Patch a citation template to add/modify archive-url, archive-date, and url-status
 * Preserves the exact formatting and parameter spacing style.
 * Matches the citation's existing date style (MDY, DMY, or ISO) to comply with Template:Cite web / CS1.
 */
export function patchCitationTemplate(
  template: CitationTemplate,
  archiveUrl: string,
  archiveDate: string,
  urlStatus: "dead" | "live" | "unfit" | "usurped" = "dead",
  accessDate?: string
): string {
  let text = template.rawString;
  const sp = typeof template.paramSpacing === "string" ? template.paramSpacing : " ";

  // Detect existing date format from template to ensure CS1 consistency
  const sample =
    template.params["archive-date"] ||
    template.params["archivedate"] ||
    template.params["archive_date"] ||
    template.params["date"] ||
    template.params["access-date"] ||
    template.params["accessdate"] ||
    template.params["publication-date"] ||
    template.citationDate ||
    template.accessDate;

  // Format date to match template's style (MDY "Month Day, Year", DMY, or ISO)
  const formattedDate = formatWaybackDate(archiveDate, sample) || archiveDate;

  const normalizeP1 = (p1: string): string => {
    const hadSpace = /[ \t]$/.test(p1);
    const base = p1.replace(/[ \t]+$/, "");
    const space = hadSpace || sp === " " ? " " : "";
    return base + space;
  };

  const injectParam = (srcText: string, key: string, val: string): string => {
    if (srcText.includes("\n")) {
      const indentMatch = srcText.match(/\n([ \t]*)\|/);
      const indent = indentMatch ? indentMatch[1] : "  ";
      return srcText.replace(/\n\s*\}\}$/, `\n${indent}|${sp}${key}${sp}=${sp}${val}\n}}`);
    } else {
      return srcText.replace(/\s*\}\}$/, `${sp}|${sp}${key}${sp}=${sp}${val}${sp}}}`);
    }
  };

  // 1. If archive-url or archiveurl or archive_url exists, replace its entire value cleanly
  const archiveUrlRegex = /(\|\s*(?:archive-?url|archive_url)[ \t]*=[ \t]*)([\s\S]*?)(?=[ \t]*(?:[|}]))/i;
  if (archiveUrlRegex.test(text)) {
    text = text.replace(archiveUrlRegex, (_m, p1) => `${normalizeP1(p1)}${archiveUrl}`);
  } else {
    text = injectParam(text, "archive-url", archiveUrl);
  }

  // 2. If archive-date or archivedate or archive_date exists, replace its entire value cleanly
  const archiveDateRegex = /(\|\s*(?:archive-?date|archive_date)[ \t]*=[ \t]*)([\s\S]*?)(?=[ \t]*(?:[|}]))/i;
  if (archiveDateRegex.test(text)) {
    text = text.replace(archiveDateRegex, (_m, p1) => `${normalizeP1(p1)}${formattedDate}`);
  } else {
    text = injectParam(text, "archive-date", formattedDate);
  }

  // 3. If url-status or dead-url exists, set it
  const urlStatusRegex = /(\|\s*url-status[ \t]*=[ \t]*)([\s\S]*?)(?=[ \t]*(?:[|}]))/i;
  const deadUrlRegex = /(\|\s*dead-?url[ \t]*=[ \t]*)([\s\S]*?)(?=[ \t]*(?:[|}]))/i;

  if (urlStatusRegex.test(text)) {
    text = text.replace(urlStatusRegex, (_m, p1) => `${normalizeP1(p1)}${urlStatus}`);
  } else if (deadUrlRegex.test(text)) {
    text = text.replace(deadUrlRegex, (_m, p1) => `${normalizeP1(p1)}${urlStatus === "dead" ? "yes" : "no"}`);
  } else {
    text = injectParam(text, "url-status", urlStatus);
  }

  // 4. Handle access-date in American format: "Month Day, Year" (e.g. November 5, 2026)
  const targetAccessDate = accessDate || template.params["access-date"] || template.params["accessdate"];
  if (targetAccessDate) {
    const formattedAccessDate = formatAmericanDate(targetAccessDate);
    const accessDateRegex = /(\|\s*(?:access-?date|accessdate)[ \t]*=[ \t]*)([\s\S]*?)(?=[ \t]*(?:[|}]))/i;
    if (accessDateRegex.test(text)) {
      text = text.replace(accessDateRegex, (_m, p1) => `${normalizeP1(p1)}${formattedAccessDate}`);
    } else if (accessDate) {
      text = injectParam(text, "access-date", formattedAccessDate);
    }
  }

  return text;
}

/**
 * Remove obsolete {{dead link}} templates following a rescued citation
 */
export function removeDeadLinkTag(wikitext: string, targetString: string): string {
  const deadLinkRegex = /\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/gi;
  const idx = wikitext.indexOf(targetString);
  if (idx === -1) return wikitext;

  // Search in a generous window (up to 350 chars after the target)
  const windowEnd = Math.min(wikitext.length, idx + targetString.length + 350);
  const afterTarget = wikitext.substring(idx + targetString.length, windowEnd);

  if (deadLinkRegex.test(afterTarget)) {
    deadLinkRegex.lastIndex = 0;
    const cleanedAfter = afterTarget.replace(deadLinkRegex, "");
    return wikitext.substring(0, idx + targetString.length) + cleanedAfter + wikitext.substring(windowEnd);
  }

  return wikitext;
}

/**
 * Tag an unrecoverable reference with {{dead link}}
 * Places {{dead link}} INSIDE <ref> tags if the reference is enclosed in <ref>...</ref>
 */
export function tagDeadLink(rawString: string): string {
  const now = new Date();
  const monthYear = `${now.toLocaleString("en-US", { month: "long" })} ${now.getFullYear()}`;
  const tag = `{{dead link |date=${monthYear} |fix-attempted=yes}}`;

  if (/\{\{\s*dead[ _]?link/i.test(rawString)) {
    return rawString;
  }

  // If rawString is enclosed in <ref>...</ref>, place tag inside before </ref>
  const refOpenMatch = rawString.match(/^<ref(?:\s+[^>]*)?>/i);
  const refCloseIdx = rawString.lastIndexOf("</ref>");
  if (refOpenMatch && refCloseIdx !== -1) {
    const refOpen = refOpenMatch[0];
    const inner = rawString.substring(refOpen.length, refCloseIdx).trim();
    return `${refOpen}${inner} ${tag}</ref>`;
  }

  return `${rawString} ${tag}`;
}
