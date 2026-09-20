const CACHE = "umbra-shell-v4";

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

function isNavigate(request) {
  return (
    request.mode === "navigate" ||
    (request.destination === "document" && request.method === "GET") ||
    (request.headers.get("accept") || "").includes("text/html")
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // HTML / navigations: network-only. Never fall back to stale `/` HTML
  // that points at deleted hashed assets after a redeploy.
  if (isNavigate(request) || url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(
      fetch(request, { cache: "no-store" }).catch(
        () =>
          new Response(
            "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Umbra offline</title><body style='margin:0;background:#07080c;color:#e8e6e1;font-family:system-ui,sans-serif;padding:2rem'><p style='color:#8b7cf7;letter-spacing:.28em;font-size:12px'>UMBRA</p><p>Needs a network connection after a deploy. Stale HTML is never reused — it would load missing JS and show a blank screen.</p><p><a href='/' style='color:#8b7cf7'>Retry</a></p></body>",
            {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
            },
          ),
      ),
    );
    return;
  }

  // Hashed build assets: cache-first only after a successful fetch of this exact URL.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const res = await fetch(request);
          if (res.ok) {
            cache.put(request, res.clone()).catch(() => undefined);
          }
          return res;
        } catch {
          return (
            cached ||
            new Response("Asset unavailable", {
              status: 504,
              statusText: "offline",
              headers: { "Content-Type": "text/plain" },
            })
          );
        }
      }),
    );
    return;
  }

  // Other same-origin GETs (icons, manifest): network-first, same-URL cache only.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response("Offline", { status: 504, statusText: "offline", headers: { "Content-Type": "text/plain" } });
      }),
  );
});
