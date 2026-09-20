FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY . .
# GitHub clones may omit the vendored WMN snapshot; fetch it at build time.
RUN if [ ! -f schema/wmn-data.json ]; then node scripts/sync-wmn.mjs; fi
RUN npm run build

ENV NODE_ENV=production
ENV HOST=0.0.0.0
EXPOSE 43180

# Railway injects $PORT. The process binds 0.0.0.0 and serves the Vite build + /api.
CMD ["npm", "start"]
