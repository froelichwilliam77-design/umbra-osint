# Umbra

Public-OSINT workstation for **handle**, **mail**, **host**, **phone**, and **crawl** reconnaissance. One search bar, auto-detected input, a live classified ledger, identity graph, and exports. Installable as a phone PWA.

Umbra is not a mock. Handle mode walks WhatsMyName + a Sherlock overlay (**1001** unique platforms; 961 clearnet). Dual-condition matching is case-insensitive and whitespace-tolerant; JSON bodies that name the account recover stale matchers; 403/429/451/CAPTCHA stay **blocked**; HTTP 404/410 and soft-404 bodies stay **miss** with a reason. **Lean** ranks API and high-signal sites first, skips chronically WAF-gated modules (Instagram/TikTok/…), and caps at **~250** handle sites.

Mail mode builds a richer identity dossier (MX provider, disposable/role, Gravatar MD5+SHA256, M365 tenant, domain SPF/DMARC/DKIM/BIMI, RDAP created date, **Have I Been Pwned** when `HIBP_API_KEY` is set, handle + host pivots, open-in OSINT + public paste/stealer links) and runs silent registration oracles — never SMTP or password-reset mail. **Lean** (Railway default) probes **proven** oracles only (GitHub, Microsoft, Gravatar, Discord, …) and skips quarantined / chronically blocked modules. **Full** still ranks high-signal first, then the rest. Found rows surface immediately as **likely hits** while the scan continues.

Host mode pulls RDAP, DNS, SPF/DMARC/DKIM/BIMI, parsed `security.txt`, HTTPS headers/title, and the TLS certificate.

Phone mode E.164-normalizes with libphonenumber, adds country/region/type/timezone hints (NANP NPA labels where known), public lookup pivots (Google, Truecaller, Whitepages, wa.me, …), and optional Twilio/Numverify carrier lookups behind env keys. It never sends SMS.

Finished scans auto-save as **cases** (dossier + found rows + graph). With a disk volume (`UMBRA_CASES_DIR` or `/data/cases`) they survive restarts and sync across devices; otherwise the UI falls back to IndexedDB/localStorage. Reopen a case, export an executive **HTML** report (print-to-PDF), Markdown, or JSON, or compare two cases side by side. **Watches** re-run a lean scan on an interval (min 1h, default 24h), diff new founds, and show an in-app Alerts panel plus a first-seen **timeline**. Optional outbound channels (operator inbox only — never the subject, never SMS):

- `UMBRA_ALERT_WEBHOOK` JSON POST
- Email via **SMTP** (`UMBRA_SMTP_*` + `UMBRA_ALERT_EMAIL`) **or** **Resend** (`RESEND_API_KEY` / `UMBRA_RESEND_API_KEY` + `UMBRA_ALERT_EMAIL`)
- **Telegram** (`UMBRA_TELEGRAM_BOT_TOKEN` + `UMBRA_TELEGRAM_CHAT_ID`)

In-app **Alerts / settings** shows which channels are on **without exposing secrets**, lists the env var names to set, and has a **Test alert** button. Configure vars in Railway → Variables — never paste tokens into the UI.

Finished cases can mint **read-only share links** (`/share/:token` or `/c/:id?token=`) — dossier + found rows + graph, no private keys, optional expiry, revoke in the UI.

**Batch recon** pastes a multiline list of emails/handles/hosts/phones and queues **lean** scans serially (`maxConcurrentScans=1`). Skip invalid lines, cancel the queue, combined JSON/CSV/Markdown export when it finishes.

After mail or crawl, **Run pivots** queues follow-up scans (one at a time — 1 GB safe).

Paste an `https://` URL or **Crawl** a host for a bounded same-origin spider (25 pages lean / 100 power) that harvests emails, usernames, links, and headers into the ledger. SSRF still blocks private/loopback/metadata.

**Authorized use only.** Run it against identifiers you are allowed to investigate. Server-side fetches refuse private, loopback, link-local, and metadata addresses (SSRF).

## Run locally

```bash
npm install
npm run dev
```

- UI: http://127.0.0.1:43181
- Engine: http://127.0.0.1:43180

Production-style (build the UI, one Node process):

```bash
npm install
npm run build
npm start
```

Then open http://127.0.0.1:43180.

```bash
npm test
```

Live console screenshots:

- Handle `octocat` — [docs/screenshots/handle_octocat_ledger.png](docs/screenshots/handle_octocat_ledger.png)
- Mail `press@github.com` — [docs/screenshots/mail_press_github_dossier.png](docs/screenshots/mail_press_github_dossier.png)
- Mail ledger (found oracles) — [docs/screenshots/mail_press_github_ledger.png](docs/screenshots/mail_press_github_ledger.png)
- Host `github.com` — [docs/screenshots/host_github_rdap_dns.png](docs/screenshots/host_github_rdap_dns.png)
- Phone `+14155552671` — [docs/screenshots/phone_e164_dossier.png](docs/screenshots/phone_e164_dossier.png)
- PWA / mobile — [docs/screenshots/pwa_mobile_install.png](docs/screenshots/pwa_mobile_install.png)
- v1.6 likely hits + progress — [docs/screenshots/v16_mail_likely_hits.webp](docs/screenshots/v16_mail_likely_hits.webp)
- v1.6 cases panel — [docs/screenshots/v16_cases_panel.webp](docs/screenshots/v16_cases_panel.webp)
- v1.6 phone public pivots — [docs/screenshots/v16_phone_pivots.webp](docs/screenshots/v16_phone_pivots.webp)
- v1.8 Power + batch queue — [docs/screenshots/v18_power_batch.webp](docs/screenshots/v18_power_batch.webp)
- v1.8 batch recon — [docs/screenshots/v18_batch_queue.webp](docs/screenshots/v18_batch_queue.webp)
- v1.8 watches / alert channels — [docs/screenshots/v18_alerts_timeline.webp](docs/screenshots/v18_alerts_timeline.webp)
- v1.8 read-only share — [docs/screenshots/v18_share_readonly.webp](docs/screenshots/v18_share_readonly.webp)
- v1.9 phone mail start — [docs/screenshots/v19_phone_mail_start.png](docs/screenshots/v19_phone_mail_start.png)
- v1.9 phone mail (HIBP + paste pivots) — [docs/screenshots/v19_phone_mail_hibp.png](docs/screenshots/v19_phone_mail_hibp.png)
- v1.9 phone Alerts / settings — [docs/screenshots/v19_phone_alerts_setup.png](docs/screenshots/v19_phone_alerts_setup.png)
- v1.9 Test alert (no channels yet) — [docs/screenshots/v19_phone_alerts_test.png](docs/screenshots/v19_phone_alerts_test.png)

### First recon

1. Accept the authorized-use gate.
2. `octocat` in Auto/Handle — classified hits across **1001** sites (961 clearnet). This upgrade local run: **197 found** / 503 miss / 170 blocked / **40 escalate** on 961 clearnet (v1.3.0: 193 found / 461 miss / 178 blocked / 105 escalate on 963). GitHub is **found** with avatar; matching avatars show pHash nodes on the identity graph.
3. `press@github.com` (or another address you are authorized to check) in Mail — dossier + silent oracles (proven first on Lean). **Likely hits** appear while the scan continues. **Run pivots** walks handle `press` then host `github.com`. HIBP is a first-class dossier card when `HIBP_API_KEY` is set (breach names, dates, data classes + public paste/stealer links); otherwise it stays off with setup copy.
4. `github.com` in Host — RDAP / DNS / cert SAN / security.txt / TLS.
5. `+14155552671` (or another number you are authorized to check) in Auto/Phone — E.164, region/type/timezone, public pivots. No SMS.
6. **Cases** — finished scans auto-save. Open / delete / export HTML (print → PDF), Markdown, or JSON. **Side by side** compares two saved cases. **Share** mints a read-only public-OSINT link.
7. **Crawl** — `https://example.com` (or the Crawl chip / `crawl this host example.com`) walks same-origin pages, then optional pivots.
8. **Watch** — watch the current handle/mail/host/phone. New founds appear under Alerts and on a first-seen timeline. Open **Alerts / settings** to see Telegram / Resend / SMTP / webhook status (no secrets) and send a **Test alert**.
9. **Share** — from Cases, mint a read-only `/share/:token` link (optional expiry). Recipients see dossier + founds + graph without signing in. Revoke anytime.
10. **Batch** — paste a list of identifiers. Lean scans run one at a time; export the combined queue when it finishes.
11. **Power** — on ≥~1800 MB RAM, `UMBRA_POWER=1`, or the UI **Power** chip (confirm-gated on 1 GB). Allows Full + TLS impersonation. Playwright stays off. A banner explains Railway **Settings → Resources** when the cgroup is under 2 GB.

## Railway (public HTTPS)

Same pattern as before: one Docker process, built UI + `/api`, bind `0.0.0.0`, listen on `$PORT`.

**1 GB hobby / free plan:** keep Playwright **off**. A full 1000-site handle scan with curl-impersonate used to peak at **~1.34 GB RSS** and freeze the phone UI. Production now defaults to:

- `UMBRA_PROFILE=lean` — ~250 curated + high-signal handle sites (chronically blocked modules skipped), proven mail oracles only (quarantined / chronically blocked skipped), crawl cap 25 pages. Toggle **Full** in the UI for the complete map.
- `UMBRA_WORKERS=4`, `UMBRA_CURL_MAX=0` on 1 GB (TLS children stay off so the cgroup does not OOM). `UMBRA_BODY_LIMIT=48000`
- RSS cancel at **450 / 600 MB** on 1 GB hosts. On ≥~1800 MB RAM the watermarks scale to ~70% / ~85% of detected memory (capped at 5500 / 7000). Override with `UMBRA_MEM_SOFT_MB` / `UMBRA_MEM_HARD_MB` (or `UMBRA_RSS_*`) only when you want to pin them.
- `NODE_OPTIONS=--max-old-space-size=384`, Playwright off
- SSE row events batched (~150 ms); the ledger virtualizes ~40 visible rows so a phone stays responsive

Target: a mail scan and a lean handle scan complete on 1 GB without an OOM restart.

### Persistent volume (cases + watches)

Railway disks are ephemeral unless you attach a volume. In the service **Settings → Volumes**:

1. Add a volume, mount path **`/data`**. Do **not** add `VOLUME` to the Dockerfile — Railway's Metal builder rejects it and the image never builds.
2. Cases write JSON to `/data/cases` (or `UMBRA_CASES_DIR`). Watches/alerts live beside them (`_watches`).
3. `GET /api/health` → `cases.persist: "volume"` and `watches.persist: "volume"` when the mount is writable.
4. If `/data` is missing or not writable, the process still boots: it creates the directory when it can, otherwise persist is in-memory and the UI uses IndexedDB.

Docker Compose already mounts named volume `umbra-data` at `/data`.

### Power mode (optional, not 1 GB)

Keep the hobby plan lean. Umbra cannot buy a Railway upgrade for you — raise the service plan, then opt in.

1. Railway service → **Settings → Resources** → raise memory to **≥ 2 GB** (cgroup at or above ~1800 MB counts as Power).
2. Set env (or tap **Power** in the UI; on 1 GB the UI warns that TLS children can OOM):
   - `UMBRA_POWER=1`
   - `UMBRA_PROFILE=full` (optional; Full in the UI on a ≥2 GB box also rides along with Power)
   - `UMBRA_CURL_MAX=1`
   - `UMBRA_WORKERS=8`
   - Leave `UMBRA_MEM_SOFT_MB` / `UMBRA_MEM_HARD_MB` unset so watermarks follow detected RAM (or pin them if you want)
   - `NODE_OPTIONS=--max-old-space-size=768`
3. **Do not** set `UMBRA_PLAYWRIGHT=1` unless you install Chromium yourself. Power never turns Playwright on.
4. Crawl cap becomes 100 pages. Health payload `power.enabled` should be true.

`UMBRA_PROFILE=full` **alone** does not enable TLS children on a 1 GB cgroup.

The UI **Full** chip on a 1 GB box still runs the full site map but **does not** spawn curl-impersonate children unless Power is on (`UMBRA_POWER=1`, cgroup RAM ≥ ~1800 MB, or the **Power** chip — which warns before enabling on 1 GB).

1. New project on [Railway](https://railway.app) → **Deploy from GitHub** → `froelichwilliam77-design/umbra-osint`.
2. `railway.toml` already selects the Dockerfile and health-checks `/api/health`.
3. Generate a domain. Open the HTTPS URL on phone or desktop. Add to Home Screen (PWA).
4. After a deploy, if a phone PWA shows a **blank black screen**, reload once — `sw.js` is network-first for HTML (`umbra-shell-v2`) so stale `index.html` cannot point at missing hashed JS.

No extra env vars required. Optional: `UMBRA_PROXY`, `HIBP_API_KEY`, `UMBRA_TLS`, Twilio/Numverify keys, watch alert channels (webhook / SMTP or Resend / Telegram). **Do not set `UMBRA_PLAYWRIGHT=1` on 1 GB.** Only enable Playwright on ≥2 GB, with `UMBRA_PLAYWRIGHT_MAX=1` (one Chromium, serial, killed after each GET).

```bash
PORT=43180 HOST=0.0.0.0 npm start
```

The production image installs **curl-impersonate** (`curl_chrome146`) and invokes it as a child process **only for WAF-heavy hosts**. That is still a **single long-lived Node process** on `0.0.0.0:$PORT` — not a second sidecar service. Concurrent curl children are hard-capped (`UMBRA_CURL_MAX`, default 1). Response bodies are streamed and truncated (`UMBRA_BODY_LIMIT`, default 48 KB). Under memory pressure the scan aborts cleanly (`cancelled`) with a human message (Railway Settings → Resources) instead of death-spiraling into an OOM restart. The live ledger reconnects if SSE drops; **Cancel** always stops the UI immediately.

## PWA install (phone)

1. Open the Railway HTTPS URL in Safari (iOS) or Chrome (Android).
2. iOS Safari: Share → **Add to Home Screen**. The manifest + `apple-touch-icon` + `apple-mobile-web-app-capable` meta are present.
3. Android Chrome: menu → **Install app**, or the in-app **Add to Home Screen** button when the browser fires `beforeinstallprompt`.
4. The service worker caches the app shell only. `/api/*` is always network (live scans). Production still serves UI + API from one Node process.

## Docker (optional Tor sidecar)

Clearnet is the default. Tor is opt-in.

```bash
docker compose up --build
# http://127.0.0.1:43180
```

```bash
UMBRA_PROXY=socks5://tor:9050 docker compose --profile tor up --build
```

## What each mode does

| Mode | Pre-flight | Work |
| --- | --- | --- |
| **Handle** | length/charset regex | WhatsMyName + Sherlock overlay + curated YAML. Dual-condition match. TLS impersonation on protected hosts. Optional Playwright GET escalation. Avatar pHash clusters. |
| **Mail** | format, disposable list, MX | Identity dossier (Gravatar, M365, SPF/DMARC/DKIM/BIMI, **HIBP** when keyed, open-in links) + silent oracles (high-signal first). Lean skips quarantined/chronically blocked. **Run pivots** → local-part handle then mail domain host. |
| **Host** | hostname sanity | RDAP, DNS, SPF/DMARC/DKIM/BIMI, security.txt, HTTPS, TLS cert SAN. |
| **Phone** | E.164 / libphonenumber | Country, NANP region, line type, timezone hint, optional Twilio/Numverify carrier, public lookup pivots. Never SMS. |
| **Crawl** | http(s) URL or `crawl this host …`; SSRF | Bounded same-origin spider (25 pages lean / 100 power). Harvests emails, usernames, links, security headers. No form submit, no SMTP/SMS. |
| **Auto** | — | `@` → mail; phone-shaped → phone; `http(s)://` or “crawl this host” → crawl; dotted hostname with a TLD → host; otherwise handle. |

### Classification

Ledger statuses: **found / miss / blocked / escalate / error / invalid**.

- 403, 429, 451, 401, CAPTCHA, and WAF signatures are **blocked**, never a miss.
- HTTP 404/410/400 without an exist match is **miss** with a reason.
- Redirects off-profile (login / explore / site root) are **miss** with a reason.
- Exist/missing substring collisions (e.g. `"them":` vs `"them":null`) resolve to the more specific side.
- Mail oracles recover unclassified JSON flags, taken/available copy, CSRF, and signup HTML into found/miss/blocked. Escalate is the last resort.
- Chronically CSRF-dead oracles (X, Instagram, Facebook, TikTok, Myspace) are **quarantined**. Lean skips them entirely; Full emits them as **blocked** without a probe.

### Anti-bot (what actually ships)

- Chrome-matched headers, UA rotation, HTTP/2 via undici, per-host workers, jitter, `Retry-After` on 429/503.
- **curl-impersonate** (Chrome TLS/JA3) when the binary is present (Docker image installs `curl_chrome146`). `UMBRA_TLS=auto` (default) uses it **only for WAF-heavy hosts** (Cloudflare/Akamai/…). Everything else stays on undici. `UMBRA_TLS=always` forces it; `off` disables it. Concurrent children are hard-capped (`UMBRA_CURL_MAX`, default **1**).
- **Playwright** is optional and **off by default** (Docker/Railway do not force it on). `UMBRA_PLAYWRIGHT=1` plus `npx playwright install chromium` retries blocked/escalate Cloudflare/CAPTCHA rows with an authorized public **GET** only (no logins, no credential stuffing, SSRF still applies). Hard caps: **one Chromium at a time**, killed after each navigation, `UMBRA_PLAYWRIGHT_MAX` default **1**. Do not enable on Railway 1 GB.

Local without Docker: TLS impersonation is **partial** until `curl-impersonate` is on `PATH` or `UMBRA_CURL_IMPERSONATE` points at `curl_chrome146`. Check `GET /api/health` (`tlsImpersonation`, `tlsBinary`, `tlsNote`).

### Mail safety

Oracles read public signup, login-precheck, or profile endpoints only. There is no SMTP client and no password-reset mailer. Have I Been Pwned is a first-class dossier field when `HIBP_API_KEY` is set (breach names, dates, data classes). Without a key the HIBP oracle is omitted entirely — never a fake miss. Public paste/stealer pivots (Google paste search, gists, Hudson Rock, IntelX, LeakIX) are links only — no paid scraping.

### Phone safety

Public numbering-plan metadata, timezone hints, and search/profile URLs only. Optional live carrier APIs require your own keys. Umbra never sends SMS or places calls (`wa.me` is a public chat deep-link, not a message send).

## Schema

See [`schema/README.md`](schema/README.md).

| File | Role |
| --- | --- |
| `schema/wmn-data.json` | Vendored [WhatsMyName](https://github.com/WebBreacher/WhatsMyName) snapshot (717) |
| `schema/sherlock-overlay.json` | [Sherlock](https://github.com/sherlock-project/sherlock) platforms not already in WMN (267), dual-condition |
| `schema/sites.curated.yaml` | Extra handle targets + JSON extractors |
| `schema/oracles.yaml` | Silent mail oracles |
| `schema/disposable-domains.txt` | Burn-mail flags |

```bash
npm run sync:wmn
```

That refreshes both WhatsMyName and the Sherlock overlay. Runtime import: `POST /api/schema/import` with a WhatsMyName JSON document.

NSFW (`xx NSFW xx`) is excluded unless you enable **include NSFW registry**.

## API

- `POST /api/scans` `{ query, mode?, includeNsfw?, workers?, perHost?, replace?, profile?, power? }` (`mode`: `auto` \| `handle` \| `mail` \| `host` \| `phone` \| `crawl`; `profile`: `lean` \| `full`; `power`: TLS + 8 workers for this scan)
- `GET /api/scans` in-memory summaries (for compare)
- `GET /api/scans/:id` snapshot + graph
- `GET /api/scans/:id/events` SSE ledger (batched; found rows flush immediately)
- `GET /api/scans/:id/graph`
- `GET /api/scans/compare?a=&b=` found-site diff of two in-memory scans
- `GET /api/scans/:id/export?format=md|json|jsonl|csv|html` (HTML is print-ready executive report)
- `GET /api/cases` persisted cases (`persist`: `volume` \| `memory`)
- `POST /api/cases` `{ scanId }` or imported case JSON
- `GET /api/cases/:id` · `DELETE /api/cases/:id` · `GET /api/cases/:id/export?format=json|md|html`
- `GET /api/cases/compare?a=&b=`
- `GET /api/watches` · `POST /api/watches` `{ query, mode?, intervalHours? }` · `DELETE /api/watches/:id` · `POST /api/watches/:id/run`
- `GET /api/alerts` · `GET /api/alerts/setup` · `POST /api/alerts/test` · `POST /api/alerts/:id/read`
- `POST /api/cases/:id/share` `{ expiresInHours? }` · `GET /api/cases/:id/shares` · `GET /api/share/:token` · `GET /api/c/:id?token=` · `POST /api/shares/:token/revoke`
- `POST /api/batch` `{ text }` lean serial queue · `GET /api/batch/:id` · `POST /api/batch/:id/cancel` · `GET /api/batch/:id/export?format=json|csv|md`
- `GET /api/schema` registry stats (`oraclesLean`)
- `GET /api/health` TLS / Playwright / HIBP / cases persist / watches / alert setup / shares / power flags + 1 GB banner

## Tests

Vitest covers dual-condition matching (case-insensitive / whitespace-tolerant), 403/429/451/CAPTCHA classification, redirect/soft-404/JSON recovery, Sherlock conversion, phone E.164, pHash clustering, identity-graph pivots, scan compare, TLS/Playwright flags, email dossier + Holehe-style oracle matchers, extractors, schema/oracle integrity, lean ranking + chronic-block skip, SSRF blocks, persistent cases + executive HTML, watch diffs + first-seen timeline, alert channels (webhook / Resend / Telegram) plus setup/test (no secrets in the payload), read-only share tokens, batch queue parse/cancel/export, power-mode caps (~1800 MB / UI Power / 1 GB banner), user-facing scan errors, and bounded crawl harvest/SSRF.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `UMBRA_PORT` | `43180` | Engine bind |
| `HOST` | `0.0.0.0` | Engine host |
| `UMBRA_PROXY` | unset (clearnet) | `http://` or `socks5://` proxy |
| `HIBP_API_KEY` | unset | Have I Been Pwned v3 key. When set, breaches land in the mail dossier + ledger (names, dates, data classes). When unset, HIBP is omitted (not a miss). Get a key at haveibeenpwned.com/API/Key — set it in Railway Variables, never in the UI. |
| `UMBRA_CASES_DIR` | `/data/cases` if `/data` is writable, else unset | JSON volume for cases. Without it, the UI uses IndexedDB/localStorage. |
| `UMBRA_WATCHES_DIR` | `<cases>/_watches` or `/data/watches` | Watch + alert JSON. Same volume as cases. |
| `UMBRA_ALERT_WEBHOOK` | unset | Optional POST URL for new-found watch alerts (operator webhook). |
| `UMBRA_ALERT_EMAIL` | unset | Operator inbox for watch alerts. Never the investigation subject. |
| `UMBRA_SMTP_HOST` / `UMBRA_SMTP_PORT` / `UMBRA_SMTP_USER` / `UMBRA_SMTP_PASS` / `UMBRA_SMTP_FROM` | unset | SMTP alert mail (587 STARTTLS, 465 implicit TLS). Used when Resend is not set. |
| `RESEND_API_KEY` or `UMBRA_RESEND_API_KEY` | unset | Resend HTTPS email. Preferred over SMTP when both are set. Needs `UMBRA_ALERT_EMAIL`. |
| `UMBRA_TELEGRAM_BOT_TOKEN` + `UMBRA_TELEGRAM_CHAT_ID` | unset | Telegram bot alert (operator chat). No SMS. |
| `UMBRA_WATCH_MIN_MS` | `3600000` (1h) | Minimum watch interval (tests may lower this). Default interval is 24h. |
| `UMBRA_PROFILE` | `lean` on Railway / Docker; `full` locally | Handle map: `lean` ≈ 250 curated + high-signal sites (chronic WAF skipped); `full` is the complete clearnet map (fast tier first). Does **not** by itself enable TLS on 1 GB. |
| `UMBRA_POWER` | unset | `1` enables power: 8 workers, `UMBRA_CURL_MAX` at least 1, 100-page crawl. Also on when cgroup RAM ≥ ~1800 MB or the UI Power chip is used. Playwright stays off. |
| `UMBRA_CRAWL_PAGES` | `25` lean / `100` power | Max pages for a same-origin crawl. |
| `UMBRA_LEAN_SITES` | `250` | Cap for lean handle scans (50–400) |
| `UMBRA_FAST_TIER` | `150` | High-signal sites probed first on a full handle scan |
| `UMBRA_TLS` | `auto` | `auto` / `always` / `off` for curl-impersonate. `auto` uses it only on WAF-heavy hosts |
| `UMBRA_CURL_IMPERSONATE` | auto-detect | Path to `curl_chrome146` (or similar) |
| `UMBRA_CURL_MAX` | `0` | Max concurrent curl-impersonate children (hard cap 2). **0 on 1 GB Railway**. Power sets this to **1**. |
| `UMBRA_WORKERS` | `4` | Default global scan concurrency (hard cap 8) |
| `UMBRA_PER_HOST` | `1` | Default per-host concurrency (max 2) |
| `UMBRA_BODY_LIMIT` | `48000` | Streamed response body cap (bytes) |
| `UMBRA_PLAYWRIGHT` | `0` (unset = off) | `1` to escalate blocked/CAPTCHA GETs with Chromium. **Off on 1 GB Railway.** |
| `UMBRA_PLAYWRIGHT_MAX` | `1` | Max Playwright retries per handle scan (serial, one browser) |
| `UMBRA_SCAN_STALE_MS` | `600000` (10m) | Auto-cancel a scan that makes no progress |
| `UMBRA_MAX_SCANS` | `1` | Concurrent in-flight scans |
| `UMBRA_MEM_SOFT_MB` / `UMBRA_MEM_HARD_MB` | auto (`450`/`600` on 1 GB; ~70%/85% of RAM when ≥~1800 MB, cap 5500/7000) | Skip extra TLS/Playwright at soft; abort scan at hard. Unset to auto-scale. `UMBRA_RSS_*` aliases work too. |
| `NODE_OPTIONS` | `--max-old-space-size=384` in Docker | V8 heap cap so RSS stays under the 1 GB cgroup |
| `UMBRA_PHONE_REGION` | `US` | Default region when the query has no `+` country code |
| `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` | unset | Optional Twilio Lookup v2 (carrier / line type). Skip if unset. |
| `NUMVERIFY_API_KEY` | unset | Optional Numvalidate. Skip if unset. |
| `WMN_URL` / `SHERLOCK_URL` | upstream main | Overrides for `npm run sync:wmn` |

## Optional Playwright / TLS (local)

```bash
# TLS: binary on PATH (Docker already installs this)
# https://github.com/lexiforest/curl-impersonate/releases
export UMBRA_CURL_IMPERSONATE=/path/to/curl_chrome146

# Playwright (optional, large). GET-only escalation for CF/CAPTCHA rows.
# Do not enable on Railway 1 GB. Serial, one browser, killed after each GET.
npm install -D playwright
npx playwright install chromium
UMBRA_PLAYWRIGHT=1 UMBRA_PLAYWRIGHT_MAX=1 npm start
```
