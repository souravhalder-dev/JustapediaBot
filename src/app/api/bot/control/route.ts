import { NextRequest, NextResponse } from "next/server";
import { getServerBotRunner } from "@/lib/server-bot-runner";
import { requireAuthorizedUser } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const authHeader = req.headers.get("Authorization");
    let explicitToken = "";

    if (authHeader && authHeader.startsWith("Bearer ")) {
      explicitToken = authHeader.substring(7).trim();
    }
    if (!explicitToken && body.sessionToken) {
      explicitToken = body.sessionToken;
    }

    // Require authenticated Bot or Administrator
    const auth = await requireAuthorizedUser(req, explicitToken);
    if (!auth.authorized) {
      return auth.response;
    }

    const { action, options, title, count, category } = body;
    const runner = getServerBotRunner();

    switch (action) {
      case "start": {
        const res = await runner.start({
          sessionToken: auth.sessionToken,
          operatorUsername: auth.user.username || "Operator",
          options,
        });

        return NextResponse.json({
          ...res,
          state: runner.getState(),
        });
      }

      case "stop": {
        // Immediate synchronous stop
        const res = runner.stop();
        return NextResponse.json({
          ...res,
          state: runner.getState(),
        });
      }

      case "replenish": {
        const added = await runner.replenishQueue(count || 50, category);
        return NextResponse.json({
          success: true,
          added,
          message: `Added ${added} new unhandled article(s) to queue.`,
          state: runner.getState(),
        });
      }

      case "add-article": {
        if (!title || !title.trim()) {
          return NextResponse.json(
            { success: false, message: "Article title is required." },
            { status: 400 }
          );
        }
        const added = runner.addArticle(title.trim());
        return NextResponse.json({
          success: added,
          message: `Added "${title.trim()}" to queue.`,
          state: runner.getState(),
        });
      }

      case "clear-queue": {
        runner.clearQueue();
        return NextResponse.json({
          success: true,
          message: "Queue cleared.",
          state: runner.getState(),
        });
      }

      case "queue-affected":
      case "cleanup-duplicates": {
        const added = runner.queueAffectedArticles();
        return NextResponse.json({
          success: true,
          added,
          message: `Prioritized ${added} affected article(s) in queue for clean single-pass resolution.`,
          state: runner.getState(),
        });
      }

      case "reset-stats": {
        runner.resetStats();
        return NextResponse.json({
          success: true,
          message: "Statistics reset.",
          state: runner.getState(),
        });
      }

      case "update-options": {
        if (options) {
          runner.updateOptions(options);
        }
        return NextResponse.json({
          success: true,
          message: "Options updated.",
          state: runner.getState(),
        });
      }

      default:
        return NextResponse.json(
          { success: false, message: `Unknown control action: "${action}"` },
          { status: 400 }
        );
    }
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: `Control action failed: ${error.message}` },
      { status: 500 }
    );
  }
}
