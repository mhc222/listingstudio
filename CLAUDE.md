# Listing Studio

Self-hosted real estate photo enhancement replacing BoxBrownie for one power user. BoxBrownie-style job model, AI image APIs instead of human editors.

## Stack (do not substitute without asking)
Next.js 15 App Router, TypeScript, Tailwind, shadcn/ui, Supabase (Postgres/Auth/Storage), fal.ai behind `lib/imaging.ts`, Claude API for copywriting + interpreter only, Marzipano, sharp, Konva, Vercel. All storage access via `lib/storage.ts`.

## Commands
`npm run dev` · `npm run build` (must pass before every commit) · `npm run lint`

## Hard rules
- **Never await image generation in a request handler.** fal queue API + webhooks only; idempotent (conditional status updates), signature-verified, backed by the reconciliation cron.
- **Never self-host FLUX Kontext dev / FLUX.2 dev weights** (non-commercial licence).
- **Geometry constraint sentences are verbatim, never paraphrased.**
- **Never build or stub:** CGI renders from architectural plans, development site plans, retail background removal, automotive/marine variants.
- **Never infer floor plans from room photos.**
- Prompt templates are named exports in `prompts.ts`; user comments append, never replace.
- Originals immutable; output versions additive, nothing overwritten.
- Every API call, retries and QA re-runs included, hits SpendLedger exactly once.
- Keys in `.env.local`, documented in `.env.example`, never committed.

## Session protocol
Read PROGRESS.md and DECISIONS.md first, trust them over memory. Do exactly ONE phase from PLAN.md. Commit each meaningful unit; never end uncommitted. On done: build, tick the phase, update PROGRESS.md, log decisions, commit, state the manual test, tell the user to `/clear`. On a usage-limit warning: commit WIP and write keystroke-level next actions into PROGRESS.md. Full protocol in the reference doc.

## Pointers
Read **docs/claude-reference.md** before working on the domain model, edit-type catalog, interpreter loop, prompt engineering, job orchestration, or inspiration features.
