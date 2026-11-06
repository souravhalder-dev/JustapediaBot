import { NextRequest, NextResponse } from "next/server";
import { executeJustapediaEdit } from "@/lib/save-engine";
import { requireAuthorizedUser } from "@/lib/api-guard";
import { SaveArticleRequest } from "@/lib/types";

export const dynamic = "force-dynamic";

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

    if (!body.title || typeof body.wikitext !== "string") {
      return NextResponse.json(
        {
          success: false,
          title: body.title || "Unknown",
          message: "Missing 'title' or 'wikitext' in request body.",
        },
        { status: 400 }
      );
    }

    const saveRequest: SaveArticleRequest = {
      title: body.title,
      wikitext: body.wikitext,
      summary: body.summary || "Automated reference & link preservation edit via Justapedia Bot Suite",
      basetimestamp: body.basetimestamp,
      is_minor: body.is_minor !== undefined ? body.is_minor : true,
      is_bot: body.is_bot !== undefined ? body.is_bot : true,
      use_sandbox: Boolean(body.use_sandbox),
    };

    const result = await executeJustapediaEdit(sessionToken, saveRequest);

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        title: "Error",
        message: `Internal save error: ${error.message || String(error)}`,
      },
      { status: 500 }
    );
  }
}
