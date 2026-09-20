# Umbra

Public-OSINT workstation for **handle**, **mail**, and **host** reconnaissance. One search bar, auto-detected input, a live classified ledger, and exports.

Umbra is not a mock. Handle mode walks the WhatsMyName-scale site registry (700+ platforms, plus a curated overlay: Wikipedia, Stack Overflow, Hugging Face, LinkedIn, Mastodon, Bluesky, Codeberg, Docker Hub, RubyGems, Lichess, Launchpad, and more). Dual-condition matching is case-insensitive and whitespace-tolerant; JSON bodies that name the account recover stale matchers; 403/429/451/CAPTCHA stay **blocked**; HTTP 404/410 and soft-404 bodies stay **miss** with a reason; per-site username regex skips invalid handles.

Mail mode builds a richer identity dossier (MX provider, disposable/role, Gravatar MD5+SHA256, M365 tenant, domain SPF/DMARC/DKIM/BIMI, RDAP created date, handle pivots, open-in OSINT links) and runs silent registration oracles — never SMTP or password-reset mail.

Host mode pulls RDAP (registrar, dates, DNSSEC, abuse contact, nameservers), DNS A/AAAA/MX/NS/TXT/CNAME/SOA/CAA, SPF/DMARC/DKIM/BIMI, parsed `security.txt`, HTTPS title/headers/HSTS/CSP, and the TLS certificate subject + SAN + days remaining.

**Authorized use only.** Run it against identifiers you are allowed to investigate. Umbra never sends SMTP or password-reset mail to a subject. Server-side fetches refuse private, loopback, link-local, and metadata addresses (SSRF).

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

Live console screenshots from a local run:

- Handle `octocat` — [docs/screenshots/handle_octocat_ledger.png](docs/screenshots/handle_octocat_ledger.png)
- Mail `press@github.com` — [docs/screenshots/mail_press_github_dossier.png](docs/screenshots/mail_press_github_dossier.png)
- Mail ledger (found oracles) — [docs/screenshots/mail_press_github_ledger.png](docs/screenshots/mail_press_github_ledger.png)
- Host `github.com` — [docs/screenshots/host_github_rdap_dns.png](docs/screenshots/host_github_rdap_dns.png)

### First recon

1. Accept the authorized-use gate.
2. `octocat` in Auto/Handle — classified hits across the registry (GitHub should be **found** with avatar/bio/followers). This upgrade: **738** handle sites (699 clearnet). Local run: **157 found** / 326 miss / 140 blocked / 62 escalate on 699 clearnet (main README cited 163 found on 686, with fewer 404s classified as miss). GitHub is found with matcher recovery + metadata.
3. `press@github.com` (or another address you are authorized to check) in Mail — dossier + **161** silent oracles + **Pivot local-part as handle** + open-in links (Google, HIBP, Hudson Rock, Epieos, Gravatar, …). Sample run: MX + SPF/DMARC + DKIM (`google, selector1, k1, s1, s2`) + M365 Managed + GitHub / Discord / Substack / OpenAI **found**; **29 miss** (LastPass, Hudson Rock, Rambler, Vrbo, …); **29 blocked** (403/429/CAPTCHA — never miss). v1.2.0 shipped **53** oracles.
4. `github.com` in Host — RDAP (MarkMonitor), A/MX/NS/SOA/CAA/TXT, SPF/DMARC/DKIM, parsed security.txt (HackerOne), HTTPS title/headers, TLS cert SAN + days remaining. Local run: **13 found** / 2 miss (AAAA, BIMI) on 15 ledger rows.
5. Export the ledger as Markdown / JSON / JSONL / CSV / HTML.

## Railway (public HTTPS)

Same pattern as STRAND: one Docker process, built UI + `/api`, bind `0.0.0.0`, listen on `$PORT`.

1. New project on [Railway](https://railway.app) → **Deploy from GitHub** → `froelichwilliam77-design/umbra-osint`.
2. `railway.toml` already selects the Dockerfile and health-checks `/api/health`.
3. Generate a domain. Open the HTTPS URL on phone or desktop.

No extra env vars required. Optional: `UMBRA_PROXY`, `HIBP_API_KEY`.

```bash
# local production bind (Railway sets PORT for you)
PORT=43180 HOST=0.0.0.0 npm start
```

## Docker (optional Tor sidecar)

Clearnet is the default. Tor is opt-in.

```bash
docker compose up --build
# http://127.0.0.1:43180
```

```bash
UMBRA_PROXY=socks5://tor:9050 docker compose --profile tor up --build
```

Or point a local process at any HTTP/SOCKS proxy:

```bash
UMBRA_PROXY=socks5://127.0.0.1:9050 npm start
```

## What each mode does

| Mode | Pre-flight | Work |
| --- | --- | --- |
| **Handle** | length/charset regex | WhatsMyName + curated YAML. Dual-condition match (`e_code`+`e_string` / `m_code`+`m_string`), JSON account recovery, 404/410 miss-with-reason. |
| **Mail** | format, disposable list, MX | Identity dossier (provider, plus-address, role, Gravatar MD5+SHA256, M365 tenant, domain SPF/DMARC/DKIM/BIMI, handle pivots, open-in OSINT links) + silent oracles (Holehe-style signup / login-precheck / public API — 161 modules). |
| **Host** | hostname sanity | RDAP, DNS A/AAAA/MX/NS/TXT/CNAME/SOA/CAA, SPF/DMARC/DKIM/BIMI, parsed security.txt, HTTPS headers + `<title>`, TLS cert SAN. |
| **Auto** | — | `@` → mail; dotted hostname with a TLD → host; otherwise handle. |

### Classification

Ledger statuses: **found / miss / blocked / escalate / error / invalid**.

- 403, 429, 451, CAPTCHA, and WAF signatures are **blocked**, never a miss.
- HTTP 404/410 without an exist match is **miss** with a reason, even if `m_string` drifted.
- Redirects off-profile (login / explore / site root) are **miss** with a reason.
- JSON bodies that name the account recover stale WhatsMyName `e_string`s as **found**.
- Both exist and missing conditions matching — or neither — is **escalate**.

### Anti-bot (what actually ships)

Browser-matched headers, UA rotation, HTTP/2 via undici, redirect policy (manual for handle probes so 302-as-miss still works), global workers + per-host limit + jitter.

**Limitation:** Umbra does not bundle `curl-impersonate` / `rquest` / Playwright. Sites that fingerprint TLS (JA3/JA4) may **block** or **escalate**. Prefer the optional SOCKS/Tor path or a residential proxy (`UMBRA_PROXY`) when that happens. A Playwright fallback is intentionally not the default — it would slow first usable delivery.

### Mail safety

Oracles read public signup, login-precheck, or profile endpoints only. There is no SMTP client and no password-reset mailer. Have I Been Pwned is skipped unless `HIBP_API_KEY` is set.

## Schema

See [`schema/README.md`](schema/README.md).

| File | Role |
| --- | --- |
| `schema/wmn-data.json` | Vendored [WhatsMyName](https://github.com/WebBreacher/WhatsMyName) snapshot |
| `schema/sites.curated.yaml` | Extra handle targets + JSON extractors |
| `schema/oracles.yaml` | Silent mail oracles |
| `schema/disposable-domains.txt` | Burn-mail flags |

```bash
npm run sync:wmn
```

Runtime import: `POST /api/schema/import` with a WhatsMyName JSON document.

NSFW WhatsMyName category (`xx NSFW xx`) is excluded unless you enable **include NSFW registry**.

## API

- `POST /api/scans` `{ query, mode?, includeNsfw?, workers?, perHost? }`
- `GET /api/scans/:id` snapshot
- `GET /api/scans/:id/events` SSE ledger
- `GET /api/scans/:id/export?format=md|json|jsonl|csv|html`
- `GET /api/schema` registry stats
- `GET /api/health`

## Tests

Vitest covers dual-condition matching (including case-insensitive / whitespace-tolerant body strings), 403/429/451/CAPTCHA classification, redirect-as-miss, redirect-as-evidence, soft-404, HTTP 404 fallback, JSON account recovery, empty JSON collections, per-site username regex skips, handle preflight, email dossier basics (disposable, role, plus-address, name patterns, pivots, SHA-256, open-in links), Holehe-style oracle matchers (LastPass, Issuu, Steam, Discord, Hudson Rock, …), SPF/DMARC/security.txt parse, metadata/JSON-LD extractors, schema/oracle integrity, and SSRF blocks (loopback, RFC1918, IPv6 ULA, `file:`, credentials).

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` / `UMBRA_PORT` | `43180` | Engine bind |
| `HOST` | `0.0.0.0` | Engine host |
| `UMBRA_PROXY` | unset (clearnet) | `http://` or `socks5://` proxy |
| `HIBP_API_KEY` | unset | Optional breach oracle |
| `WMN_URL` | WhatsMyName main | Override for `npm run sync:wmn` |
