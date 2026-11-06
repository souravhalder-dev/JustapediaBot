import { NextRequest, NextResponse } from "next/server";
import { verifyUserSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization");
    let token = "";

    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    } else {
      const cookieVal = req.cookies.get("justapedia_session")?.value;
      if (cookieVal) {
        token = cookieVal.trim();
      } else {
        const urlToken = req.nextUrl.searchParams.get("token");
        if (urlToken) token = urlToken;
      }
    }

    if (!token) {
      return NextResponse.json(
        { logged_in: false, message: "No session token provided" },
        { status: 401 }
      );
    }

    const verification = await verifyUserSession(token);

    if (!verification.valid || !verification.user) {
      return NextResponse.json(
        { logged_in: false, message: verification.error || "Invalid session" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      logged_in: true,
      user: verification.user,
    });
  } catch (error: any) {
    return NextResponse.json(
      { logged_in: false, message: `Error verifying session: ${error.message}` },
      { status: 500 }
    );
  }
}
