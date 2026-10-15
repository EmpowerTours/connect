# EmpowerTours Connect

Lives at **https://connect.empowertours.xyz**. Powered by Monad; sign-in is Mera passkey wallets only.

**Warm intros and partnerships for institutional blockchain BD.** A professional network for crypto foundations / L1s, financial institutions (banks, exchanges, custodians, asset managers, market infrastructure), fintechs and LatAm payment rails, consultancies and builders.

Mobile-first and calm: three tabs. **Today** greets you, shows one insight from public news signals and the intro requests waiting on you. **Opportunities** is a wallet-style stack of asks and offers, each with a "Request intro" that uses your warm path. **Circle** draws your warm network as an orbit (connections on the inner ring, people one intro away on the outer ring); tap someone to see the path and request the intro. Profiles are proof-based, and a private pipeline ("My deals") is still there.

> Local-only MVP. No remote, no deploy, no external services required for the demo. The product name, host and canonical URL live in one constant: `BRAND` in `src/lib/brand.ts` (rename there; everything user-facing derives from it).

## Stack
Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS v4 · Prisma 6 + SQLite (swap to Postgres by changing `provider` + `DATABASE_URL`) · Vitest · rss-parser · zod.

## Run it
```bash
cd bdnet
npm install            # also runs prisma generate
cp .env.example .env   # only DATABASE_URL is needed
npm run setup          # create SQLite DB + seed 53 real orgs, RSS feeds, topic channels (no people)
npm run seed:demo      # optional, LOCAL ONLY: fictional demo people, asks/offers, intros, demo pipeline
npm run logos          # optional: fetch org favicons into public/logos (already committed)
npm run ingest         # optional: pull public RSS news and tag it to orgs
npm run dev            # http://localhost:3000 → "Continue as demo user" (local demo, no wallet)
```
Other scripts: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:reset`, `npm run screenshots` (needs a running server + Chrome; see `scripts/screenshots.ts`).

The default seed (`db:seed`, `setup`, `db:reset`) creates **no people and no content**: only the 53 public-fact organizations, the public news feeds and topic channels. Fictional demo people are only added by `npm run seed:demo`, which refuses to run with `NODE_ENV=production`.

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
`npm run seed:demo` adds 8 **fictional** people at fictional companies (Quetzal Rails, Banco Meridiano, Harbor Asset Management, …), their updates, channels, intros, and asks/offers. Every demo account carries a **Demo** badge and a profile note. No real people are impersonated; real organizations only appear as `$tags` in questions and opinions, and real org pages show no people until someone verifies.

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
prisma/seed.ts            default/production seed (orgs, feeds, channels; no people)
prisma/seed-base.ts       the data that seed applies
prisma/seed-demo.ts       LOCAL ONLY demo seed (demo user, pipeline, demo network)
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


## Sign-in: Mera passkey wallets (Monad)
Mirrors the EmpowerTours Hunt app. **Mera wallets only**: no MetaMask, WalletConnect, injected or other wallets.

1. Browser (`src/lib/mera/client.ts`): the Mera SDK (`@category-labs/mera`) runs a WebAuthn ceremony and returns 32 PRF bytes for (passkey, `NEXT_PUBLIC_RP_ID`, the EmpowerTours-wide PRF salt `empowertours-hunt/passkey/v1`, shared with Hunt and TURBO). These are mapped to BIP-39 → `m/44'/60'/0'/0/0`, giving an ordinary EVM address. **Wallets are intentionally shared across EmpowerTours apps:** same passkey + same rpId + same salt = the same address as in Hunt and TURBO (`tests/ecosystem-wallet.test.ts` checks Connect against Hunt's derivation vectors). Connect only ever asks that key for off-chain sign-in signatures under its own EIP-712 domain.
2. The browser fetches a nonce (`GET /api/auth/nonce`) and signs an EIP-712 `Session` message (domain `EmpowerToursConnect`, v1, chainId 143 = Monad). This is an off-chain signature, **never a transaction**.
3. `POST /api/auth/session` recovers the signer (`src/lib/mera/verify.ts`): pinned statement, ±120 s clock skew, single-use nonce (memory store in dev, Upstash Redis required in production). On success it sets an HttpOnly, SameSite=Lax HMAC session cookie (`connect_session`, 7 days, `AUTH_SESSION_SECRET`).
4. A wallet with no profile gets 404, and the browser signs a `Registration` message (wallet + display name + credential id) to `POST /api/auth/register`, which creates the profile with the wallet linked (`walletVerified`).
5. A signed-in profile without a wallet (e.g. the demo user) can link one from **Edit profile → Mera wallet** (`POST /api/auth/link`, separate pinned statement).

Linked wallets show a **Verified on Monad** badge on the profile. All write actions (updates, asks/offers, intros, pipeline) go through `requireUser()`; no session, no write.

**Local demo login** ("Continue as demo user") still works without any Mera config. It is a separate DB-backed cookie, only honoured when `NODE_ENV !== "production"` or `ALLOW_DEV_LOGIN=1`.

Config for real Mera sign-in (see `.env.example`): `AUTH_SESSION_SECRET` (≥ 32 random chars), `NEXT_PUBLIC_RP_ID` (`empowertours.xyz` in production, the shared parent; per-host values like `connect.empowertours.xyz` are refused because they would mint a different wallet), `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (required in production). Passkeys need HTTPS (or `localhost`) and a PRF-capable authenticator.

## Organizations: claims and admin review
A passkey-verified member can **claim membership** of an organization (role, optional evidence link, note) from the org's People tab, or **request a new organization** that isn't listed. Claims stay **pending** until an admin approves them; only approved claims count as **verified members** on org pages. Admins are the wallets listed in `ADMIN_WALLETS`, signed in with a Mera passkey (the local demo login is never an admin); `/admin` is a 404 for everyone else. Org pages state that listing is based on public information and does not imply the organization endorses Connect.

## Onboarding and profile photos
After a first Mera passkey sign-in, members go through a five-step welcome flow at `/welcome` (name + headline, organization, region + focus tags, photo + links, first ask/offer) before they reach the app; the local demo user skips it. Picking a listed organization can also file a pending claim (wallet-verified members only); an unlisted one becomes an org request for admin review. Region, focus tags, photo and links stay editable on `/profile`.

Photos are sniffed by magic bytes (JPEG, PNG or WebP only), capped at 5 MB, at least 64 px and at most 40 MP, then re-encoded with sharp to a 512×512 WebP, which drops EXIF/GPS and all other metadata. Storage sits behind a small `BlobStore` interface (`src/lib/storage.ts`); the only driver today is `local` (files under `.data/uploads`, or `UPLOADS_DIR`), served from `/media/avatars/…` with a strict content-type and CSP. An S3/R2 driver can be added behind `STORAGE_DRIVER` without touching callers. Local disk is not durable on serverless hosts, so production needs that driver first.
