# Corridor (working name)

**Warm intros and partnerships for institutional blockchain BD.** A professional network for crypto foundations / L1s, financial institutions (banks, exchanges, custodians, asset managers, market infrastructure), fintechs and LatAm payment rails, consultancies and builders.

Mobile-first and calm: three tabs. **Today** greets you, shows one insight from public news signals and the intro requests waiting on you. **Opportunities** is a wallet-style stack of asks and offers, each with a "Request intro" that uses your warm path. **Circle** draws your warm network as an orbit (connections on the inner ring, people one intro away on the outer ring); tap someone to see the path and request the intro. Profiles are proof-based, and a private pipeline ("My deals") is still there.

> Local-only MVP. No remote, no deploy, no external services required. "Corridor" is a placeholder name (payment corridors; works in EN/ES).

## Stack
Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS v4 · Prisma 6 + SQLite (swap to Postgres by changing `provider` + `DATABASE_URL`) · Vitest · rss-parser · zod.

## Run it
```bash
cd bdnet
npm install            # also runs prisma generate
cp .env.example .env   # only DATABASE_URL is needed
npm run setup          # create SQLite DB + seed 53 orgs, RSS feeds, demo user/pipeline, demo network
npm run logos          # optional: fetch org favicons into public/logos (already committed)
npm run ingest         # optional: pull public RSS news and tag it to orgs
npm run dev            # http://localhost:3000 → "Continue as demo user"
```
Other scripts: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:reset`, `npm run screenshots` (needs a running server + Chrome; see `scripts/screenshots.ts`).

`SEED_DEMO=0 npm run db:seed` seeds only the directory and feeds (no demo user/pipeline).

## Features
**Navigation:** mobile has a floating three-tab bar (Today, Opportunities, Circle) and an avatar menu (`/more`) for Intros, Updates, Channels, My deals, Organizations, Signals, profile and language. Desktop uses a slim side rail and a centered single column. Light theme, light-purple accent (#7C3AED for text and buttons, #A78BFA / #C4B5FD for tints), frosted-glass cards.

- **Updates:** 320 characters (code points), post-type chips (Looking for partner, Launch, Hiring, Insight), tag orgs with `$slug` (plain name mentions also tag), mention people with `@handle`, link `/channel`. Reply threads (nested, with connector lines), reshare and quote, likes (optimistic). Following / For you tabs.
- **Channels:** join/leave, channel feeds, trending ranking (recent-activity decay + membership).
- **Profiles:** cover, avatar, headline @ org, location, proof badges (work email, LinkedIn, wallet; all **unverified placeholders**), track record (deals closed, intros made, helpful updates → reputation tier), mutual connections, Follow / Request intro, Updates / Replies / About tabs.
- **Org pages:** logo header with an "Unverified org" pill (no org verification yet), Follow, **Add to my deals**, tabs for updates mentioning the org, people at the org, news signals, public facts, and your private deal panel.
- **Warm intros:** "Request intro" on a profile → pick a mutual connection → give a reason → the scout drafts the ask (editable) → send. The connector accepts (with a forwarded note) or declines; the requester can withdraw. `/intros` has Inbox / Sent / Made tabs with statuses; accepted intros count toward the connector's reputation.
- **My deals (private):** the kanban pipeline from v1 (stage gates, due dates, competing chains, contacts, advisors, activity log, AI scout drafts). Only the count of committed deals shows publicly in the track record.
- **Organization directory:** 53 real organizations with **public facts only** (name, type, HQ country, website, aliases); unknown fields left empty.
- **Signals:** RSS ingestion from public feeds (CoinDesk, The Block, Decrypt, Ledger Insights, Finextra, CriptoNoticias) + manual signals, auto-tagged to orgs.
- **Auth (local stub):** magic link shown on screen; one-click demo login in dev (or `ALLOW_DEV_LOGIN=1` with `next start`).
- **Bilingual:** EN/ES for every UI string (parity tested).
- **Design:** high-contrast dark theme, one violet accent, Inter (self-hosted), initials avatars, favicon logos with initials fallback, empty states, a shimmer skeleton while AI drafts, small motion on likes/menus.

### Demo content (clearly labelled)
The seed adds 8 **fictional** people at fictional companies (Quetzal Rails, Banco Meridiano, Harbor Asset Management, …), their updates, channels, intros, and asks/offers. Every demo account carries a **Demo** badge and a profile note. No real people are impersonated; real organizations only appear as `$tags` in questions and opinions, and real org pages show no people until someone verifies.

## What's mocked / not done
- No real email delivery (magic link shown on screen). No real verification: work email, LinkedIn, wallet and org verification are placeholders shown as "unverified".
- Intros never leave the app (no email/DM). The connector side is exercised with demo data; you can only log in as the demo user locally.
- AI scout uses a deterministic template provider unless an API key is set; real providers are wired but untested against live APIs here.
- No contact enrichment, job-post / RWA.xyz / onchain data sources yet. RSS tagging is name matching, not entity resolution.
- Single-user workspaces (no team sharing / roles yet). No notifications beyond the Intros badge. No DMs.
- No route-level `loading.tsx`: in this Next 15.5 build, streamed Suspense boundaries stopped server-action refreshes from showing, so pages render in one pass.

## Project layout
```
prisma/schema.prisma      data model (SQLite)
prisma/seed-data.ts       53 public-fact orgs
prisma/seed.ts            seed script (+ demo pipeline)
prisma/seed-social.ts     fictional demo network: users, channels, updates, intros, asks/offers
scripts/fetch-logos.ts    favicon fetcher → public/logos
scripts/ingest.ts         RSS ingestion CLI
scripts/screenshots.ts    headless screenshots
src/lib/pipeline.ts       stage rules, grouping, attention, competing-chain map
src/lib/tagging.ts        org mention matching, $slug tags
src/lib/rss.ts, ingest.ts RSS parse + store
src/lib/posts.ts          update validation, mentions, tokenizer, threading, trending
src/lib/intros.ts         intro state machine, mutual connections, reputation
src/lib/circle.ts         warm network rings, warm path, orbit placement
src/lib/today.ts          greeting, hero insight from signals
src/lib/opportunities.ts  ask/offer validation
src/lib/feed.ts           feed queries (home, channel, user, org)
src/lib/scout/            AI scout interface (fit + intro drafts), mock, OpenAI/Anthropic
src/lib/i18n.ts           EN/ES strings
src/app/actions.ts        server actions
src/app/(app)/…           today (/), opportunities, circle, more, updates, post/[id], channels, intros, u/[handle], orgs, pipeline, signals, search
src/components/           shell/nav, composer, post card + actions, intro modal, deal panel
tests/                    vitest unit tests
```
