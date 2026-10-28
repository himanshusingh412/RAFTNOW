import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";

// Google sign-in lands here with ?code=...; exchange it for a session cookie.
// Only same-site relative paths are accepted for ?next= (no open redirects).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (code) {
    const supabase = await userClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${safeNext}`);
  }
  return NextResponse.redirect(`${origin}/sign-in?error=callback`);
}
