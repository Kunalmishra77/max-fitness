# Security Plan

Target: OWASP ASVS Level 2 for web/API; OWASP MASVS-L1+ for kiosk app. Threat model below drives controls.

## 1. Assets
| Asset | Sensitivity |
|---|---|
| Member PII (name, mobile, email, DOB, gender) | High |
| Selfies / face templates | Very high (biometric) |
| Payment records | High |
| CRM credentials (PINs, sessions) | High |
| WhatsApp access token, Razorpay secrets | Critical |
| Kiosk device token | High |
| Backups | Very high |

## 2. Threat model (STRIDE summary)
| Threat | Example | Controls |
|---|---|---|
| Spoofing | Brute-forcing a 4-digit PIN; forged webhook; stolen kiosk token | Argon2id + lockout + rate limit + trusted device; HMAC webhook verification; hashed revocable device tokens |
| Tampering | Client changes amount; edited renew link; forged unsubscribe payload | Server-side pricing; HMAC-signed tokens with expiry; payment amount check vs provider |
| Repudiation | Staff voids cash payment and denies it | Append-only AuditLog with actor, before/after |
| Information disclosure | Selfie URLs guessed; PII in logs; DB exposed | Private storage + signed short URLs; log redaction; Postgres not exposed; TLS everywhere |
| Denial of service | Form spam; QR endpoint flood | Rate limits, bot challenge, Caddy request limits, body size limits |
| Elevation of privilege | Reception calls owner-only endpoint | Server-side `assertCan` on every action; tests for permission matrix |

## 3. Controls by layer

### 3.1 Application
- **Input validation:** Zod on every boundary; reject unknown keys; length limits.
- **Output encoding:** React escaping; no `dangerouslySetInnerHTML` except sanitised legal markdown (rehype-sanitize).
- **AuthN (CRM):** mobile + PIN (4–6 digits); Argon2id (memory ≥ 19 MiB, iterations ≥ 2); lockout after 5 failures for 15 min; IP rate limit; session tokens 256-bit random, stored as SHA-256; cookie `HttpOnly; Secure; SameSite=Lax; Path=/`; idle timeout 12 h, absolute 30 days for trusted device; PIN re-prompt (5-min elevation) for sensitive actions.
- **AuthZ:** permission matrix enforced in core services; deny by default; row-level tenant check (`gymId`) in repositories.
- **CSRF:** SameSite=Lax + Origin/Referer check on state-changing requests + Server Actions' built-in origin checks.
- **Signed links:** HMAC-SHA256 over `purpose|memberId|exp|nonce`, base64url; purpose-bound (`renew`, `receipt`, `unsub`, `restart`, `registration`); short TTLs.
- **File uploads:** max 2 MB, magic-byte validation, re-encode with sharp (removes polyglots & EXIF), random keys, never served from upload path directly.
- **Webhooks:** raw body HMAC verification (Razorpay `X-Razorpay-Signature`; Meta `X-Hub-Signature-256`), constant-time compare, unique event storage for replay protection.
- **Secrets:** only in env on server; never sent to client except public keys (`RAZORPAY_KEY_ID`); rotate on staff departure; WhatsApp system-user token with minimum permissions.
- **Headers (Caddy/Next):** `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `Content-Security-Policy` (self + Razorpay checkout domains + analytics + maps on click + MediaPipe WASM self-hosted), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, `frame-ancestors 'none'` (except where Razorpay requires frames — configure `frame-src` for checkout).
- **Rate limiting:** per API spec §8.
- **Bot protection:** privacy-friendly challenge (e.g., Cloudflare Turnstile) on lead, registration, QR submit when abuse detected or always in production (decide in Phase 8).
- **Dependencies:** lockfile, Dependabot/Renovate, `pnpm audit` in CI (fail on critical), framework security advisories monitored (Next.js publishes scheduled security releases — patch within 72 h for critical).
- **Logging:** pino with redaction paths (`*.mobile`, `*.email`, `*.pin`, `*.token`, `*.vector`, `authorization`, `cookie`); request IDs; no bodies for sensitive routes.
- **Error handling:** generic messages to clients; details to Sentry with PII scrubbing (`sendDefaultPii: false`, beforeSend filters).

### 3.2 Data
- Postgres user with least privilege (app user without superuser; migrations run with separate role). Supabase-specific database controls in §3.6.
- Face templates encrypted at field level (AES-256-GCM, key from env/secret file, key id for rotation).
- Backups encrypted (restic) and stored off-site; access keys scoped to backup bucket only.
- Retention jobs per `database-design.md` §7.

### 3.3 Infrastructure (VPS)
Bootstrap script (`infra/scripts/bootstrap-vps.sh`) must:
- Create non-root deploy user; disable root SSH and password auth; SSH keys only; optional port change + allowlist.
- UFW: allow 22 (restricted), 80, 443; deny all else.
- fail2ban for sshd.
- unattended-upgrades for security patches; scheduled reboot window (e.g., 03:30 Tue) with **services auto-restart** (`restart: unless-stopped`) and a post-reboot health check.
- Docker from official repo; containers run as non-root; read-only filesystems where possible; no `--privileged`.
- Postgres bound to Docker network only — never published to host 0.0.0.0.
- Time sync (chrony), timezone UTC on host (app handles IST).
- Disk usage alerts (> 80%), log rotation for Docker.
- Backups verified by automated weekly restore to a scratch container + monthly manual restore drill logged in runbook.

### 3.4 Kiosk (Android)
- Device Owner kiosk mode, no other apps, USB debugging disabled after provisioning, developer options off.
- SQLCipher DB with Keystore-wrapped key; token in encrypted storage; wipe on revoke.
- HTTPS only; certificate pinning optional with backup pins.
- Obfuscation (R8) for release; signing keys stored offline with backup.
- Admin PIN hashed; lockout after failures.
- Physical: lockable enclosure, cable lock.

### 3.5 WhatsApp & payments accounts
- Meta Business Manager: 2FA for all admins; system user for API; business verification done by owner entity with vendor as partner (not vendor-owned WABA unless agreed in contract).
- Razorpay: 2FA, separate test/live keys, webhook secret unique per environment, IP allowlisting not needed but monitor dashboard logins.

### 3.6 Supabase (managed database)
The database is managed PostgreSQL on Supabase (Mumbai). Supabase is used **only** as a Postgres host; the controls below make sure none of its other surfaces are reachable.

- **Data API off.** Supabase auto-generates a PostgREST API over `public`, callable with the project's anon key. Clear `public` from **Settings → Data API → Exposed schemas** (manual dashboard step; recorded in the runbook and re-checked at the pre-launch review).
- **RLS on every table, no policies.** The first migration runs `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on every table the app creates in `public`, and every later migration does the same for new tables. Our Prisma role owns the tables and so bypasses RLS (we deliberately do not `FORCE` it); the `anon` and `authenticated` roles the Data API uses match zero rows. Defence in depth behind the setting above.
- **No anon or service-role key anywhere.** They are never added to `.env`, CI secrets, or the client bundle. `supabase-js` is not a dependency — a lint boundary and a dependency review keep it out. If a key was ever exposed, rotate it in the dashboard (JWT secret rotation invalidates both).
- **Database password.** Treated as a critical secret: unique per project (dev / test / production), stored only in the deployment secret store, never printed in logs or chat. Rotate on vendor offboarding, on any suspected exposure, and at least annually. Rotation is a dashboard action plus a redeploy of `DATABASE_URL` / `DIRECT_URL`.
- **Supabase account hardening.** 2FA (TOTP) mandatory for every member of the Supabase organisation. Owner role held by the client's own account, vendor as a separate member so access can be removed without transferring the project. Review the member list at each phase boundary.
- **Network.** Connections go through Supavisor over TLS. Where the plan supports it, restrict direct Postgres access with Supabase's network restrictions to the VPS egress IP once production hosting is fixed (Phase 8). Until then the strong unique password plus pooler TLS is the control.
- **Least privilege.** The application connects as a role that owns the schema but is not superuser. A separate migration role is a Phase 8 improvement (Supabase's default `postgres` role is used in dev).
- **Backups.** Supabase's own automated backups plus an independent, encrypted `pg_dump` taken by a scheduled CI job — never rely on a single provider for recovery. Restore drills as in §4.
- **No PII to Supabase support.** Diagnostic snippets shared with the vendor must be masked with the standard helpers.


## 4. Security testing
| Activity | When |
|---|---|
| Unit tests for token signing/verification, webhook verification, permission matrix | Continuous |
| `pnpm audit`, CodeQL (GitHub) | Every PR |
| OWASP ZAP baseline scan on staging | Phase 8 + monthly |
| Manual checks: IDOR on `/crm/members/{id}` across roles, signed URL expiry, rate limits, file upload polyglots, CSP violations | Phase 8 |
| Kiosk: token extraction attempt on rooted test device, revoke/wipe verification | Phase 7 |
| Restore drill | Before launch, then monthly |

## 5. Incident response (summary)
1. Detect (Sentry spike, uptime alert, suspicious audit entries, owner report).
2. Contain: revoke sessions/tokens, rotate secrets, disable kill switches (messages, payments page), block IPs at Caddy.
3. Assess scope using AuditLog, logs, DB queries.
4. Notify: owner immediately; for personal data breaches follow DPDP obligations (notify affected people and the Data Protection Board as required — see privacy doc §9).
5. Recover from clean images/backups; post-mortem within 5 days; add tests.

## 6. Pre-launch security checklist
- [ ] All secrets unique per environment; none in git history (run gitleaks)
- [ ] DEMO_MODE false in production; boot guard active
- [ ] Owner and staff PINs set by them; default seed users absent in production
- [ ] CSP enforced (not report-only) and tested with Razorpay checkout and maps
- [ ] Webhook signature failures return 401 and are logged
- [ ] Signed URL TTLs ≤ 5 min for images
- [ ] Rate limits verified
- [ ] Postgres port closed from internet (external nmap)
- [ ] Supabase Data API: `public` removed from exposed schemas; anon-key request against a table returns no rows
- [ ] RLS enabled on every table in `public` (verify with the query in `database-design.md` §10.2)
- [ ] Supabase org: 2FA on all members; vendor access removable; database password rotated from the project default
- [ ] Backups + restore drill passed
- [ ] Kiosk in Device Owner mode; debugging disabled
- [ ] Sentry PII scrubbing verified
- [ ] Privacy notice, consents, data-rights flows live
