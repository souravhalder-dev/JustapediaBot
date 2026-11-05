import { extractDomain } from "./utils";
import { parseArchiveUrl, formatWaybackDate } from "./wayback";
import { ExtractedLink } from "./types";

export function formatArchiveDate(timestamp: string): string {
  return formatWaybackDate(timestamp);
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

        // Check if {{dead link}} is immediately after this template
        const postString = wikitext.substring(match.index + rawString.length, match.index + rawString.length + 60);
        const hasDeadTag = /\{\{\s*dead[ _]link/i.test(postString) || urlStatus === "dead";

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
          hasArchive: Boolean(archiveUrl),
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
          hasArchive: Boolean(archiveUrl),
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

        const hasArchive = /\{\{\s*webarchive/i.test(refContent) || /web\.archive\.org/i.test(url);
        const hasDeadTag = /\{\{\s*dead[ _]link/i.test(refContent);

        items.push({
          id: `ref-${items.length + 1}`,
          url,
          domain: extractDomain(url),
          linkType: "reference",
          rawString,
          hasArchive,
          hasDeadTag,
          startIndex: match.index,
          endIndex: match.index + rawString.length,
        });
        seenUrls.add(url);
      }
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
 */
export function patchCitationTemplate(
  template: CitationTemplate,
  archiveUrl: string,
  archiveDate: string,
  urlStatus: "dead" | "live" = "dead"
): string {
  let text = template.rawString;
  const sp = template.paramSpacing;

  // 1. If archive-url or archiveurl exists, replace its value (even if empty)
  if (/\|\s*archive-?url\s*=/i.test(text)) {
    text = text.replace(/(\|\s*archive-?url\s*=\s*)([^\s|}]*)/i, `$1${archiveUrl}`);
  } else {
    // Inject archive-url before the closing "}}"
    text = text.replace(/\s*\}\}$/, `${sp}|${sp}archive-url${sp}=${sp}${archiveUrl}${sp}}}`);
  }

  // 2. If archive-date or archivedate exists, replace its value (even if empty)
  if (/\|\s*archive-?date\s*=/i.test(text)) {
    text = text.replace(/(\|\s*archive-?date\s*=\s*)([^\s|}]*)/i, `$1${archiveDate}`);
  } else {
    // Inject archive-date before the closing "}}"
    text = text.replace(/\s*\}\}$/, `${sp}|${sp}archive-date${sp}=${sp}${archiveDate}${sp}}}`);
  }

  // 3. If url-status or dead-url exists, set it
  if (/\|\s*url-status\s*=/i.test(text)) {
    text = text.replace(/(\|\s*url-status\s*=\s*)([^\s|}]*)/i, `$1${urlStatus}`);
  } else if (/\|\s*dead-?url\s*=/i.test(text)) {
    text = text.replace(/(\|\s*dead-?url\s*=\s*)([^\s|}]*)/i, `$1${urlStatus === "dead" ? "yes" : "no"}`);
  } else {
    // Inject url-status
    text = text.replace(/\s*\}\}$/, `${sp}|${sp}url-status${sp}=${sp}${urlStatus}${sp}}}`);
  }

  return text;
}

/**
 * Remove obsolete {{dead link}} templates following a rescued citation
 */
export function removeDeadLinkTag(wikitext: string, targetString: string): string {
  // Check if {{dead link}} or {{deadlink}} is immediately attached or after targetString
  const deadLinkRegex = /\s*\{\{\s*dead[ _]?link\s*(?:\|[^{}]*)?\}\}/i;
  const idx = wikitext.indexOf(targetString);
  if (idx === -1) return wikitext;

  const afterTarget = wikitext.substring(idx + targetString.length, idx + targetString.length + 80);
  const match = afterTarget.match(deadLinkRegex);
  if (match) {
    return wikitext.substring(0, idx + targetString.length) + afterTarget.replace(deadLinkRegex, "") + wikitext.substring(idx + targetString.length + 80);
  }

  return wikitext;
}

/**
 * Tag an unrecoverable reference with {{dead link}}
 */
export function tagDeadLink(rawString: string): string {
  const now = new Date();
  const monthYear = `${now.toLocaleString("en-US", { month: "long" })} ${now.getFullYear()}`;
  const tag = ` {{dead link |date=${monthYear} |fix-attempted=yes}}`;

  if (rawString.includes("{{dead link") || rawString.includes("{{deadlink")) {
    return rawString;
  }

  return `${rawString}${tag}`;
}
