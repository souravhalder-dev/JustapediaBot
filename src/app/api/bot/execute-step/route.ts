import { NextRequest, NextResponse } from "next/server";
import { executeBotFeature } from "@/lib/bot-actions";
import { executeJustapediaEdit } from "@/lib/save-engine";
import {
  isArticleResolved,
  getResolvedArticleRecord,
  markArticleResolved,
} from "@/lib/resolved-articles";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    let sessionToken = "";

    if (authHeader && authHeader.startsWith("Bearer ")) {
      sessionToken = authHeader.substring(7).trim();
    }

    const body = await req.json();

    if (!sessionToken && body.session_token) {
      sessionToken = body.session_token;
    }

    const { botId, articleTitle, use_sandbox = false, sandbox_title, options, force = false } = body;

    if (!botId || !articleTitle) {
      return NextResponse.json(
        { success: false, message: "Missing botId or articleTitle parameter." },
        { status: 400 }
      );
    }

    // Protection Guard: If article has already been resolved by any bot, do NOT edit it again
    if (!force && isArticleResolved(articleTitle)) {
      const record = getResolvedArticleRecord(articleTitle);
      return NextResponse.json({
        success: true,
        skipped: true,
        modified: false,
        alreadyResolved: true,
        title: articleTitle,
        botId,
        message: `[PROTECTION GUARD] Article "${articleTitle}" has already been processed and resolved (by ${record?.resolvedByBot} at ${record?.resolvedAt}). Edit prevented to avoid duplicate edits.`,
        record,
      });
    }

    // 1. Run the bot's genuine, specialized algorithm with options
    const botResult = await executeBotFeature(botId, articleTitle, options);

    // 2. If no modifications needed (article has no identified issues), DO NOT touch or replace the page!
    if (!botResult.modified || !botResult.fixedWikitext) {
      // Mark as resolved healthy so no bot edits it unnecessarily
      markArticleResolved({
        title: articleTitle,
        resolvedAt: new Date().toLocaleTimeString(),
        resolvedByBot: botId,
        status: "verified_healthy",
        summary: botResult.details,
      });

      return NextResponse.json({
        success: true,
        modified: false,
        resolved: true,
        title: articleTitle,
        botId,
        message: `[VERIFIED HEALTHY - NO ISSUES] ${botResult.details}. Marked as resolved; will not be edited again by any bot.`,
        stats: botResult.stats,
      });
    }

    // 3. If modifications are needed and user is logged in, save the REAL updated wikitext!
    if (sessionToken) {
      const saveRes = await executeJustapediaEdit(sessionToken, {
        title: articleTitle,
        wikitext: botResult.fixedWikitext, // REAL WIKITEXT PRESERVED!
        summary: botResult.summary || `InternetArchiveBot: Rescued references & preserved citations`,
        use_sandbox: Boolean(use_sandbox),
        sandbox_title: sandbox_title,
        is_minor: false,
        is_bot: false, // Matches Birth Update Bot saving mechanism for standard user attribution without tripping bot hooks
      });

      if (saveRes.success) {
        // Once saved and all identified issues are resolved, mark article so no bot edits it again
        markArticleResolved({
          title: articleTitle,
          resolvedAt: new Date().toLocaleTimeString(),
          resolvedByBot: botId,
          status: "edited_and_resolved",
          revid: saveRes.revid,
          summary: botResult.summary,
        });
      }

      return NextResponse.json({
        success: saveRes.success,
        modified: true,
        saved: saveRes.success,
        resolved: saveRes.success,
        title: articleTitle,
        botId,
        revid: saveRes.revid,
        diff_url: saveRes.diff_url,
        editor: saveRes.editor,
        message: saveRes.success
          ? `${botResult.details}. All issues resolved and marked; will not be edited again by any bot.`
          : saveRes.message,
        changesCount: botResult.changesCount || 1,
        stats: botResult.stats,
      });
    }

    // Unauthenticated preview mode
    return NextResponse.json({
      success: true,
      modified: true,
      saved: false,
      title: articleTitle,
      botId,
      message: `${botResult.details} (Preview Mode — Sign in to save live to Justapedia)`,
      changesCount: botResult.changesCount || 1,
      stats: botResult.stats,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        message: `Execution error: ${error.message || String(error)}`,
      },
      { status: 500 }
    );
  }
}
