FROM node:22-bookworm-slim

WORKDIR /app

# curl-impersonate (Chrome TLS) + Playwright Chromium deps for GET-only WAF escalation.
# Still a single long-lived Node process on 0.0.0.0:$PORT — not extra sidecars.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libasound2 libpango-1.0-0 libcairo2 libx11-6 libx11-xcb1 \
    libxcb1 libxext6 libxshmfence1 fonts-liberation \
  && mkdir -p /opt/curl-impersonate \
  && (curl -fsSL "https://github.com/lexiforest/curl-impersonate/releases/download/v2.2.3/curl-impersonate-v2.2.3.$(uname -m)-linux-gnu.tar.gz" \
      | tar -xz -C /opt/curl-impersonate \
      && ln -sf /opt/curl-impersonate/curl_chrome146 /usr/local/bin/curl_chrome146 \
      && ln -sf /opt/curl-impersonate/curl_chrome146 /usr/local/bin/curl-impersonate \
      && chmod +x /opt/curl-impersonate/curl_chrome* || true) \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY package-lock.json* ./
# Never download Chromium at install time — it OOMs a 1 GB cgroup via page cache + RSS.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN if [ ! -f schema/wmn-data.json ]; then npx tsx scripts/sync-wmn.ts; fi
RUN node scripts/gen-icons.mjs || true
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV UMBRA_TLS=auto
# Playwright stays OFF and browsers are not in the image.
# Do not set UMBRA_PLAYWRIGHT=1 unless the service has ≥2 GB RAM and you install Chromium.
ENV UMBRA_PLAYWRIGHT=0
ENV UMBRA_PLAYWRIGHT_MAX=1
ENV UMBRA_PROFILE=lean
ENV UMBRA_WORKERS=4
# Child curl processes are invisible to Node RSS and blew the 1 GB cgroup (~951 MB).
# Attach a Railway volume at /data (cases + watches JSON). Override with UMBRA_CASES_DIR.
ENV UMBRA_CURL_MAX=0
ENV UMBRA_BODY_LIMIT=48000
# RSS watermarks auto-scale from cgroup RAM (450/600 on 1 GB; ~70%/85% when ≥~1800 MB).
# Do not pin UMBRA_MEM_SOFT_MB / UMBRA_MEM_HARD_MB here — that freezes 1 GB limits on 8 GB hosts.
ENV NODE_OPTIONS=--max-old-space-size=384
EXPOSE 43180

# Directory exists in the image so the process can mkdir cases/watches even without a mount.
# Do NOT add a Dockerfile VOLUME — Railway's Metal builder rejects it
# ("dockerfile invalid: docker VOLUME is not supported, use Railway Volumes").
# Attach the named volume in Railway Settings → Volumes, mount path `/data`.
RUN mkdir -p /data

# Railway injects $PORT. Single Node process binds 0.0.0.0 and serves the Vite build + /api.
# curl-impersonate (Chrome TLS) and Playwright Chromium are child processes — not extra services.
# Power mode (UMBRA_POWER=1, ≥~1800 MB RAM, or UI Power): set UMBRA_CURL_MAX=1 and raise UMBRA_WORKERS. Playwright stays off.
CMD ["npm", "start"]
