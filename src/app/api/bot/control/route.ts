import { NextRequest, NextResponse } from "next/server";
import { getServerBotRunner } from "@/lib/server-bot-runner";
import { verifyUserSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    let sessionToken = "";

    if (authHeader && authHeader.startsWith("Bearer ")) {
      sessionToken = authHeader.substring(7).trim();
    }

    const body = await req.json();
    if (!sessionToken && body.sessionToken) {
      sessionToken = body.sessionToken;
    }

    const { action, options, title, count, category } = body;
    const runner = getServerBotRunner();

    switch (action) {
      case "start": {
        if (!sessionToken) {
          return NextResponse.json(
            { success: false, message: "Authentication required: Please log in to start the bot." },
            { status: 401 }
          );
        }

        const verify = await verifyUserSession(sessionToken);
        if (!verify.valid || !verify.user) {
          return NextResponse.json(
            { success: false, message: verify.error || "Authentication session invalid. Please log in again." },
            { status: 403 }
          );
        }

        const res = await runner.start({
          sessionToken,
          operatorUsername: verify.user.username || "Operator",
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
