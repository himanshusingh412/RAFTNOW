import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runTick } from "@/lib/jobs";
import { env } from "@/lib/env";

export const maxDuration = 60;

// Called every minute by Vercel Cron (or Supabase pg_cron + pg_net) with
// "Authorization: Bearer $CRON_SECRET". Runs every due job once.
export async function GET(req: Request) {
  const given = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${env().CRON_SECRET}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runTick());
  } catch (e) {
    console.error("cron tick failed", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "tick_failed" }, { status: 500 });
  }
}
