const CACHE = "umbra-shell-v2";

function isApi(url) {
  return url.pathname.startsWith("/api/");
}

function isNavigationRequest(request) {
  if (request.mode === "navigate") return true;
  if (request.destination === "document") return true;
  const accept = request.headers.get("accept") || "";
  if (accept.includes("text/html")) return true;
  try {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname.endsWith(".html")) return true;
  } catch {
    /* ignore */
  }
  return false;
}

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/manifest.webmanifest", "/icons/icon-192.png"]).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return;

  if (isNavigationRequest(event.request)) {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  event.respondWith(cacheAssets(event.request));
});

async function networkFirstNavigation(request) {
  try {
    return await fetch(request, { cache: "no-store" });
  } catch {
    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Umbra offline</title><body style='margin:0;background:#07080c;color:#e8e6e1;font-family:system-ui,sans-serif;padding:2rem'><p style='color:#8b7cf7;letter-spacing:.28em;font-size:12px'>UMBRA</p><p>Needs a network connection after a deploy. Stale HTML is never reused — it would load missing JS and show a blank screen.</p><p><a href='/' style='color:#8b7cf7'>Retry</a></p></body>",
      {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      },
    );
  }
}

async function cacheAssets(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone()).catch(() => undefined);
    return res;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response("", { status: 504, statusText: "offline" });
  }
}
