import { NextRequest, NextResponse } from "next/server";
import { fetchJustapediaPage } from "@/lib/justapedia";
import { extractLinksFromWikitext, generateFixedWikitext, formatArchiveDate } from "@/lib/parser";
import { checkUrlHealth } from "@/lib/link-checker";
import { checkWaybackAvailability } from "@/lib/wayback";
import { ExtractedLink, PageAnalysisResult } from "@/lib/types";

export const maxDuration = 60; // 60s for Vercel serverless execution
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await req.json();
    const { pageTitle, archiveAll = false, checkWayback = true } = body;

    if (!pageTitle || typeof pageTitle !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'pageTitle' parameter" }, { status: 400 });
    }

    // 1. Fetch live wikitext from Justapedia API (NO DATABASE NEEDED!)
    const pageData = await fetchJustapediaPage(pageTitle);

    if (!pageData.exists) {
      return NextResponse.json(
        { error: `The page "${pageTitle}" does not exist on Justapedia.` },
        { status: 404 }
      );
    }

    const originalWikitext = pageData.wikitext;

    // 2. Extract external links and citation references
    const parsedItems = extractLinksFromWikitext(originalWikitext);

    // 3. Concurrently check health and Wayback availability (limit concurrency to batches of 5)
    const batchSize = 5;
    const analyzedLinks: ExtractedLink[] = [];

    for (let i = 0; i < parsedItems.length; i += batchSize) {
      const batch = parsedItems.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async (item): Promise<ExtractedLink> => {
          // Check live URL health
          const health = await checkUrlHealth(item.url, 6000);

          let waybackSnapshot = null;
          // If dead, or if archiveAll is enabled, query Wayback Machine
          if (checkWayback && (health.status === "dead" || archiveAll)) {
            waybackSnapshot = await checkWaybackAvailability(item.url);
          }

          // Determine proposed fix
          let proposedFix: ExtractedLink["proposedFix"] = {
            action: "none",
            newString: item.rawString,
            description: "No modifications needed (link is alive)",
          };

          if (health.status === "dead") {
            if (waybackSnapshot && waybackSnapshot.available) {
              const archiveDate = formatArchiveDate(waybackSnapshot.timestamp);
              if (item.linkType === "template") {
                // Add archive parameters to citation template
                const trimmedTemplate = item.rawString.replace(/\s*\}\}\s*$/, "");
                const fixedTemplate = `${trimmedTemplate} |archive-url=${waybackSnapshot.url} |archive-date=${archiveDate} |url-status=dead}}`;
                proposedFix = {
                  action: "add_archive",
                  newString: fixedTemplate,
                  description: `Rescued dead citation with Wayback Machine snapshot from ${archiveDate}`,
                };
              } else if (item.linkType === "reference") {
                // Append {{Webarchive}} inside ref tag
                const fixedRef = item.rawString.replace(
                  /<\/ref>\s*$/i,
                  ` {{Webarchive|url=${waybackSnapshot.url}|date=${archiveDate}}}</ref>`
                );
                proposedFix = {
                  action: "add_archive",
                  newString: fixedRef,
                  description: `Appended {{Webarchive}} snapshot to dead reference`,
                };
              } else {
                // Bare link: append Webarchive
                proposedFix = {
                  action: "add_archive",
                  newString: `${item.rawString} {{Webarchive|url=${waybackSnapshot.url}|date=${archiveDate}}}`,
                  description: `Appended {{Webarchive}} to bare dead link`,
                };
              }
            } else {
              // Dead with no Wayback snapshot found -> tag with {{dead link}}
              const now = new Date();
              const dateStr = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
              if (!item.hasDeadTag) {
                if (item.linkType === "template") {
                  proposedFix = {
                    action: "tag_dead",
                    newString: `${item.rawString} {{dead link|date=${dateStr}}}`,
                    description: `Tagged dead citation with {{dead link}} (no archive found)`,
                  };
                } else {
                  proposedFix = {
                    action: "tag_dead",
                    newString: `${item.rawString} {{dead link|date=${dateStr}}}`,
                    description: `Tagged dead URL with {{dead link}}`,
                  };
                }
              }
            }
          }

          return {
            id: item.id,
            url: item.url,
            domain: item.domain,
            linkType: item.linkType,
            templateName: item.templateName,
            rawString: item.rawString,
            status: health.status,
            httpCode: health.httpCode,
            error: health.error,
            waybackSnapshot,
            proposedFix,
          };
        })
      );

      analyzedLinks.push(...batchResults);
    }

    // 4. Generate modified wikitext
    const { fixedWikitext, hasModifications } = generateFixedWikitext(originalWikitext, analyzedLinks);

    // 5. Compute stats
    const totalLinks = analyzedLinks.length;
    const aliveLinks = analyzedLinks.filter((l) => l.status === "alive").length;
    const deadLinks = analyzedLinks.filter((l) => l.status === "dead").length;
    const rescuedLinks = analyzedLinks.filter(
      (l) => l.status === "dead" && l.proposedFix?.action === "add_archive"
    ).length;
    const taggedLinks = analyzedLinks.filter(
      (l) => l.status === "dead" && l.proposedFix?.action === "tag_dead"
    ).length;

    const result: PageAnalysisResult = {
      pageTitle: pageData.title,
      pageId: pageData.pageId,
      lastRevisionId: pageData.revisionId,
      lastModified: pageData.timestamp,
      originalWikitext,
      fixedWikitext,
      hasModifications,
      links: analyzedLinks,
      stats: {
        totalLinks,
        aliveLinks,
        deadLinks,
        rescuedLinks,
        taggedLinks,
      },
      durationMs: Date.now() - startTime,
    };

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Page analysis error:", err);
    return NextResponse.json(
      { error: err.message || "An error occurred during page analysis" },
      { status: 500 }
    );
  }
}
