import { ExtractedLink } from "./types";
import { extractDomain } from "./utils";

export interface ParsedItem {
  id: string;
  url: string;
  domain: string;
  linkType: 'reference' | 'template' | 'bare';
  templateName?: string;
  rawString: string;
  hasArchive: boolean;
  hasDeadTag: boolean;
  startIndex: number;
  endIndex: number;
}

export function extractLinksFromWikitext(wikitext: string): ParsedItem[] {
  const items: ParsedItem[] = [];
  const seenUrls = new Set<string>();

  // 1. Match citation templates: {{cite ... |url=...}}
  const templateRegex = /\{\{\s*(cite[ _][^|}]*|citation)\s*\|([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\}/gi;
  let match: RegExpExecArray | null;

  while ((match = templateRegex.exec(wikitext)) !== null) {
    const rawString = match[0];
    const templateName = match[1].trim();
    const params = match[2];

    const urlMatch = /\|\s*url\s*=\s*([^\s|}]+)/i.exec(params);
    if (urlMatch) {
      const url = urlMatch[1].trim();
      if (isValidHttpUrl(url)) {
        const hasArchive = /\|\s*archive-?url\s*=/i.test(params);
        const hasDeadTag = /\|\s*url-status\s*=\s*dead/i.test(params) || rawString.includes("{{dead link");

        items.push({
          id: `tpl-${items.length + 1}`,
          url,
          domain: extractDomain(url),
          linkType: 'template',
          templateName,
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

  // 2. Match <ref> tags containing URLs that were not matched as templates
  const refRegex = /<ref(?:\s+[^>]*)?>([\s\S]*?)<\/ref>/gi;
  while ((match = refRegex.exec(wikitext)) !== null) {
    const rawString = match[0];
    const refContent = match[1];

    // Find any bracketed or bare URLs inside the ref
    const urlInRefRegex = /\[?(https?:\/\/[^\s\]"'>]+)(?:\s+([^\]]+))?\]?/gi;
    let refUrlMatch: RegExpExecArray | null;

    while ((refUrlMatch = urlInRefRegex.exec(refContent)) !== null) {
      const url = refUrlMatch[1].trim();
      if (isValidHttpUrl(url) && !seenUrls.has(url)) {
        const hasArchive = /\{\{\s*webarchive/i.test(refContent) || /web\.archive\.org/i.test(url);
        const hasDeadTag = /\{\{\s*dead[ _]link/i.test(refContent);

        items.push({
          id: `ref-${items.length + 1}`,
          url,
          domain: extractDomain(url),
          linkType: 'reference',
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

  // 3. Match remaining bracketed external links [https://... Text]
  const bracketRegex = /\[(https?:\/\/[^\s\]]+)(?:\s+([^\]]+))?\]/gi;
  while ((match = bracketRegex.exec(wikitext)) !== null) {
    const rawString = match[0];
    const url = match[1].trim();

    if (isValidHttpUrl(url) && !seenUrls.has(url)) {
      items.push({
        id: `bare-${items.length + 1}`,
        url,
        domain: extractDomain(url),
        linkType: 'bare',
        rawString,
        hasArchive: /web\.archive\.org/i.test(url),
        hasDeadTag: false,
        startIndex: match.index,
        endIndex: match.index + rawString.length,
      });
      seenUrls.add(url);
    }
  }

  return items;
}

function isValidHttpUrl(string: string): boolean {
  try {
    const url = new URL(string);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function formatArchiveDate(waybackTimestamp?: string): string {
  if (!waybackTimestamp || waybackTimestamp.length < 8) {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  }
  const y = waybackTimestamp.substring(0, 4);
  const m = waybackTimestamp.substring(4, 6);
  const d = waybackTimestamp.substring(6, 8);
  return `${y}-${m}-${d}`;
}

export function generateFixedWikitext(
  originalWikitext: string,
  analyzedLinks: ExtractedLink[]
): { fixedWikitext: string; hasModifications: boolean } {
  let modified = originalWikitext;
  let hasModifications = false;

  const linksToFix = analyzedLinks.filter(l => l.status === 'dead' && l.proposedFix && l.proposedFix.action !== 'none');

  for (const link of linksToFix) {
    if (!link.proposedFix) continue;

    if (modified.includes(link.rawString)) {
      modified = modified.replace(link.rawString, link.proposedFix.newString);
      hasModifications = true;
    }
  }

  return { fixedWikitext: modified, hasModifications };
}
