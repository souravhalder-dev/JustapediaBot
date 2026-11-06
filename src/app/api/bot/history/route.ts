import { NextRequest, NextResponse } from "next/server";
import { getArticleHistoryList, clearArticleHistory } from "@/lib/article-history";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const page = parseInt(req.nextUrl.searchParams.get("page") || "1", 10);
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
    const search = req.nextUrl.searchParams.get("search") || "";
    const status = req.nextUrl.searchParams.get("status") || "all";

    const result = getArticleHistoryList({ page, limit, search, status });
    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: `History query failed: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    if (body.action === "clear") {
      clearArticleHistory();
      return NextResponse.json({ success: true, message: "Article history cleared." });
    }
    return NextResponse.json({ success: false, message: "Invalid action." }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: `History action failed: ${error.message}` },
      { status: 500 }
    );
  }
}
