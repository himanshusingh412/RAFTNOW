# rafting-app

A rafting-trip marketplace backend: routes and trip times, seat holds, Razorpay payments and refunds, verified operators with fair rotation, trip-day checkpoints and tracking. It's a clean-room rebuild of RaftingX's core features. The working name gets replaced by `/replica-brand`.

Stack: Next.js 16 route handlers · Supabase (Postgres, Auth, RLS) · Razorpay · Resend · Vercel Cron.

```bash
npm install
cp .env.example .env.local     # fill in your own test-mode keys
supabase start                 # local Supabase (needs Docker Desktop)
supabase db reset              # migrations + fake seed data
npm run dev

npm test                       # unit tests
npm run test:db                # migrations + 96 database checks on a throwaway Postgres
```

- Plan: `replica/architecture.md`
- What's built, the security checklist and your setup steps: `replica/backend.md`
- Business rules (pricing, holds, refunds, rotation) live in `supabase/migrations/20261024000002_functions.sql`
- Tunable numbers live in the `settings` table
