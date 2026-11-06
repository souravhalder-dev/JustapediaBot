import { NextRequest, NextResponse } from "next/server";
import { requestWaybackSave } from "@/lib/wayback";
import { requireAuthorizedUser } from "@/lib/api-guard";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuthorizedUser(req);
    if (!auth.authorized) {
      return auth.response;
    }

    const { url } = await req.json();

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing 'url' parameter" }, { status: 400 });
    }

    const result = await requestWaybackSave(url);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
