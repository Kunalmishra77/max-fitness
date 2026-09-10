# Runbook — Monitoring, Backups, Incidents

## 1. Monitoring & alerts
| Signal | Source | Threshold | Who | Action |
|---|---|---|---|---|
| Website down | Uptime Kuma | 2 failed checks | Vendor on-call | §4.1 |
| Worker heartbeat stale | health endpoint | > 3 min | Vendor | §4.2 |
| Reminder slot failure rate | worker metric → Alert | > 20% | Vendor + owner bell | §4.3 |
| WhatsApp quality/limit | webhook → Alert | any | Vendor | §4.3 |
| Kiosk offline | heartbeat | > 30 min in gym hours | Owner bell + vendor | §4.4 |
| Kiosk temperature | heartbeat | > 42 °C | Vendor | reduce fps, check ventilation |
| Error spike | Sentry | > 20 events/10 min new issue | Vendor | triage |
| Disk usage | node exporter/script | > 80% | Vendor | prune images/logs, expand |
| TLS expiry | Uptime Kuma | < 14 days | Vendor | check Caddy logs |
| Backup job | backup.sh exit code → healthcheck ping | missing daily ping | Vendor | §5 |
| Payments webhook failures | Sentry/log | any 5xx | Vendor | replay from Razorpay dashboard |

## 2. Daily/weekly/monthly routines
| When | Task | Owner |
|---|---|---|
| Daily (auto) | Backup, digest, reminder slots, retention jobs | System |
| Daily 10 min | Owner clears calls & verify queue | Owner |
| Weekly | Review Sentry, failed messages, kiosk report, disk | Vendor |
| Weekly | Automated restore test result check | Vendor |
| Monthly | Manual restore drill (log below), dependency/security updates, trust numbers refresh (Google/Justdial ratings), report to owner | Vendor |
| Quarterly | Rotate secrets that support rotation; review staff accounts; privacy policy review | Vendor + owner |

## 3. Backups
- `backup.sh`: `pg_dump -Fc` of production DB → `restic backup` together with `storage/` → off-site repository (encrypted, password in root-only file) → prune `--keep-daily 14 --keep-weekly 8 --keep-monthly 12` → ping healthcheck URL.
- Restore test (weekly, automated): restore latest dump into a temporary Postgres container, run `SELECT count(*)` sanity queries (members, payments), compare with production counts ±1%, destroy container.
- Manual drill log:

| Date | Backup used | Time to restore | Result | By |
|---|---|---|---|---|
| | | | | |

## 4. Incident playbooks

### 4.1 Website/CRM down
1. Check `docker compose ps`; `docker compose logs --tail=200 web`.
2. If container crash-looping after deploy → roll back to previous sha.
3. If VPS unreachable → provider console; if host lost → provision new VPS from bootstrap script, restore latest backup, update DNS (TTL 300).
4. Tell owner (WhatsApp): kiosk continues offline; take payments in cash and note them; CRM back by ETA.

### 4.2 Worker not running
1. `docker compose logs worker`; restart.
2. Catch-up runs same-day slots automatically; verify MessageLog for today's slots.
3. If a day was missed, **do not back-fill** reminders; generate call tasks instead (script `pnpm ops:calls-for-missed-day`).

### 4.3 WhatsApp problems
- Template rejected/paused → switch rule to alternate template or disable rule; resubmit wording.
- Quality downgraded → engine auto-pauses POST rule; review block feedback; consider lower cap; resume after quality recovers.
- Token expired/invalid (401) → regenerate system-user token; update env; restart worker.
- Mass failure → kill switch; investigate; resume.

### 4.4 Kiosk offline or misbehaving
1. Ask staff: is the phone on, charging, Wi-Fi connected? (Hindi quick card at reception.)
2. Reboot phone (long-press power) — app auto-starts.
3. Still failing → staff marks attendance manually in CRM; vendor remote check next day.
4. Replace with spare phone: pair new device, revoke old.

### 4.5 Wrong reminder sent
1. Kill switch if widespread.
2. Identify cause (data error vs rule bug) via MessageLog + AuditLog.
3. Send apology free-form message to affected members within their service window if applicable, or have owner call.
4. Fix, add test to matrix, post-mortem.

### 4.6 Payment captured but membership not active
1. Search Payment by Razorpay payment id.
2. If webhook missing → Razorpay dashboard → resend webhook, or run `pnpm ops:confirm-payment --order order_xxx` (uses same `confirmPayment()`).
3. Inform member.

## 5. Data breach (see privacy plan §9)
Contain → preserve logs → assess → notify owner → counsel → notices to members (templates below) and Board as required → remediate → post-mortem.

## 6. Contacts (fill)
| Role | Name | Phone | Hours |
|---|---|---|---|
| Owner | | 098714 06350 | |
| Vendor on-call | | | |
| VPS provider support | | | |
| Razorpay support | | | |
| Meta/BSP support | | | |

## 7. Member breach notice template
EN: "We are writing to tell you about a security incident at Max Fitness Gym on {date} that may have affected your {data types}. What happened: {summary}. What it could mean for you: {consequences}. What we have done: {actions}. What you can do: {steps}. For questions contact {name, phone, email}."
HI: "हम आपको {date} को Max Fitness Gym में हुई एक सुरक्षा घटना के बारे में बता रहे हैं, जिससे आपकी {data types} प्रभावित हो सकती है। क्या हुआ: {summary}। आपके लिए इसका क्या मतलब हो सकता है: {consequences}। हमने क्या किया: {actions}। आप क्या कर सकते हैं: {steps}। सवालों के लिए संपर्क करें: {name, phone, email}।"
