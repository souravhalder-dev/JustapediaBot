import { NextRequest, NextResponse } from "next/server";
import { loginToJustapedia } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { username, password } = body;

    if (!username || !password) {
      return NextResponse.json(
        { success: false, message: "Username and password are required." },
        { status: 400 }
      );
    }

    const result = await loginToJustapedia(username, password);

    if (!result.success) {
      const isForbidden = result.message?.includes("Access Restricted") || result.message?.includes("Bot or Administrator");
      return NextResponse.json(result, { status: isForbidden ? 403 : 401 });
    }

    const response = NextResponse.json(result);

    // Set secure HttpOnly session cookie for edge middleware & browser navigations
    if (result.session_token) {
      response.cookies.set("justapedia_session", result.session_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60, // 7 days
      });
    }

    return response;
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        message: `Internal server error: ${error.message || String(error)}`,
      },
      { status: 500 }
    );
  }
}
