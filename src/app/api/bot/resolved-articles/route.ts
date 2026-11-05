import { NextRequest, NextResponse } from "next/server";
import {
  getAllResolvedArticles,
  clearAllResolvedArticles,
  isArticleResolved,
} from "@/lib/resolved-articles";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const list = getAllResolvedArticles();
    const healthyCount = list.filter((a) => a.status === "verified_healthy").length;
    const editedCount = list.filter((a) => a.status === "edited_and_resolved").length;

    return NextResponse.json({
      success: true,
      totalResolved: list.length,
      healthyCount,
      editedCount,
      articles: list,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: `Failed to fetch resolved articles: ${err.message}` },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    clearAllResolvedArticles();
    return NextResponse.json({
      success: true,
      message: "Resolved articles protection cache has been cleared.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, message: `Failed to clear cache: ${err.message}` },
      { status: 500 }
    );
  }
}
