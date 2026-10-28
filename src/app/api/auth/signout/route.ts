import { route, parseJson, ok } from "@/lib/http";
import { signOut } from "@/lib/validation";
import { userClient } from "@/lib/supabase/server";

// scope "global" signs the user out on every device.
export const POST = route(async (req: Request) => {
  const { scope } = await parseJson(req, signOut);
  const supabase = await userClient();
  await supabase.auth.signOut({ scope });
  return ok({ signedOut: true });
});
