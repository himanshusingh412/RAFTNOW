import { route, parseJson, ok, clientIp, HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { otpRequest } from "@/lib/validation";
import { userClient } from "@/lib/supabase/server";

// Emails a 6-digit sign-in code. Creates the account on first use.
export const POST = route(async (req: Request) => {
  const { email } = await parseJson(req, otpRequest);
  await rateLimit("otp", `ip:${clientIp(req)}`);
  await rateLimit("otp", `email:${email}`);

  const supabase = await userClient();
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw new HttpError(error.status === 429 ? 429 : 400, "otp_failed", "Couldn't send the code. Try again shortly.");
  return ok({ sent: true });
});
