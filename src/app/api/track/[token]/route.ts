import { z } from "zod";
import { route, unwrap, parseParams, HttpError } from "@/lib/http";
import { userClient } from "@/lib/supabase/server";

const params = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });

// Public, but only with the unguessable token. Returns no names, phones or prices.
export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = parseParams(await ctx.params, params);
  const supabase = await userClient();
  const t = unwrap(await supabase.rpc("get_tracking", { p_token: token }));
  if (!t) throw new HttpError(404, "not_found", "This tracking link has expired.");
  return new Response(JSON.stringify(t), {
    headers: { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
});
