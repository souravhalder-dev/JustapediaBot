import { NextRequest, NextResponse } from "next/server";
import { requestWaybackSave } from "@/lib/wayback";

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
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
