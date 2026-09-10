# Deployment Plan

> **Phase 1 note — database hosting (revisit in Phase 8).** Development uses **Supabase Postgres (Mumbai)** and no local Docker, so the topology below is not yet in force. Production may well keep Supabase for the database while `web` and `worker` run on the VPS: that drops the `postgres` container and its volume from the compose files, and `DATABASE_URL` / `DIRECT_URL` point at the Supavisor poolers (transaction :6543 for web, session :5432 for the worker and migrations — see `TRD.md` §3.1). Backups then become **two independent copies**: Supabase's own automated backups plus our scheduled `pg_dump` run from CI to off-site encrypted storage, since one provider holding both the data and its only backup fails the restore drill by design. The trade-off against self-hosting Postgres on the VPS (cost, latency from the VPS to Supabase, one less thing to operate, data residency) is decided in Phase 8; nothing in the application depends on the answer, because all access goes through Prisma.


## 1. Target topology
One Ubuntu 24.04 LTS VPS (Mumbai region), 4 vCPU / 8 GB RAM / 160 GB SSD, running Docker Compose projects for **staging** and **production** on separate networks, volumes and databases, behind one Caddy instance. (Move staging to a small separate VPS if resources get tight.)

| Service | Image | Prod replicas | Notes |
|---|---|---|---|
| caddy | `caddy:2` | 1 | TLS for `{domain}`, `www`, `staging.{domain}`; HTTP→HTTPS; security headers; request body limits |
| web | `ghcr.io/{org}/mfp-web:{sha}` | 1 | Next.js standalone output, non-root, healthcheck `/api/v1/health` |
| worker | `ghcr.io/{org}/mfp-worker:{sha}` | 1 | Exactly one instance (cron leader) |
| postgres | `postgres:17` | 1 | Volume `pgdata-prod`; tuned `shared_buffers=1GB`, `max_connections=50` |
| uptime-kuma | `louislam/uptime-kuma` (pin current stable tag) | 1 | Behind Caddy basic auth, or on vendor laptop |
| backup | cron on host | — | `infra/scripts/backup.sh` |

Storage volume `storage-prod` mounted into web & worker at `/app/storage` (driver `local`).

## 2. DNS
| Record | Value |
|---|---|
| `A {domain}` | VPS IP |
| `A www` | VPS IP (redirect to apex) |
| `A staging` | VPS IP |
| `CAA` | `0 issue "letsencrypt.org"` |
| TXT | Meta domain verification (for WhatsApp business verification), Google Search Console |

## 3. Caddyfile (sketch)
```
{domain} {
  encode zstd gzip
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
    Referrer-Policy "strict-origin-when-cross-origin"
    Permissions-Policy "camera=(self), microphone=(), geolocation=()"
    -Server
  }
  request_body {
    max_size 5MB
  }
  reverse_proxy web-prod:3000
}
www.{domain} {
  redir https://{domain}{uri} permanent
}
staging.{domain} {
  basicauth /crm/* { demo <bcrypt-hash> }
  reverse_proxy web-staging:3000
}
```
(CSP is set by Next.js per route so Razorpay/maps allowances can differ by page.)

## 4. CI/CD (GitHub Actions)
1. **ci.yml** (PR): install (pnpm cache) → lint → typecheck → unit/integration (Postgres service) → build.
2. **deploy-staging.yml** (push to main): build & push images tagged `sha` → SSH to VPS as `deploy` → `infra/scripts/deploy.sh staging {sha}`.
3. **deploy-production.yml** (manual dispatch with `sha`, environment protection rule requiring approval): same script with `production`.

`deploy.sh {env} {sha}`:
```
set -euo pipefail
cd /srv/mfp/$ENV
./backup.sh --tag pre-deploy-$SHA          # production only
export IMAGE_TAG=$SHA
docker compose pull web worker
docker compose run --rm web pnpm --filter @mfp/db prisma migrate deploy
docker compose up -d web worker
./healthcheck.sh https://$HOST/api/v1/health 60
```
Rollback: `deploy.sh production {previous-sha}`; if migration was destructive, restore pre-deploy backup (rare — avoid destructive migrations; use expand/contract).

## 5. Environment setup order (first time)
1. Provision VPS; run `bootstrap-vps.sh` (users, SSH, UFW, fail2ban, Docker, unattended-upgrades, chrony).
2. Create `/srv/mfp/{staging,production}` with `compose.yml`, `.env` (root-owned 600), volumes.
3. DNS records; start Caddy; confirm TLS.
4. Start Postgres; create app roles; run migrations; `seed:production` (gym, plans, rules, owner with one-time PIN).
5. Deploy web/worker; health checks.
6. Configure Razorpay webhook → `https://{domain}/api/v1/webhooks/razorpay` (events: payment.captured, payment.failed, order.paid) with secret.
7. Configure Meta app webhook → `https://{domain}/api/v1/webhooks/whatsapp`, verify token, subscribe to `messages` field; register phone number; add templates.
8. Uptime Kuma monitors: `/api/v1/health` (1 min), worker heartbeat endpoint (`/api/v1/health?worker=1` checks last worker heartbeat < 3 min), TLS expiry, kiosk last seen (via health JSON).
9. Sentry projects: web, worker, kiosk; release tracking with `sha`.
10. Backups: cron `15 2 * * *` backup.sh; weekly restore test `30 4 * * 0`.
11. Google Search Console + sitemap submission; add website link on GBP.

## 6. Kiosk deployment
1. Factory reset phone; skip Google account (or use dedicated gym account); connect Wi-Fi.
2. Enable developer options temporarily → `adb install haazri-release.apk` → `adb shell dpm set-device-owner in.maxfitness.haazri/.kiosk.AdminReceiver`.
3. Launch app → pairing screen → owner generates code in CRM → enter code.
4. Disable developer options/USB debugging; set brightness, screen timeout ignored by app, battery protection if available.
5. Mount, light, signage; run on-site checklist (UAT §F).
6. Shadow mode on for 2 weeks; review accuracy report; switch off.

## 7. Go-live checklist (production)
- [ ] UAT signed; security & privacy checklists complete
- [ ] `DEMO_MODE=false`; `WHATSAPP_PROVIDER=meta_cloud`; Razorpay live keys; webhooks verified with test events
- [ ] Plans and prices confirmed by owner in Settings
- [ ] Legal pages live; footer links
- [ ] Owner & staff PINs set; seed demo users absent
- [ ] Backups running + restore drill logged
- [ ] Monitoring alerts to vendor on-call phone
- [ ] GBP website link added with UTM
- [ ] QR posters printed with production URL
- [ ] Kiosk paired to production
- [ ] Rollback plan and previous image tag noted

## 8. Launch sequence (suggested)
- Day 0 (weekday morning): deploy production; smoke test; soft launch website (no announcement).
- Day 0–1: owner uses CRM with real walk-ins; reminders engine **enabled only for verified members**.
- Day 2: start QR migration drive; GBP website link.
- Day 7: announce on Instagram/WhatsApp status; kiosk shadow mode continues.
- Day 14: review metrics; exit shadow mode if targets met.
