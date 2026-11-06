import { NextRequest, NextResponse } from "next/server";
import { checkUrlHealth } from "@/lib/link-checker";
import { checkWaybackAvailability } from "@/lib/wayback";
import { extractDomain } from "@/lib/utils";
import { UrlCheckResult } from "@/lib/types";
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
      return NextResponse.json({ error: "A valid 'url' parameter is required" }, { status: 400 });
    }

    const health = await checkUrlHealth(url, 7000);
    const wayback = await checkWaybackAvailability(url);

    const result: UrlCheckResult = {
      url,
      domain: extractDomain(url),
      status: health.status,
      httpCode: health.httpCode,
      finalUrl: health.finalUrl,
      latencyMs: health.latencyMs,
      waybackSnapshot: wayback,
      checkedAt: new Date().toISOString(),
    };

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to inspect URL" }, { status: 500 });
  }
}
