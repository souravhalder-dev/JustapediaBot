import { NextRequest, NextResponse } from "next/server";
import { getServerBotRunner } from "@/lib/server-bot-runner";
import { requireAuthorizedUser } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuthorizedUser(req);
    if (!auth.authorized) {
      return auth.response;
    }

    const runner = getServerBotRunner();
    const state = runner.getState();

    return NextResponse.json({
      success: true,
      botId: state.botId,
      status: state.status,
      operatorUsername: state.operatorUsername,
      currentCycleEdits: state.currentCycleEdits,
      cycleNumber: state.cycleNumber,
      pauseUntil: state.pauseUntil,
      cooldownRemainingSeconds: state.cooldownRemainingSeconds,
      totalEdits: state.totalEdits,
      totalChecked: state.totalChecked,
      totalSkipped: state.totalSkipped,
      totalErrors: state.totalErrors,
      queue: state.queue,
      options: state.options,
      detailedStats: state.detailedStats,
      logs: state.logs.slice(0, 100), // Return recent 100 logs
      startedAt: state.startedAt,
      lastActiveAt: state.lastActiveAt,
      isLoopRunning: state.isLoopRunning,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: `Status query error: ${error.message}` },
      { status: 500 }
    );
  }
}
