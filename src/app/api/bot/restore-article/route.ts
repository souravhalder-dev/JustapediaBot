import { NextRequest, NextResponse } from "next/server";
import { executeJustapediaEdit } from "@/lib/save-engine";
import { requireAuthorizedUser } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

const JUSTAPEDIA_API = "https://justapedia.org/api.php";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    let explicitToken = "";

    if (authHeader && authHeader.startsWith("Bearer ")) {
      explicitToken = authHeader.substring(7).trim();
    }

    const body = await req.json().catch(() => ({}));
    if (!explicitToken && body.session_token) {
      explicitToken = body.session_token;
    }

    const auth = await requireAuthorizedUser(req, explicitToken);
    if (!auth.authorized) {
      return auth.response;
    }
    const sessionToken = auth.sessionToken;

    const { title = "Grace Hopper", revid = 2000019960 } = body;

    // 1. Fetch exact historical revision wikitext
    const revUrl = `${JUSTAPEDIA_API}?action=query&revids=${revid}&prop=revisions&rvslots=main&rvprop=content&format=json`;
    const revResp = await fetch(revUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      cache: "no-store",
    });

    if (!revResp.ok) {
      return NextResponse.json({ success: false, message: "Failed to fetch historical revision." }, { status: 500 });
    }

    const revData = await revResp.json();
    const pages = revData?.query?.pages;
    const page = pages ? Object.values(pages)[0] as any : null;
    const revision = page?.revisions?.[0];
    const wikitext = revision?.slots?.main?.["*"] || revision?.["*"];

    if (!wikitext) {
      return NextResponse.json({ success: false, message: "Historical wikitext content not found." }, { status: 404 });
    }

    // 2. Save restored wikitext under the user's account
    const saveRes = await executeJustapediaEdit(sessionToken, {
      title,
      wikitext,
      summary: `Restored article content to revision ${revid} by Shahadat`,
      use_sandbox: false,
      is_minor: false,
      is_bot: false,
    });

    return NextResponse.json(saveRes);
  } catch (error: any) {
    return NextResponse.json({ success: false, message: `Restore error: ${error.message}` }, { status: 500 });
  }
}
