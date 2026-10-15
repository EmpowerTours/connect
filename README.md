# Corridor (working name)

**Farcaster meets LinkedIn for institutional blockchain BD.** A professional network for crypto foundations / L1s, financial institutions (banks, exchanges, custodians, asset managers, market infrastructure), fintechs and LatAm payment rails, consultancies and builders.

Version one is useful with **zero other users**: a partner pipeline + organization directory + signals feed, with an AI scout that drafts outreach in your voice. The social layer (casts-style posts, follows) is there to grow into.

> Local-only MVP. No remote, no deploy, no external services required. "Corridor" is a placeholder name (payment corridors; works in EN/ES).

## Stack
Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS v4 · Prisma 6 + SQLite (swap to Postgres by changing `provider` + `DATABASE_URL`) · Vitest · rss-parser · zod.

## Run it
```bash
cd bdnet
npm install            # also runs prisma generate
cp .env.example .env   # only DATABASE_URL is needed
npm run setup          # create SQLite DB + seed 53 orgs, RSS feeds, demo user/pipeline
npm run ingest         # optional: pull public RSS news and tag it to orgs
npm run dev            # http://localhost:3000 → "Continue as demo user"
```
Other scripts: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:reset`, `npm run screenshots` (needs a running server + Chrome; see `scripts/screenshots.ts`).

`SEED_DEMO=0 npm run db:seed` seeds only the directory and feeds (no demo user/pipeline).

## Features
- **Auth (local stub):** magic-link flow with no email provider — the link is shown on the login page and logged to the server console. One-click demo login in dev (or `ALLOW_DEV_LOGIN=1` with `next start`). Sessions are DB-backed httpOnly cookies.
- **Profiles:** name, handle, role, org, bio, writing voice (feeds the AI scout), language, verification badge placeholder (wallet/SIWE, Farcaster, LinkedIn are stubbed buttons).
- **Organization directory:** 53 seeded real organizations, **public facts only** (name, type, HQ country, website, name aliases). Chains are filled only for a foundation's own network or where the research note cites a public source (Mercado Pago's Meli Dólar on Ethereum; Bitso's MXNB note). Everything else is left empty on purpose. Search, filter by type/region, add orgs, edit facts, follow orgs.
- **Pipeline:** per-user workspace kanban — Awareness → Evaluation → Pilot → Committed (+ Lost). Drag-and-drop or arrow buttons; stage-gate rules (one step forward at a time, any step back, Lost from anywhere). Per deal: use case, next action + due date, **competing chains being evaluated**, contacts/champions, **advisors & influencers** (linked to consultancy orgs), activity log (stage changes logged automatically). Views: "Needs attention" (overdue / stale / no next action — *no warm prospect goes dark*) and "Who is evaluating competing chains".
- **AI scout (pluggable):** `ScoutProvider` interface (`src/lib/scout`). Default offline **mock** provider produces a fit summary, angles and an outreach draft (EN/ES, adapts to your "voice": short/formal) using only facts on file. Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` (optionally `SCOUT_PROVIDER`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`) to use a real model; prompts forbid inventing facts. Drafts are saved per org; nothing is ever sent.
- **Signals feed:** RSS ingestion from public crypto/fintech feeds (CoinDesk, The Block, Decrypt, Ledger Insights, Finextra, CriptoNoticias) + manual signals; auto-tagged to orgs by case-sensitive whole-word name/alias match. Org pages show their signals.
- **Social feed:** 320-char casts, tag orgs with `$slug` (or just mention them by name), follow people and orgs, "Following only" filter, public user pages.
- **Bilingual:** every UI string in `src/lib/i18n.ts` (EN/ES, parity tested); toggle in the header.
- **Dark, mobile-friendly UI:** bottom tab bar on mobile, swipeable kanban columns.

## What's mocked / not done
- No real email delivery (magic link shown on screen). No real verification (badges are placeholders).
- AI scout uses a deterministic template provider unless an API key is set; real providers are wired but untested against live APIs here.
- No contact enrichment, job-post / RWA.xyz / onchain data sources yet. RSS tagging is name matching, not entity resolution.
- Single-user workspaces (no team sharing / roles yet). No notifications.

## Project layout
```
prisma/schema.prisma      data model (SQLite)
prisma/seed-data.ts       53 public-fact orgs
prisma/seed.ts            seed script (+ demo pipeline)
scripts/ingest.ts         RSS ingestion CLI
scripts/screenshots.ts    headless screenshots
src/lib/pipeline.ts       stage rules, grouping, attention, competing-chain map
src/lib/tagging.ts        org mention matching, $slug tags
src/lib/rss.ts, ingest.ts RSS parse + store
src/lib/scout/            AI scout interface, mock, OpenAI/Anthropic providers
src/lib/i18n.ts           EN/ES strings
src/app/actions.ts        server actions
src/app/(app)/…           pipeline, directory, orgs/[slug], feed, profile, u/[handle]
tests/                    vitest unit tests
```
