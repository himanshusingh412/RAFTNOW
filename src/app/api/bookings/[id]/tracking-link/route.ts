import { z } from "zod";
import { route, ok, unwrap, parseParams, requireUser } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { uuid } from "@/lib/validation";
import { env } from "@/lib/env";

const params = z.object({ id: uuid });

// A link family can open to follow the raft. Expires 12 hours after the start time.
export const POST = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = parseParams(await ctx.params, params);
  const { supabase, user } = await requireUser();
  await rateLimit("trackingLink", user.id);
  const token = unwrap(await supabase.rpc("create_tracking_link", { p_booking: id })) as string;
  return ok({ url: `${env().NEXT_PUBLIC_SITE_URL}/track/${token}` }, 201);
});
