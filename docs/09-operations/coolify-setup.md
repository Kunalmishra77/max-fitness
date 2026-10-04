# Running Max Fitness on Coolify

Two applications from one repository, both built from a Dockerfile: **web** (the website and
Max Register) and **worker** (reminders, the outbox, the nightly jobs). The database stays on
Supabase; object storage stays on Supabase Storage. Coolify provides the reverse proxy and
the TLS certificate, so there is no Caddy and no Compose file to write.

The worker is the reason for this move. It has never run in production — nothing in the
reminder engine, the outbox or the diet follow-ups fires on Vercel, because Vercel has no
place to keep a process alive. On Coolify it is an ordinary long-running container.

---

## Before you start

- A Coolify instance you can log into, with a server attached and Docker working.
- The VPS's public IP.
- The repository reachable by Coolify — a GitHub App connection, a deploy key, or a public
  repository URL.
- The environment variables from the existing deployment. Every one of them is listed in
  §4; none can be guessed.

---

## 1. Decide what moves

| Piece | Where it runs after this | Why |
|---|---|---|
| Website + Max Register | Coolify (`web`) | |
| Worker | Coolify (`worker`) | **The point of the exercise** |
| PostgreSQL | **Supabase, unchanged** | Moving live data is a separate job with its own risk; nothing here needs it moved |
| Object storage (photos, receipts) | **Supabase Storage, unchanged** | Same |

Keeping the database where it is means this change is reversible: if the VPS misbehaves,
pointing DNS back at the old deployment restores service, because both read the same data.

---

## 2. Create the **web** application

**New Resource → Application → the repository.**

| Setting | Value |
|---|---|
| Build Pack | **Dockerfile** |
| Dockerfile Location | `/Dockerfile.web` |
| Base Directory | `/` (the repository root — it is a pnpm workspace) |
| Port | `3000` |
| Branch | `main` |

Health check (Coolify → Advanced → Health Check):

| Setting | Value |
|---|---|
| Path | `/api/v1/health/live` |
| Port | `3000` |
| Start period | `40` seconds |

**Use `/api/v1/health/live`, not `/api/v1/health`.** The latter reports the *system* and
answers 503 when the worker has stopped beating — right for an uptime monitor, wrong for a
container healthcheck, because Coolify would restart the website every time the worker was
down and fix nothing (ADR-104).

---

## 3. Create the **worker** application

**New Resource → Application → the same repository.**

| Setting | Value |
|---|---|
| Build Pack | **Dockerfile** |
| Dockerfile Location | `/Dockerfile.worker` |
| Base Directory | `/` |
| Port | leave empty — it has no inbound port |
| Health check | **off** |
| Replicas | **1, and only 1** |

**Exactly one instance.** The schedules are cron-like and the outbox is polled; two copies
evaluate the same slot twice. The idempotency keys would stop a member being messaged twice,
but the correct number is still one.

There is nothing to healthcheck over HTTP: the worker proves it is alive by touching a
heartbeat row, which `/api/v1/health` reads. One URL covers both processes (ADR-018).

---

## 4. Environment variables

Set these on **both** applications unless the table says otherwise. Coolify's variables are
per-application; the two do not share.

### Required by both

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Supabase pooler, **transaction mode, port 6543** for web; see below for the worker |
| `DIRECT_URL` | Supabase **session mode, port 5432** |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://maxfitnessgym.co.in` — with no trailing slash and no quotes |
| `APP_TIMEZONE` | `Asia/Kolkata` |
| `GYM_SLUG` | `max-fitness-indirapuram` |
| `DEMO_MODE` | `false` |
| `SESSION_SECRET` | copy from the current deployment |
| `LINK_TOKEN_SECRET` | copy |
| `FIELD_ENCRYPTION_KEY` | copy |
| `KIOSK_TOKEN_PEPPER` | copy |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | copy all five |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | copy |
| `RAZORPAY_WEBHOOK_SECRET` | the secret entered when the Razorpay webhook was created |
| `LOG_LEVEL` | `info` |

> **`DATABASE_URL` differs between the two.** The web app uses the transaction pooler
> (`:6543`), which suits short request-shaped queries. The worker holds longer transactions
> and should use the session pooler (`:5432`) — the same value as `DIRECT_URL`. See TRD §3.1.

### Worker only

| Variable | Value |
|---|---|
| `WORKER_ID` | any stable name, e.g. `coolify-1` |
| `WORKER_CONCURRENCY` | `2` to start |
| `WORKER_DB_POOL_MAX` | `5` |

### When they exist

| Variable | Notes |
|---|---|
| `AI_API_KEY`, `AI_MODEL` | the assistant and the diet plans do nothing without these |
| `WHATSAPP_PROVIDER` | `simulator` until Meta approves, then `meta_cloud` |
| `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | all five, together, or the provider stays on `simulator` |

**Do not set `ALLOW_DEMO_IN_PRODUCTION`.** It exists so a deliberate demo deployment can run
with simulated payments; on the real site it should be absent.

---

## 5. Deploy, in this order

1. **Deploy `worker` first.** It needs no DNS and touches no traffic, so if the image is
   wrong you find out without the website involved.
2. Watch its logs for the first heartbeat.
3. Check the **current** site's health — it reads the same database, so the worker shows up
   there immediately:
   ```
   curl https://maxfitnessgym.co.in/api/v1/health
   ```
   `"worker": { "ok": true }` means the worker is alive and reminders are running. This is
   the first time that has ever been true in production.
4. **Then deploy `web`**, and open its Coolify-provided URL. It serves the real site on a
   temporary hostname, so everything can be checked before any DNS moves.

---

## 6. Move the domain

Only after the Coolify `web` URL serves the site correctly.

In Coolify → `web` → **Domains**, set `https://maxfitnessgym.co.in`. Coolify requests the
certificate once DNS points at it.

At Hostinger → Domains → `maxfitnessgym.co.in` → DNS:

| Type | Name | Value |
|---|---|---|
| A | `@` | **the VPS IP** |
| A | `www` | **the VPS IP** |

Delete the two Vercel records that are there now (`A @ → 76.76.21.21`,
`CNAME www → cname.vercel-dns.com`). Lower the TTL an hour beforehand if you want the switch
to happen faster.

Then check:

```
pnpm --filter @mfp/web smoke:public     # 12 public pages
pnpm --filter @mfp/web smoke:crm        # 24 CRM screens, needs CRM_USER and CRM_PIN
```

Both read and neither writes.

---

## 7. After the switch

- **Razorpay webhook** — the URL does not change (`https://maxfitnessgym.co.in/api/v1/webhooks/razorpay`),
  so nothing to edit, but send a test event from the dashboard and confirm a 200.
- **Keep the Vercel project** for a week or two. It costs nothing and it is the way back.
- **Regenerate the Razorpay secret** if it has been shared anywhere.
- `APP_URL` must be exactly the public address. A deployment once stored it empty and every
  receipt link, renew link and sitemap entry silently became `http://localhost:3000` while
  every page carried on rendering (ADR-096).

---

## 8. What the first build is likely to object to

These Dockerfiles have not been built — this project has no Docker on the development
machine, so Coolify's first build is their first run. If it fails, the log says where:

| Symptom | Cause |
|---|---|
| `ERR_PNPM_OUTDATED_LOCKFILE` | `pnpm-lock.yaml` not committed with the manifests |
| `Cannot find module '.prisma/...'` | `db:generate` did not run before the build — it is in both files, check the log for it |
| Next build fails on a missing env var | add it to §4; the build deliberately needs no database, but a variable that must merely *exist* still has to |
| Web starts, then 404s on every asset | the `.next/static` copy step — path is `/app/apps/web/.next/static` in a workspace |
| Worker exits immediately | read the first ten log lines; a missing `DATABASE_URL` says so plainly |
