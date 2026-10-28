"use client";
import { createBrowserClient } from "@supabase/ssr";

// For client components (screens come with /replica-build). Publishable key only.
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
