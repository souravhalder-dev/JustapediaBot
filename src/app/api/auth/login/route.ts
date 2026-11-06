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

    return NextResponse.json(result);
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
