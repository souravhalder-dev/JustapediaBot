import { NextRequest, NextResponse } from "next/server";
import { fetchCategoryMembers } from "@/lib/justapedia";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const category = req.nextUrl.searchParams.get("category") || "All articles with dead external links";
    const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
    const cmcontinue = req.nextUrl.searchParams.get("cmcontinue") || undefined;

    const result = await fetchCategoryMembers(category, limit, cmcontinue);

    return NextResponse.json({
      success: true,
      category,
      count: result.members.length,
      members: result.members,
      cmcontinue: result.cmcontinue,
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, message: `Failed to fetch category members: ${error.message}` },
      { status: 500 }
    );
  }
}
