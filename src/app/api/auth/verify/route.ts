import { route, parseJson, ok, clientIp, HttpError } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";
import { otpVerify } from "@/lib/validation";
import { userClient } from "@/lib/supabase/server";

// Checks the emailed code and sets the session cookie (http-only, set by @supabase/ssr).
export const POST = route(async (req: Request) => {
  const { email, code } = await parseJson(req, otpVerify);
  await rateLimit("otp", `verify-ip:${clientIp(req)}`);

  const supabase = await userClient();
  const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
  if (error || !data.user) throw new HttpError(401, "invalid_code", "That code is wrong or has expired.");
  return ok({ userId: data.user.id });
});
