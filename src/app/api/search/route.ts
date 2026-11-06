import { NextRequest, NextResponse } from "next/server";
import { searchJustapedia } from "@/lib/justapedia";
import { requireAuthorizedUser } from "@/lib/api-guard";

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAuthorizedUser(req);
  if (!auth.authorized) {
    return auth.response;
  }

  const query = req.nextUrl.searchParams.get("q") || "";

  if (!query || query.trim().length === 0) {
    return NextResponse.json({ results: [] });
  }

  const results = await searchJustapedia(query);
  return NextResponse.json({ results });
}
