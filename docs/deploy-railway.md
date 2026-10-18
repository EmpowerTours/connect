# Deploying Connect on Railway

A step-by-step guide to running Connect in production on [Railway](https://railway.com) with Railway Postgres, [Upstash](https://upstash.com) Redis and an S3-compatible bucket ([Cloudflare R2](https://developers.cloudflare.com/r2/) recommended) for profile photos. The reference deployment is `https://connect.empowertours.xyz`; replace that host with your own everywhere below.

Running your own fork? Read [Forking for your own domain](#forking-for-your-own-domain) first: the production boot check is pinned to the EmpowerTours passkey domain and needs a small code change before it will start on another domain.

Steps that publish something or cost money are marked **[costs / publishes]**.

---

## 0. Before you start

- A Railway account. The Hobby plan is enough.
- A Cloudflare account for R2 (the free tier is enough, but R2 needs a payment method on file), or any other S3-compatible bucket.
- An Upstash account. The free plan allows one Redis database. Several apps can share it: every Connect key is prefixed `connect:` (`connect:nonce:…`, `connect:rl:…`).
- A passkey on a PRF-capable authenticator (recent iCloud Keychain, Google Password Manager, 1Password, YubiKey 5 series…). Passkeys need HTTPS on the relying-party domain.

Sanity check before any push: `git ls-files | grep -E '^\.env($|\.)'` must print only `.env.example`. `.env`, `.data/` (local Postgres and uploads) and `prisma/*.db` are gitignored.

## 1. Railway project, Postgres and the web service **[costs / publishes]**

Pick one of two ways.

### Option A: dashboard (simplest)
1. Railway → **New Project** → **Deploy from GitHub repo** → your repository. Name the service `connect`.
   - Railway detects the `Dockerfile`. New services cannot use `railway.json`; the settings below go in the dashboard, or use Option B.
2. In the same project: **+ New** → **Database** → **PostgreSQL**. Name it `connect-postgres`.
3. Service `connect` → **Settings**:
   - **Deploy → Custom Start Command:** `/usr/bin/tini -- node start.mjs` (tini forwards SIGTERM so shutdowns are graceful).
   - **Deploy → Healthcheck Path:** `/api/health`, timeout `120`.
   - **Deploy → Restart Policy:** On Failure, 5 retries.
   - **Replicas:** 1. **Serverless / App Sleeping:** off (it saves little and makes the first request after idle slow).
   - **Cron Schedule:** leave empty. No cron service is needed (section 7).
4. Add the variables from section 2 **before the first build**: `NEXT_PUBLIC_RP_ID` is compiled into the browser bundle.

### Option B: infrastructure as code (`.railway/railway.ts`)
`.railway/railway.ts` declares the `connect` service from GitHub, `connect-postgres`, the healthcheck, the custom domain in production and the variable names. Secret values stay in Railway through `preserve()`. It is scoped with `partial = "connect"`, so it never touches other services in the same project. Edit the GitHub repository and domain in that file for a fork.
```bash
npx @railway/cli login
npx @railway/cli link            # choose the project and environment
npx @railway/cli config plan     # review; nothing changes yet
npx @railway/cli config apply    # creates/updates the service, Postgres and domain
```
Then set the secret values (section 2) in the dashboard. `preserve()` keeps whatever is set there.

### What happens on each deploy
1. Docker build (multi-stage, Node 20, Next standalone output). It also bundles the base seed into `seed.cjs` and installs a pinned Prisma CLI for migrations.
2. On start, `node start.mjs` runs:
   1. `prisma migrate deploy`. This applies committed migrations only; it never resets or pushes.
   2. The base seed, only if `SEED_ON_BOOT=1`.
   3. The Next server.
3. The server checks its configuration and **refuses to start** if anything required is missing or unsafe (`src/lib/env.ts`). The log names the variable, never the value. Railway keeps the previous healthy deploy running.
4. Railway waits for `GET /api/health` to return 200 (database reachable) before switching traffic.

## 2. Environment variables (names only)

Set these on the `connect` service (Variables tab). Never commit values.

| Variable | Value / where it comes from |
| --- | --- |
| `DATABASE_URL` | Reference: `${{connect-postgres.DATABASE_URL}}` (private network) |
| `NODE_ENV` | `production` (the Dockerfile sets it too) |
| `PORT` | `3000`. Pin it so the server port and the domain's target port always agree |
| `NEXT_PUBLIC_RP_ID` | The passkey relying-party id (`empowertours.xyz` for the reference deployment). Set it before the first build: it is baked into the bundle, and the boot check compares the build value and the runtime value |
| `AUTH_SESSION_SECRET` | 32+ random characters, e.g. `openssl rand -hex 32`. A new value signs everyone out. Do not reuse another app's secret |
| `UPSTASH_REDIS_REST_URL` | Upstash console → database → REST API (https URL) |
| `UPSTASH_REDIS_REST_TOKEN` | Same page (the full token, not the read-only one) |
| `ADMIN_WALLETS` | Admin wallet address(es), comma-separated (section 5) |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | `https://<cloudflare account id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | e.g. `connect-media` |
| `S3_ACCESS_KEY_ID` | R2 API token (section 4) |
| `S3_SECRET_ACCESS_KEY` | R2 API token (section 4) |
| `S3_REGION` | `auto` |
| `SEED_ON_BOOT` | `1` for the first deploy only, then delete it (section 6) |

Optional:
- `SENTRY_DSN`: send server errors to Sentry (no SDK; one HTTPS request per error). `LOG_LEVEL`: `debug` / `info` / `warn` / `error`.
- `CRON_SECRET`: only if an external scheduler should call the ingest endpoint (section 7).
- `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`: the AI scout. Without one it uses template drafts.
- `FARCASTER_HUB_URL` / `MONAD_RPC_URL`: importer back ends, both optional (see the README). The Farcaster import uses public hubs only.

**Never set** `ALLOW_DEV_LOGIN` in production; the boot check refuses it.

Alternative to R2: `STORAGE_DRIVER=local` with `UPLOADS_DIR=/data/uploads` and a Railway volume mounted at `/data`. Two catches:
- Railway volumes mount as root and the container runs as a non-root user, so this also needs `RAILWAY_RUN_UID=0`.
- A volume pins the service to one replica and makes deploys briefly stop the old container.

Railway's own S3-compatible buckets also work with the same `s3` driver.

## 3. Custom domain **[publishes]**

1. Railway → service `connect` → **Settings → Networking → Public Networking**.
   - **Generate Domain** gives a `*.up.railway.app` test URL. Passkey sign-in only works on hosts under `NEXT_PUBLIC_RP_ID`, so there you can check `/api/health` and the pages but not sign-in.
   - Then **+ Custom Domain**: your host (e.g. `connect.example.com`), target port `3000`.
2. Railway shows **two records**: a `CNAME` for the host pointing at a unique `*.up.railway.app` target, and a `TXT` verification record. Add both at your DNS provider, copying the values exactly. With only the CNAME the domain returns 404. A host cannot have a CNAME and other records, so remove any existing A or redirect record for that host first.
3. Wait for the green check in Railway. The Let's Encrypt certificate is issued automatically, usually within an hour.
4. Behind Cloudflare: easiest is **DNS only** (grey cloud). With the proxy on (orange cloud), set SSL/TLS to **Full**, and note that Railway then sees Cloudflare's IP instead of the visitor's, so per-IP rate limits are shared per Cloudflare edge.

## 4. Cloudflare R2 bucket for profile photos **[costs]**

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**, e.g. `connect-media`, Standard storage class.
2. Keep the bucket **private**: no public access and no r2.dev URL. Connect reads photos with its key and serves them from `/media/…` on its own domain with a strict content type and CSP.
3. R2 → **Manage R2 API Tokens** → **Create API token**: **Object Read & Write**, scoped to that bucket only.
4. Put the **Access Key ID** and **Secret Access Key** in Railway as `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. The secret is shown once.
5. `S3_ENDPOINT` = `https://<account id>.r2.cloudflarestorage.com` (account id on the R2 overview page), `S3_REGION=auto`.

Photos are re-encoded to 512 px WebP (about 20-60 KB each), so the 10 GB free tier holds hundreds of thousands of members.

## 5. First admin wallet

1. For the first deploy set `ADMIN_WALLETS` to any valid placeholder address (the boot check needs one). Open `https://<your host>/login` and sign in with your passkey.
2. Open `https://<your host>/api/auth/session`; it shows your `walletAddress`.
3. Set `ADMIN_WALLETS` to that address (lowercase or checksummed) and let Railway redeploy.
4. Sign out and in again. `/admin` is now available (claims, org requests, reports, feeds). Admin needs a passkey session; the demo login does not exist in production.

## 6. Seeding the organizations

The base seed adds the 53 public-fact organizations, 6 public news feeds and 8 topic channels. It never adds people. The demo seed refuses to run in production, inside any Railway environment, and against any non-local database.

1. For the **first deploy**, set `SEED_ON_BOOT=1`. The log shows `Seeded 53 organizations, 6 RSS feeds and 8 channels.`
2. Then **delete `SEED_ON_BOOT`**: the seed upserts org rows, so leaving it on would undo admin edits on every deploy.
3. To add orgs later, edit `prisma/seed-data.ts` (public facts only), commit, and set `SEED_ON_BOOT=1` for one deploy, or add them through org requests in `/admin`.

## 7. News ingest (no cron service)

When someone opens Today or Signals and the feeds are more than 6 hours old, one ingest runs in the background after the page is sent. Each instance checks at most every 10 minutes, and a shared claim in Redis allows one run per 30 minutes.

For fixed timing, set `CRON_SECRET` (32+ characters) and have any scheduler `POST https://<your host>/api/cron/ingest` with `Authorization: Bearer <CRON_SECRET>`. Without the secret that route is a 404.

## 8. Launch checklist

- [ ] The Railway service builds from `main`.
- [ ] Variables set (section 2); `NEXT_PUBLIC_RP_ID` was set before the build.
- [ ] Deploy log shows `All migrations have been successfully applied` (or `No pending migrations`) and `Ready`, with no `[env] Refusing to start`.
- [ ] `https://<your host>/api/health` returns `{"ok":true}`.
- [ ] Passkey sign-in works on the custom domain.
- [ ] `ADMIN_WALLETS` is your wallet; `/admin` opens.
- [ ] `SEED_ON_BOOT` removed after the first seeded deploy.
- [ ] A profile photo upload works and the object appears in the bucket.
- [ ] Response headers include `content-security-policy`, `strict-transport-security` and `x-frame-options: DENY` (`curl -sI https://<your host>/login`).
- [ ] Postgres backups: turn on scheduled backups in Railway if your plan offers them, otherwise run a regular `pg_dump`.

## 9. Rough monthly cost

Railway bills memory at about $10/GB-month and CPU at about $20/vCPU-month, per second of use. Hobby is $5/month including $5 of usage.

| Item | Estimate |
| --- | --- |
| Web service: ~150 MB idle RSS, 250-300 MB under load; heap capped at 256 MB inside a ~384 MB budget; low CPU | $2-4 |
| Railway Postgres: ~50-100 MB RAM plus a small volume | $1-2 |
| Egress: small pages, photos cached immutable | under $0.50 |
| Upstash Redis free tier (500K commands/month) | $0 |
| Cloudflare R2 free tier (10 GB, 1M writes, 10M reads/month) | $0 |
| **Total** | **about $3-7/month** |

If traffic grows, the first knobs are the heap cap (`NODE_OPTIONS=--max-old-space-size=256`, set in the Dockerfile and overridable as a variable) and Upstash pay-as-you-go ($0.20 per 100K commands).

## Forking for your own domain

Local development works on any machine with no changes (see "Fork it in under an hour" in the README). Production is pinned to the EmpowerTours passkey setup on purpose, so a fork on another domain must change a few constants before deploying:

1. `src/lib/brand.ts`: `name`, `subdomain`, `parentDomain`, `ecosystem`. Everything user-facing (titles, sign-in statement, canonical URL) derives from it.
2. `src/lib/mera/derive.ts`: `EMPOWERTOURS_RP_ID` (your parent domain) and the PRF salt label `EMPOWERTOURS_PRF_SALT_LABEL` / `EXPECTED_SALT_LABEL` (pick your own label; it determines every user's wallet, so never change it after launch). `src/lib/env.ts` compares `NEXT_PUBLIC_RP_ID` against `EMPOWERTOURS_RP_ID`, so production refuses to boot until this matches your domain.
3. The EIP-712 signing domain name (`EmpowerToursConnect` in the reference deployment) is built from `BRAND.ecosystem + BRAND.name` (`src/lib/mera/typed-data.ts`), so step 1 already gives your fork its own domain and its signatures cannot be replayed against the reference deployment.
4. `.railway/railway.ts`: the GitHub repository and the custom domain.
5. Update the pinned values in `tests/mera.test.ts` and `tests/ecosystem-wallet.test.ts` to match, then run `npm test`.
