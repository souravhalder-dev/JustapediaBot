import { NextRequest, NextResponse } from "next/server";
import { searchJustapedia } from "@/lib/justapedia";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("q") || "";

  if (!query || query.trim().length === 0) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchJustapedia(query);
  return NextResponse.json({ results });
}
