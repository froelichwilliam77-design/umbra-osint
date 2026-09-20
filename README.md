# Umbra

Public-OSINT workstation for **handle**, **mail**, **host**, and **phone** reconnaissance. One search bar, auto-detected input, a live classified ledger, identity graph, and exports. Installable as a phone PWA.

Umbra is not a mock. Handle mode walks WhatsMyName + a Sherlock overlay (**1003** unique platforms; 963 clearnet). Dual-condition matching is case-insensitive and whitespace-tolerant; JSON bodies that name the account recover stale matchers; 403/429/451/CAPTCHA stay **blocked**; HTTP 404/410 and soft-404 bodies stay **miss** with a reason.

Mail mode builds a richer identity dossier (MX provider, disposable/role, Gravatar MD5+SHA256, M365 tenant, domain SPF/DMARC/DKIM/BIMI, RDAP created date, handle + host pivots, open-in OSINT links) and runs **161** silent registration oracles — never SMTP or password-reset mail. Have I Been Pwned is skipped entirely unless `HIBP_API_KEY` is set.

Host mode pulls RDAP, DNS, SPF/DMARC/DKIM/BIMI, parsed `security.txt`, HTTPS headers/title, and the TLS certificate.

Phone mode (new) E.164-normalizes with libphonenumber, adds country/region/type hints (NANP NPA labels where known), and optional Twilio/Numverify carrier lookups behind env keys. It never sends SMS.

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
2. `octocat` in Auto/Handle — classified hits across **1003** sites (963 clearnet). This upgrade local run: **193 found** / 461 miss / 178 blocked / 105 escalate on 963 clearnet (v1.1.0: 157 found / 326 miss / 140 blocked / 62 escalate on 699). GitHub is **found** with avatar; matching avatars show pHash nodes on the identity graph.
3. `press@github.com` (or another address you are authorized to check) in Mail — dossier + **161** silent oracles + **1-click pivots** to handle `press` and host `github.com` + open-in links (Google, HIBP, Hudson Rock, Epieos, Gravatar, …). Sample run: MX + SPF/DMARC + DKIM + M365 Managed + GitHub / Discord / Substack / OpenAI **found**; **29 miss** / **29 blocked** (403/429/CAPTCHA — never miss). v1.2.0 shipped **53** oracles. HIBP stays off unless `HIBP_API_KEY` is set.
4. `github.com` in Host — RDAP / DNS / cert SAN / security.txt / TLS.
5. `+14155552671` (or another number you are authorized to check) in Auto/Phone — E.164, region/type, optional carrier.
6. **Save case**, run a second query, **Compare with** the saved run. Export Markdown / JSON / JSONL / CSV / HTML.

## Railway (public HTTPS)

Same pattern as before: one Docker process, built UI + `/api`, bind `0.0.0.0`, listen on `$PORT`.

1. New project on [Railway](https://railway.app) → **Deploy from GitHub** → `froelichwilliam77-design/umbra-osint`.
2. `railway.toml` already selects the Dockerfile and health-checks `/api/health`.
3. Generate a domain. Open the HTTPS URL on phone or desktop. Add to Home Screen (PWA).

No extra env vars required. Optional: `UMBRA_PROXY`, `HIBP_API_KEY`, `UMBRA_TLS`, `UMBRA_PLAYWRIGHT`, Twilio/Numverify keys.

```bash
PORT=43180 HOST=0.0.0.0 npm start
```

The production image installs **curl-impersonate** (`curl_chrome146`) and invokes it as a child process for protected/WAF hosts. That is still a **single long-lived Node process** on `0.0.0.0:$PORT` — not a second sidecar service.

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
| **Mail** | format, disposable list, MX | Identity dossier (Gravatar MD5+SHA256, M365, SPF/DMARC/DKIM/BIMI, open-in OSINT links) + **161** silent oracles (Holehe-style). 1-click pivots to local-part handle and mail domain host. HIBP skipped unless keyed. |
| **Host** | hostname sanity | RDAP, DNS, SPF/DMARC/DKIM/BIMI, security.txt, HTTPS, TLS cert SAN. |
| **Phone** | E.164 / libphonenumber | Country, NANP region, line type, optional Twilio/Numverify carrier. Public search links only — no SMS. |
| **Auto** | — | `@` → mail; phone-shaped → phone; dotted hostname with a TLD → host; otherwise handle. |

### Classification

Ledger statuses: **found / miss / blocked / escalate / error / invalid**.

- 403, 429, 451, CAPTCHA, and WAF signatures are **blocked**, never a miss.
- HTTP 404/410 without an exist match is **miss** with a reason.
- Redirects off-profile (login / explore / site root) are **miss** with a reason.
- Both exist and missing conditions matching — or neither — is **escalate**.

### Anti-bot (what actually ships)

- Chrome-matched headers, UA rotation, HTTP/2 via undici, per-host workers, jitter, `Retry-After` on 429/503.
- **curl-impersonate** (Chrome TLS/JA3) when the binary is present (Docker image installs `curl_chrome146`). `UMBRA_TLS=auto` (default) uses it for `protection[]` / known WAF hosts and retries a WAF-blocked undici probe. `UMBRA_TLS=always` forces it; `off` disables it.
- **Playwright** is optional and off by default. `UMBRA_PLAYWRIGHT=1` plus `npx playwright install chromium` retries blocked/escalate Cloudflare/CAPTCHA rows with an authorized public **GET** only (no logins, no credential stuffing, SSRF still applies). Cap with `UMBRA_PLAYWRIGHT_MAX` (default 20).

Local without Docker: TLS impersonation is **partial** until `curl-impersonate` is on `PATH` or `UMBRA_CURL_IMPERSONATE` points at `curl_chrome146`. Check `GET /api/health` (`tlsImpersonation`, `tlsBinary`, `tlsNote`).

### Mail safety

Oracles read public signup, login-precheck, or profile endpoints only. There is no SMTP client and no password-reset mailer. Have I Been Pwned is skipped unless `HIBP_API_KEY` is set (the oracle row is not emitted).

### Phone safety

Public numbering-plan metadata only. Optional live carrier APIs require your own keys. Umbra never sends SMS or places calls.

## Schema

See [`schema/README.md`](schema/README.md).

| File | Role |
| --- | --- |
| `schema/wmn-data.json` | Vendored [WhatsMyName](https://github.com/WebBreacher/WhatsMyName) snapshot (717) |
| `schema/sherlock-overlay.json` | [Sherlock](https://github.com/sherlock-project/sherlock) platforms not already in WMN (265), dual-condition |
| `schema/sites.curated.yaml` | Extra handle targets + JSON extractors |
| `schema/oracles.yaml` | Silent mail oracles |
| `schema/disposable-domains.txt` | Burn-mail flags |

```bash
npm run sync:wmn
```

That refreshes both WhatsMyName and the Sherlock overlay. Runtime import: `POST /api/schema/import` with a WhatsMyName JSON document.

NSFW (`xx NSFW xx`) is excluded unless you enable **include NSFW registry**.

## API

- `POST /api/scans` `{ query, mode?, includeNsfw?, workers?, perHost? }`
- `GET /api/scans` in-memory summaries (for compare)
- `GET /api/scans/:id` snapshot + graph
- `GET /api/scans/:id/events` SSE ledger (includes `graph` / `clusters`)
- `GET /api/scans/:id/graph`
- `GET /api/scans/compare?a=&b=` found-site diff of two in-memory scans
- `GET /api/scans/:id/export?format=md|json|jsonl|csv|html`
- `GET /api/schema` registry stats
- `GET /api/health` TLS / Playwright / HIBP flags

## Tests

Vitest covers dual-condition matching (case-insensitive / whitespace-tolerant), 403/429/451/CAPTCHA classification, redirect/soft-404/JSON recovery, Sherlock conversion, phone E.164, pHash clustering, identity-graph pivots, scan compare, TLS/Playwright flags, email dossier + Holehe-style oracle matchers (LastPass, Issuu, Steam, Discord, Hudson Rock, …), extractors, schema/oracle integrity, and SSRF blocks.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `UMBRA_PORT` | `43180` | Engine bind |
| `HOST` | `0.0.0.0` | Engine host |
| `UMBRA_PROXY` | unset (clearnet) | `http://` or `socks5://` proxy |
| `HIBP_API_KEY` | unset | Optional breach oracle (skipped silently if unset) |
| `UMBRA_TLS` | `auto` | `auto` / `always` / `off` for curl-impersonate |
| `UMBRA_CURL_IMPERSONATE` | auto-detect | Path to `curl_chrome146` (or similar) |
| `UMBRA_PLAYWRIGHT` | unset | `1` to escalate blocked/CAPTCHA GETs with Chromium |
| `UMBRA_PLAYWRIGHT_MAX` | `20` | Max Playwright retries per handle scan |
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
npm install -D playwright
npx playwright install chromium
UMBRA_PLAYWRIGHT=1 npm start
```
