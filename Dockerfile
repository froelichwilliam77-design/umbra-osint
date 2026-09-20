FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && mkdir -p /opt/curl-impersonate \
  && (curl -fsSL "https://github.com/lexiforest/curl-impersonate/releases/download/v2.2.3/curl-impersonate-v2.2.3.$(uname -m)-linux-gnu.tar.gz" \
      | tar -xz -C /opt/curl-impersonate \
      && ln -sf /opt/curl-impersonate/curl_chrome146 /usr/local/bin/curl_chrome146 \
      && ln -sf /opt/curl-impersonate/curl_chrome146 /usr/local/bin/curl-impersonate \
      && chmod +x /opt/curl-impersonate/curl_chrome* || true) \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
RUN if [ ! -f schema/wmn-data.json ]; then npx tsx scripts/sync-wmn.ts; fi
RUN node scripts/gen-icons.mjs || true
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV UMBRA_TLS=auto
EXPOSE 43180

# Railway injects $PORT. Single Node process binds 0.0.0.0 and serves the Vite build + /api.
# curl-impersonate (Chrome TLS) is invoked as a child process when present — not a second long-lived service.
CMD ["npm", "start"]
