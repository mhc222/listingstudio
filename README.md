This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The repo is linked to the Vercel project `listing-studio` (scope `mhc222s-projects`, `.vercel/` gitignored).

1. **Env vars** (once, or when a key rotates): `bash scripts/vercel-env-push.sh` — pushes the production env from `.env.local` (Supabase URL/keys, `FAL_KEY`, `ANTHROPIC_API_KEY` + `ANTHROPIC_WORKSPACE_ID`, `CRON_SECRET`). `LOCAL_IMAGING_BASE_URL` stays local-only.
2. **Deploy**: `vercel deploy --prod --yes`.
3. **`NEXT_PUBLIC_APP_URL`** must be the prod origin (e.g. `https://listing-studio.vercel.app`) — it's what the orchestrator hands fal as the webhook URL. Set it after the first deploy reveals the domain, then redeploy (env changes only apply to new deployments). While it's unset/localhost, no webhook is sent and the reconcile cron is the completion path.
4. **Cron**: `vercel.json` registers `/api/cron/reconcile` every minute. Vercel invokes it with `Authorization: Bearer $CRON_SECRET` automatically because the `CRON_SECRET` env var is set — the route already checks that. (Hobby plans only allow daily crons; this schedule needs a Pro team.)
5. **Supabase**: same project serves dev and prod — RLS, buckets, and migrations 0001–0005 are already live, nothing to reconfigure. Password login works as-is; only if magic links are ever used, add the prod URL under Auth → URL Configuration.
6. **Verify**: log in on prod, run a cheap job (ITEM_REMOVAL), confirm it completes via webhook (job completes without hitting `/api/cron/reconcile?all=1`) — that exercises the fal ED25519 signature verification for the first time.

No keys are committed: `.env*` is gitignored (`.env.example` documents the names).
