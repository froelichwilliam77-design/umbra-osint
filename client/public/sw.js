const CACHE = "umbra-shell-v3";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/manifest.webmanifest", "/icons/icon-192.png"]))
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
            "<!doctype html><title>Offline</title><body style='background:#0a0a0f;color:#f87171;font-family:sans-serif;padding:2rem'>Umbra is offline. Reconnect and refresh.</body>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
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
              status: 503,
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
        return new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }),
  );
});
