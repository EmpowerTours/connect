# EmpowerTours Connect

Lives at **https://connect.empowertours.xyz**. Powered by Monad; sign-in is Mera passkey wallets only.

**Warm intros and partnerships for institutional blockchain BD.** A professional network for crypto foundations / L1s, financial institutions (banks, exchanges, custodians, asset managers, market infrastructure), fintechs and LatAm payment rails, consultancies and builders.

Mobile-first and calm: three tabs. **Today** greets you, shows one insight from public news signals, a getting-started checklist for new members and the intro requests waiting on you. **Opportunities** is a wallet-style stack of live asks and offers by topic, each with a "Request intro" (through a mutual connection when there is one, otherwise straight to the author). **Circle** draws your warm network as an orbit (connections on the inner ring, people one intro away on the outer ring); tap someone to see the path and request the intro. Profiles are proof-based, and a private pipeline ("My deals") is still there.

> Runs fully locally for development (embedded Postgres, no Docker, no external services). Production runs on Railway; see [Production (Railway)](#production-railway). The product name, host and canonical URL live in one constant: `BRAND` in `src/lib/brand.ts` (rename there; everything user-facing derives from it).

## Fork it in under an hour
Connect is open source (AGPL-3.0, see [License](#license)) and built to be copied: fork it, rename it, and run your own network for a niche (Monad builders, LatAm fintechs, a single ecosystem…). A fresh clone runs locally with **one command and no accounts**: Postgres is embedded (an npm dependency), so there is no Docker or database to install.

**You need:** Node.js 20 or newer (`node -v`), npm and git, on macOS, Linux or Windows (x64 or arm64). About 1 GB of disk for dependencies.

1. **Fork and clone** (about 2 minutes):
   ```bash
   git clone https://github.com/<you>/connect.git
   cd connect
   ```
2. **Install** (about 2-4 minutes; also runs `prisma generate`):
   ```bash
   npm install
   ```
3. **Run everything** (about 1 minute the first time):
   ```bash
   npm run dev:all
   ```
   This creates `.env` from `.env.example`, starts the embedded PostgreSQL on `127.0.0.1:54329` (data in `.data/postgres`), applies the migrations, seeds the public organizations, feeds and channels plus a clearly labelled fictional demo network, and starts the app. Use `npm run dev:all -- --no-demo` for an empty network, or `npm run setup:local` to prepare the database without starting the app.
4. **Open http://localhost:3000** and choose **Continue as demo user**. Ctrl+C stops the app and the database.
5. **Check your fork is healthy**:
   ```bash
   npm test           # unit tests, no database needed
   npm run typecheck
   npm run lint
   npm run build
   ```
6. **Make it yours** (10-20 minutes): rename the product in `src/lib/brand.ts` (name, host, ecosystem; everything user-facing derives from it), edit the organizations in `prisma/seed-data.ts` (public facts only) and the topic channels in `prisma/seed-base.ts`, and the fictional demo people in `prisma/seed-social.ts`. Re-run `npm run dev:all`.
7. **Deploy** (20-30 minutes): follow [docs/deploy-railway.md](docs/deploy-railway.md). Production sign-in uses Mera passkey wallets bound to a domain you control, so read its "Forking for your own domain" section first; the production boot check refuses to start until the passkey domain constants match yours.

Troubleshooting: if port 54329 is taken, set `LOCAL_PG_PORT` and update `DATABASE_URL` in `.env` to match. To start over, stop the app and delete `.data/postgres`. To use an existing Postgres instead, point `DATABASE_URL` in `.env` at it and run `npm run setup && npm run dev`.

## Stack
Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS v4 · Prisma 6 + PostgreSQL (versioned migrations in `prisma/migrations`) · Vitest · rss-parser · zod.

## Run it
One command: `npm install && npm run dev:all` (see [Fork it in under an hour](#fork-it-in-under-an-hour)). The same steps by hand:
```bash
npm install            # also runs prisma generate
cp .env.example .env   # only DATABASE_URL is needed (already points at the local Postgres)
npm run db:start       # embedded Postgres on 127.0.0.1:54329, data in .data/postgres; keep it running
npm run setup          # prisma migrate deploy + seed 53 real orgs, RSS feeds, topic channels (no people)
npm run seed:demo      # optional, LOCAL ONLY: fictional demo people, asks/offers, intros, demo pipeline
npm run logos          # optional: fetch org favicons into public/logos (already committed)
npm run ingest         # optional: pull public RSS news and tag it to orgs
npm run dev            # http://localhost:3000 → "Continue as demo user" (local demo, no wallet)
```
Database scripts: `npm run db:migrate` (after editing `schema.prisma`: creates a new migration with `prisma migrate dev`; commit it), `npm run db:deploy` (apply migrations), `npm run db:check` (fails if the schema and migrations drift), `npm run db:reset` (drop, re-migrate, base seed). Any Postgres works: point `DATABASE_URL` at it instead of running `db:start`.

Other scripts: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:reset`, `npm run screenshots` (demo data; needs a running server + Chrome; see `scripts/screenshots.ts`), `npm run screenshots:real` (a brand-new member on a base-seed + real-news database; starts its own server; see `scripts/screenshots-real.ts`), `npm run screenshots:graph` (feeds, importers and the signed graph on a fresh preview database with a local mock hub/RPC; starts its own server; see `scripts/screenshots-graph.ts`), `npm run graph:verify` (see below).

The default seed (`db:seed`, `setup`, `db:reset`) creates **no people and no content**: only the 53 public-fact organizations, the public news feeds and topic channels. Fictional demo people are only added by `npm run seed:demo`, which refuses to run with `NODE_ENV=production`, inside a Railway environment, or against a database that is not on this machine.

## Features
**Navigation:** mobile has a floating three-tab bar (Today, Opportunities, Circle) and an avatar menu (`/more`) for Intros, Updates, Channels, My deals, Organizations, Signals, profile and language. Desktop uses a slim side rail and a centered single column. Light theme, light-purple accent (#7C3AED for text and buttons, #A78BFA / #C4B5FD for tints), frosted-glass cards.

- **Updates:** 320 characters (code points), post-type chips (Looking for partner, Launch, Hiring, Insight), tag orgs with `$slug` (plain name mentions also tag), mention people with `@handle`, link `/channel`. Reply threads (nested, with connector lines), reshare and quote, likes (optimistic). Following / For you tabs.
- **Channels:** join/leave, channel feeds, trending ranking (recent-activity decay + membership).
- **Profiles:** cover, avatar, headline @ org, location, proof badges (work email, LinkedIn, wallet; all **unverified placeholders**), track record (deals closed, intros made, helpful updates → reputation tier), mutual connections, Follow / Request intro, Updates / Replies / About tabs.
- **Org pages:** logo header with an "Unverified org" pill (no org verification yet), Follow, **Add to my deals**, tabs for updates mentioning the org, people at the org, news signals, public facts, and your private deal panel.
- **Warm intros:** "Request intro" on a profile → pick a mutual connection → give a reason → the scout drafts the ask (editable) → send. The connector accepts (with a forwarded note) or declines; the requester can withdraw. `/intros` has Inbox / Sent / Made tabs with statuses; accepted warm intros count toward the connector's reputation.
- **Asks and offers:** topic (focus tag), region, expiry (7–90 days, default 30). The author can edit, mark filled, close and reopen; only open, unexpired, unhidden posts are listed. "Request intro" on a post uses a mutual connection when one exists, otherwise sends a **direct request** to the author with a short reason; accepting it connects the two members. Members can **report** a post; admins hide or dismiss reports in `/admin?tab=reports` (hidden posts stay visible to their author with a note).
- **My deals (private):** the kanban pipeline from v1 (stage gates, due dates, competing chains, contacts, advisors, activity log, AI scout drafts). Only the count of committed deals shows publicly in the track record.
- **Organization directory:** 53 real organizations with **public facts only** (name, type, HQ country, website, aliases); unknown fields left empty.
- **Signals:** RSS ingestion from public feeds (CoinDesk, The Block, Decrypt, Ledger Insights, Finextra, CriptoNoticias) + manual signals, auto-tagged to orgs.
- **Auth:** Mera passkey wallets (see below); one-click demo login only in dev (or `ALLOW_DEV_LOGIN=1` with `next start`).
- **Bilingual:** EN/ES for every UI string (parity tested).
- **Design:** light theme with a light-purple accent, Inter (self-hosted), uploaded profile photos with initials avatars as fallback, favicon logos with initials fallback, guided empty states, small motion on likes/menus.

### Demo content (clearly labelled)
`npm run seed:demo` adds 8 **fictional** people at fictional companies (Quetzal Rails, Banco Meridiano, Harbor Asset Management, …), their updates, channels, intros, and asks/offers. Every demo account carries a **Demo** badge and a profile note. No real people are impersonated; real organizations only appear as `$tags` in questions and opinions, and real org pages show no people until someone verifies.

## What's mocked / not done
- Work email and LinkedIn verification are placeholders shown as "unverified". Wallets are verified by Mera passkey signature; organization membership by admin-approved claims.
- Intros never leave the app (no email/DM, no notifications beyond the Intros badge).
- AI scout uses a deterministic template provider unless an API key is set; real providers are wired but untested against live APIs here.
- No contact enrichment, job-post / RWA.xyz / onchain data sources yet. RSS tagging is name matching, not entity resolution.
- Single-user workspaces (no team sharing / roles yet). No notifications beyond the Intros badge. No DMs.
- No route-level `loading.tsx`: in this Next 15.5 build, streamed Suspense boundaries stopped server-action refreshes from showing, so pages render in one pass.

## Project layout
```
prisma/schema.prisma      data model (PostgreSQL)
prisma/migrations/        versioned SQL migrations (prisma migrate)
prisma/seed-data.ts       53 public-fact orgs
prisma/seed.ts            default/production seed (orgs, feeds, channels; no people)
prisma/seed-base.ts       the data that seed applies
prisma/seed-demo.ts       LOCAL ONLY demo seed (demo user, pipeline, demo network)
prisma/seed-social.ts     fictional demo network: users, channels, updates, intros, asks/offers
scripts/dev-all.ts        one-command local dev (embedded Postgres, migrate, seed, next dev)
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

## Programmable feed
Updates and channel feeds rank through small `FeedAlgorithm` plugins (`src/lib/feed-algorithms.ts`: an id, EN/ES label and description, and a pure `score()` that can drop a post). Built in: **Latest**, **High-signal** (approved organization members only), **Conversations** (replies weigh most) and **No bait** (likes and reposts without replies count against a post). Register another with `registerFeedAlgorithm()`. Members pick a feed from the chips above the feed (saved to their profile) and use **Tune** to mute focus topics and channels; their own posts are never muted. Admins can give a channel a default feed; members can still switch with `?feed=`.

## Cold-start importers (`/import`)
Everything found becomes a **suggestion**; nothing is followed until the member ticks and confirms.
- **Farcaster:** reads who you follow from a Farcaster hub (`FARCASTER_HUB_URL`, default the free public hub `https://haatz.quilibrium.com`; or Neynar when `NEYNAR_API_KEY` is set). Lookup by username, or by your Mera wallet when it is the account's custody address (hubs cannot search verified addresses; Neynar can). Only members whose Connect wallet is verified on their Farcaster account are matched. If the hub is unreachable the card says so; nothing else breaks.
- **X:** upload `following.js` (plus `account.js`) from the X data export, or a CSV of handles. Nothing is sent to X. Matching uses the X link members put on their profile, so it is self-declared and labelled that way.
- **Wallet starter packs:** read-only `eth_call` balance checks on Monad (chain 143, `MONAD_RPC_URL`, default `https://rpc.monad.xyz`) for the EmpowerTours Passport (Hunt), TURBO cohort and TOURS token contracts. Only `eth_call`, `eth_chainId` and `eth_blockNumber` are allowed; results are cached for a day.

## Signed portable graph (`/sync`, `/graph`)
Follows and unfollows, approved organization memberships, admin approvals and revocations, and accepted intros become **EIP-712 `GraphUpdate` messages** signed by the member's Mera passkey wallet (domain `EmpowerToursConnect`, version 1, chain 143). They are signed messages only: no transaction, no gas, no contract. `/sync` shows what is waiting for a signature (the difference between your Connect state and your signed log) and signs it in one passkey prompt. Each wallet's updates carry a consecutive `seq`; admin actions are only valid from `ADMIN_WALLETS`.

The log is public and read-only: `GET /api/graph/events?cursor=&limit=&author=` (paginated, CORS) and `GET /api/graph/users/{handle|wallet}`; `/graph` and `/graph/{handle}` show it with every signature re-checked. Anyone can verify it without trusting the server:

```bash
npm run graph:verify -- --base https://your-connect-host [--user valeria] [--admins 0x..] [--save graph.json]
npm run graph:verify -- --file graph.json
```

The script uses this repo's own domain and types, checks every signature, sequence gaps and duplicates, and admin authority, rebuilds the graph and exits non-zero on any failure. After pulling schema changes run `npm run db:deploy` to apply new migrations.

## Onboarding and profile photos
After a first Mera passkey sign-in, members go through a three-step welcome flow at `/welcome` before they reach the app; the local demo user skips it:
1. **You:** name, headline and organization. Picking a listed organization can also file a pending claim (wallet-verified members only); an unlisted one becomes an org request for admin review.
2. **Focus:** region and focus tags.
3. **Follow:** **starter packs** and an optional **Farcaster import**. Starter packs (`src/lib/curated-packs.ts`) are curated follow sets built from the seeded organizations and channels: picking one follows its organizations, joins its channels and follows up to 12 people (members verified at those organizations, then the most active posters in those channels). The two packs that best match the focus tags are preselected. The Farcaster lookup uses the same importer as `/import` (public hub, or Neynar with `NEYNAR_API_KEY`); people you follow there who are already here show up ticked, and an empty Connect bio is filled from your Farcaster bio. If the source is unreachable the step says so and the packs still work.

Photo, links and a first ask/offer are no longer onboarding steps: the Today checklist points to them, and region, focus tags, photo and links stay editable on `/profile`.

Photos are sniffed by magic bytes (JPEG, PNG or WebP only), capped at 5 MB, at least 64 px and at most 40 MP, then re-encoded with sharp to a 512×512 WebP, which drops EXIF/GPS and all other metadata. Storage sits behind a small `BlobStore` interface (`src/lib/storage.ts`), chosen with `STORAGE_DRIVER`:
- `local` (default): files under `.data/uploads`, or `UPLOADS_DIR`. In production `UPLOADS_DIR` must be an absolute path on a mounted Railway volume (the container disk is replaced on every deploy).
- `s3`: any S3-compatible bucket through signed requests (`aws4fetch`, no AWS SDK). Recommended: Cloudflare R2 (no egress fees, 10 GB free). Set `S3_ENDPOINT` (`https://<account id>.r2.cloudflarestorage.com`), `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_REGION=auto`. The bucket stays private; photos are still served from `/media/avatars/…` on this origin.

Either way photos are served with a strict content-type and CSP.

## Production (Railway)
Step-by-step launch guide (accounts, variables, domain, R2, first admin, costs, forking for your own domain): [docs/deploy-railway.md](docs/deploy-railway.md).

- **Build:** `Dockerfile` (multi-stage, Node 20, Next `output: "standalone"`). `NEXT_PUBLIC_RP_ID` is inlined at build time, so it must be set as a Railway variable before the first build.
- **Start:** `node start.mjs` (`scripts/start.mjs`) runs `prisma migrate deploy`, optionally the base seed (`SEED_ON_BOOT=1`, first deploy only), then the standalone server. `NODE_OPTIONS=--max-old-space-size=256` caps the heap, leaving room in a ~384 MB container for native memory (sharp runs with its cache off and one thread); the server idles around 150 MB RSS. The image runs under `tini` (ENTRYPOINT, and the Railway start command `/usr/bin/tini -- node start.mjs`) so SIGTERM reaches Node: the Next server drains in-flight requests and exits, with an 8 s cap (`SHUTDOWN_GRACE_MS`).
- **Health:** `GET /api/health` checks the database (200 or 503). Railway waits for it before switching traffic.
- **Infrastructure as code:** `.railway/railway.ts` declares the service, Postgres, healthcheck, domain and variable names (secret values are kept in Railway with `preserve()`). Railway no longer accepts `railway.json` for new services. `npm run typecheck` also checks this file.
- **Logs and errors:** server logs are JSON lines (`src/lib/log.ts`: `ts`, `level`, `msg`, `requestId` and context; `LOG_LEVEL` sets the threshold). Page requests carry an `x-request-id` (set in the middleware, reusing Railway's id when present) so one request's lines can be grouped. Every uncaught server error goes through `onRequestError` in `src/instrumentation.ts`; with `SENTRY_DSN` set it is also sent to Sentry by a small built-in reporter (`src/lib/error-report.ts`, no SDK, no build plugin). Unset, nothing is sent anywhere.
- **Boot check:** in production the server refuses to start when `DATABASE_URL`, `AUTH_SESSION_SECRET`, `NEXT_PUBLIC_RP_ID`, Upstash, `ADMIN_WALLETS` or the storage variables are missing or unsafe, or when `ALLOW_DEV_LOGIN` is set (`src/lib/env.ts`). Messages name the variable, never the value.
- **Rate limits:** sign-in nonce and verify, posting, intro requests, reports, photo uploads, imports and graph signing (`src/lib/rate-limit.ts`). Fixed windows in Upstash Redis when configured, in process memory otherwise. Over the limit, APIs answer 429 with `Retry-After`; forms show a translated "try again in N minutes". A Redis outage fails open for rate limits, while login nonces stay fail-closed.
- **Security headers:** nonce-based CSP with `strict-dynamic` for pages (`src/middleware.ts`), plus HSTS, `nosniff`, `X-Frame-Options: DENY`, a strict referrer policy and a Permissions-Policy that only allows passkeys on this origin (`src/lib/security-headers.ts`). Session and locale cookies are `Secure` in production.
- **News ingest without a cron:** when someone opens Today or Signals and the feeds are older than 6 hours, one ingest runs in the background after the response (a shared claim in Redis keeps it to one run per 30 minutes across instances). Admins can refresh by hand on `/signals`. An external scheduler can call `POST /api/cron/ingest` with `Authorization: Bearer $CRON_SECRET`; without a 32+ character `CRON_SECRET` that route is a 404.

## Contributing and security
- Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md).
- Found a vulnerability? Please report it privately: see [SECURITY.md](SECURITY.md).
- Contributions are accepted under the contributor grant in [CONTRIBUTING.md](CONTRIBUTING.md#licensing-your-contribution).

## License
**GNU AGPL-3.0**: see [LICENSE](LICENSE) and [NOTICE](NOTICE).
Copyright © 2026 EmpowerTours S.A.S. de C.V.

You may read, run, modify and redistribute this software. If you run a **modified** version as a network service, AGPL section 13 requires you to offer your users the complete corresponding source of your version under this same license. For a hosted web app that is the clause that matters: you may fork this and run your own network, but you may not fork it, close it, and compete.

**Dual licensed.** AGPL-3.0 as above, or a **commercial license** from EmpowerTours S.A.S. de C.V. for anyone who wants to build on this without AGPL section 13's obligations, i.e. to run a modified version as a service with their own source closed. Enquiries: admin@empowertours.xyz

No rights are granted to the EmpowerTours name or logo. Organization names and the favicons in `public/logos/` are trademarks of their respective owners, are included only to identify those organizations, and are not covered by either license.
