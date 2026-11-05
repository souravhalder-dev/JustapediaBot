import { NextRequest, NextResponse } from "next/server";
import { executeBotFeature } from "@/lib/bot-actions";
import { executeJustapediaEdit } from "@/lib/save-engine";

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

    const { botId, articleTitle, use_sandbox = false } = body;

    if (!botId || !articleTitle) {
      return NextResponse.json(
        { success: false, message: "Missing botId or articleTitle parameter." },
        { status: 400 }
      );
    }

    // 1. Run the bot's genuine, specialized algorithm
    const botResult = await executeBotFeature(botId, articleTitle);

    // 2. If no modifications needed, DO NOT touch or replace the page!
    if (!botResult.modified || !botResult.fixedWikitext) {
      return NextResponse.json({
        success: true,
        modified: false,
        title: articleTitle,
        botId,
        message: botResult.details,
      });
    }

    // 3. If modifications are needed and user is logged in, save the REAL updated wikitext!
    if (sessionToken) {
      const saveRes = await executeJustapediaEdit(sessionToken, {
        title: articleTitle,
        wikitext: botResult.fixedWikitext, // REAL WIKITEXT PRESERVED!
        summary: botResult.summary || `Automated maintenance update via ${botId}`,
        use_sandbox: Boolean(use_sandbox),
        is_minor: true,
        is_bot: true,
      });

      return NextResponse.json({
        success: saveRes.success,
        modified: true,
        saved: saveRes.success,
        title: articleTitle,
        botId,
        revid: saveRes.revid,
        diff_url: saveRes.diff_url,
        editor: saveRes.editor,
        message: saveRes.success ? botResult.details : saveRes.message,
        changesCount: botResult.changesCount || 1,
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
