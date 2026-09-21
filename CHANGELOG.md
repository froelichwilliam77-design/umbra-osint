# Changelog

## 1.14.0

Closes the remaining public-OSINT workstation gaps on top of live v1.13.0.

- **Image reverse** — Google Lens / Yandex / TinEye / Bing Visual / SauceNAO search-by-URL on found avatars (and Gravatar). Uploaded images hash locally (pHash) and match the current scan; no engine scrape.
- **Domain depth** — Certificate Transparency (Cert Spotter + crt.sh), PTR, public DNS history (HackerTarget on Full/Power), CT-derived subdomains, RDAP/crt.sh/urlscan open links.
- **Public pastes** — DuckDuckGo HTML harvest + GET-verify of pastebin / gist / rentry / dpaste / paste.ee (no paid dark-web markets).
- **Identity clustering** — same-person groups from pHash, display names, cross-site handles, and websites, with confidence scores and a cluster graph/UI.
- **Report export** — printable HTML client brief (print → PDF) plus Markdown covering summary, hits, identity clusters, AI public shares, pastes, CT, and operator notes.
- **Phone depth** — more public pivots plus optional AbstractAPI / OpenCNAM when those env keys are set (Twilio/Numverify unchanged).
- **People search** — public profile / Google dork URLs only (LinkedIn, X, Facebook, Instagram, GitHub, Reddit, Epieos). No paid broker scrapes.
- **Local / offline** — `UMBRA_CASES_DIR=./data/cases npm run dev` (or Docker Compose named volume). No Dockerfile `VOLUME`.
- **Multi-operator** — optional **write shares** + 8-char join codes that can append operator notes. Not a full IdP; revoke to kill access.
- **Alerts + HIBP UX** — clearer empty states and Test-alert copy. Telegram / Resend / webhook / HIBP light up in Alerts / settings when the Railway Variables are set. Umbra does not invent keys.
- **AI chats** — still public-share / account-signal only. Harvest also looks for Gemini / Grok public share URL schemes. No magic-link oracles that email the subject.

Railway Variables that unlock live HIBP and outbound alerts: `HIBP_API_KEY`, `UMBRA_TELEGRAM_BOT_TOKEN` + `UMBRA_TELEGRAM_CHAT_ID`, `RESEND_API_KEY` (or `UMBRA_RESEND_API_KEY`) + `UMBRA_ALERT_EMAIL`, `UMBRA_SMTP_*` + `UMBRA_ALERT_EMAIL`, `UMBRA_ALERT_WEBHOOK`.
