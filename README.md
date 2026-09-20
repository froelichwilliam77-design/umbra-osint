# Umbra

Public-OSINT workstation for **handle**, **mail**, **host**, and **phone** reconnaissance. One search bar, auto-detected input, a live classified ledger, identity graph, and exports. Installable as a phone PWA.

Umbra is not a mock. Handle mode walks WhatsMyName + a Sherlock overlay (**1001** unique platforms; 961 clearnet). Dual-condition matching is case-insensitive and whitespace-tolerant; JSON bodies that name the account recover stale matchers; 403/429/451/CAPTCHA stay **blocked**; HTTP 404/410 and soft-404 bodies stay **miss** with a reason.

Mail mode builds a richer identity dossier (MX provider, disposable/role, Gravatar MD5+SHA256, M365 tenant, domain SPF/DMARC/DKIM/BIMI, RDAP created date, **Have I Been Pwned** when `HIBP_API_KEY` is set, handle + host pivots, open-in OSINT links) and runs silent registration oracles — never SMTP or password-reset mail. **Lean** (Railway default) probes high-signal oracles first (GitHub, Microsoft, Gravatar, Discord, …) and skips quarantined / chronically blocked modules. **Full** still ranks high-signal first, then the rest. Found rows surface immediately as **likely hits** while the scan continues.

Host mode pulls RDAP, DNS, SPF/DMARC/DKIM/BIMI, parsed `security.txt`, HTTPS headers/title, and the TLS certificate.

Phone mode E.164-normalizes with libphonenumber, adds country/region/type/timezone hints (NANP NPA labels where known), public lookup pivots (Google, Truecaller, Whitepages, wa.me, …), and optional Twilio/Numverify carrier lookups behind env keys. It never sends SMS.

Finished scans auto-save as **cases** (dossier + found rows + graph) in IndexedDB/localStorage, and on a server JSON volume when `UMBRA_CASES_DIR` or `/data` is writable. Reopen yesterday’s case, export JSON/Markdown, or compare two cases side by side without a full re-scan. After mail, **Run pivots** queues local-part handle then mail-domain host (one scan at a time — 1 GB safe).

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

### First recon

1. Accept the authorized-use gate.
2. `octocat` in Auto/Handle — classified hits across **1001** sites (961 clearnet). This upgrade local run: **197 found** / 503 miss / 170 blocked / **40 escalate** on 961 clearnet (v1.3.0: 193 found / 461 miss / 178 blocked / 105 escalate on 963). GitHub is **found** with avatar; matching avatars show pHash nodes on the identity graph.
3. `press@github.com` (or another address you are authorized to check) in Mail — dossier + silent oracles (high-signal first). **Likely hits** appear while the scan continues. **Run pivots** walks handle `press` then host `github.com`. HIBP is a first-class dossier card when `HIBP_API_KEY` is set; otherwise it stays off.
4. `github.com` in Host — RDAP / DNS / cert SAN / security.txt / TLS.
5. `+14155552671` (or another number you are authorized to check) in Auto/Phone — E.164, region/type/timezone, public pivots. No SMS.
6. **Cases** — finished scans auto-save. Open / delete / export JSON or Markdown. **Side by side** compares two saved cases.

## Railway (public HTTPS)

Same pattern as before: one Docker process, built UI + `/api`, bind `0.0.0.0`, listen on `$PORT`.

**1 GB hobby / free plan:** keep Playwright **off**. A full 1000-site handle scan with curl-impersonate used to peak at **~1.34 GB RSS** and freeze the phone UI. Production now defaults to:

- `UMBRA_PROFILE=lean` — ~200 curated + high-signal handle sites, high-signal mail oracles first (quarantined / chronically blocked skipped). Toggle **Full** in the UI for the complete map.
- `UMBRA_WORKERS=4`, `UMBRA_CURL_MAX=1`, `UMBRA_BODY_LIMIT=48000`
- RSS cancel at **450 / 600 MB** (`UMBRA_MEM_SOFT_MB` / `UMBRA_MEM_HARD_MB`)
- `NODE_OPTIONS=--max-old-space-size=384`, Playwright off
- SSE row events batched (~150 ms); the ledger virtualizes ~40 visible rows so a phone stays responsive

Target: a mail scan and a lean handle scan complete on 1 GB without an OOM restart.

1. New project on [Railway](https://railway.app) → **Deploy from GitHub** → `froelichwilliam77-design/umbra-osint`.
2. `railway.toml` already selects the Dockerfile and health-checks `/api/health`.
3. Generate a domain. Open the HTTPS URL on phone or desktop. Add to Home Screen (PWA).
4. After a deploy, if a phone PWA shows a **blank black screen**, reload once — `sw.js` is network-first for HTML (`umbra-shell-v2`) so stale `index.html` cannot point at missing hashed JS.

No extra env vars required. Optional: `UMBRA_PROXY`, `HIBP_API_KEY`, `UMBRA_TLS`, Twilio/Numverify keys. **Do not set `UMBRA_PLAYWRIGHT=1` on 1 GB.** Only enable Playwright on ≥2 GB, with `UMBRA_PLAYWRIGHT_MAX=1` (one Chromium, serial, killed after each GET).

```bash
PORT=43180 HOST=0.0.0.0 npm start
```

The production image installs **curl-impersonate** (`curl_chrome146`) and invokes it as a child process **only for WAF-heavy hosts**. That is still a **single long-lived Node process** on `0.0.0.0:$PORT` — not a second sidecar service. Concurrent curl children are hard-capped (`UMBRA_CURL_MAX`, default 1). Response bodies are streamed and truncated (`UMBRA_BODY_LIMIT`, default 48 KB). Under memory pressure the scan aborts cleanly (`cancelled`) instead of death-spiraling into an OOM restart.

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
| **Auto** | — | `@` → mail; phone-shaped → phone; dotted hostname with a TLD → host; otherwise handle. |

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

Oracles read public signup, login-precheck, or profile endpoints only. There is no SMTP client and no password-reset mailer. Have I Been Pwned is a first-class dossier field when `HIBP_API_KEY` is set (breach names + dates). Without a key the HIBP oracle is omitted entirely — never a fake miss.

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

- `POST /api/scans` `{ query, mode?, includeNsfw?, workers?, perHost?, replace?, profile? }` (`profile`: `lean` | `full`)
- `GET /api/scans` in-memory summaries (for compare)
- `GET /api/scans/:id` snapshot + graph
- `GET /api/scans/:id/events` SSE ledger (batched; found rows flush immediately)
- `GET /api/scans/:id/graph`
- `GET /api/scans/compare?a=&b=` found-site diff of two in-memory scans
- `GET /api/scans/:id/export?format=md|json|jsonl|csv|html`
- `GET /api/cases` persisted cases (`persist`: `volume` \| `memory`)
- `POST /api/cases` `{ scanId }` or imported case JSON
- `GET /api/cases/:id` · `DELETE /api/cases/:id` · `GET /api/cases/:id/export?format=json|md`
- `GET /api/cases/compare?a=&b=`
- `GET /api/schema` registry stats (`oraclesLean`)
- `GET /api/health` TLS / Playwright / HIBP / cases persist flags

## Tests

Vitest covers dual-condition matching (case-insensitive / whitespace-tolerant), 403/429/451/CAPTCHA classification, redirect/soft-404/JSON recovery, Sherlock conversion, phone E.164, pHash clustering, identity-graph pivots, scan compare, TLS/Playwright flags, email dossier + Holehe-style oracle matchers (LastPass, Issuu, Steam, Discord, Hudson Rock, …), extractors, schema/oracle integrity, and SSRF blocks.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `UMBRA_PORT` | `43180` | Engine bind |
| `HOST` | `0.0.0.0` | Engine host |
| `UMBRA_PROXY` | unset (clearnet) | `http://` or `socks5://` proxy |
| `HIBP_API_KEY` | unset | Have I Been Pwned v3 key. When set, breaches land in the mail dossier + ledger. When unset, HIBP is omitted (not a miss). |
| `UMBRA_CASES_DIR` | `/data/umbra-cases` if `/data` is writable, else unset | Optional JSON volume for cases. Without it, the UI uses IndexedDB/localStorage. |
| `UMBRA_PROFILE` | `lean` on Railway / Docker; `full` locally | Handle map: `lean` ≈ 200 curated + high-signal sites; `full` is the complete clearnet map (fast tier first) |
| `UMBRA_LEAN_SITES` | `200` | Cap for lean handle scans |
| `UMBRA_FAST_TIER` | `150` | High-signal sites probed first on a full handle scan |
| `UMBRA_TLS` | `auto` | `auto` / `always` / `off` for curl-impersonate. `auto` uses it only on WAF-heavy hosts |
| `UMBRA_CURL_IMPERSONATE` | auto-detect | Path to `curl_chrome146` (or similar) |
| `UMBRA_CURL_MAX` | `1` | Max concurrent curl-impersonate children (hard cap 2) |
| `UMBRA_WORKERS` | `4` | Default global scan concurrency (hard cap 8) |
| `UMBRA_PER_HOST` | `1` | Default per-host concurrency (max 2) |
| `UMBRA_BODY_LIMIT` | `48000` | Streamed response body cap (bytes) |
| `UMBRA_PLAYWRIGHT` | `0` (unset = off) | `1` to escalate blocked/CAPTCHA GETs with Chromium. **Off on 1 GB Railway.** |
| `UMBRA_PLAYWRIGHT_MAX` | `1` | Max Playwright retries per handle scan (serial, one browser) |
| `UMBRA_SCAN_STALE_MS` | `600000` (10m) | Auto-cancel a scan that makes no progress |
| `UMBRA_MAX_SCANS` | `1` | Concurrent in-flight scans |
| `UMBRA_MEM_SOFT_MB` / `UMBRA_MEM_HARD_MB` | `450` / `600` | Skip extra TLS/Playwright at soft; abort scan at hard (`UMBRA_RSS_*` aliases work too) |
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
