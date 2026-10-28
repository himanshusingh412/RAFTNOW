import "server-only";
import { z } from "zod";

// Every server secret, validated once. Names match .env.example.
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  RAZORPAY_KEY_ID: z.string().regex(/^rzp_(test|live)_/, "must start with rzp_test_ or rzp_live_"),
  RAZORPAY_KEY_SECRET: z.string().min(1),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(8),
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().min(3), // e.g. "Your App <bookings@yourdomain.in>"
  CRON_SECRET: z.string().min(32),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
      throw new Error(`Missing or invalid environment variables: ${missing}. See .env.example.`);
    }
    if (process.env.NODE_ENV !== "production" && parsed.data.RAZORPAY_KEY_ID.startsWith("rzp_live_")) {
      throw new Error("Live Razorpay key outside production. Use rzp_test_ keys until replica-deploy.");
    }
    cached = parsed.data;
  }
  return cached;
}
