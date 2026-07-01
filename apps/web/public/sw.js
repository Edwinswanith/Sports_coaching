/* Minimal PWA service worker. In production it satisfies Android installability
 * and provides a conservative offline fallback. On local dev hosts it
 * immediately unregisters itself so stale app shells cannot hide code changes.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);
const IS_LOCAL_DEV = LOCAL_HOSTS.has(self.location.hostname);
const CACHE = "apex-shell-v2";
const SHELL = ["/", "/icon-192.png", "/icon-512.png"];

if (IS_LOCAL_DEV) {
  self.addEventListener("install", (event) => {
    event.waitUntil(self.skipWaiting());
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => self.clients.claim())
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll({ type: "window" }))
        .then((clients) => {
          clients.forEach((client) => client.navigate(client.url));
        })
        .catch(() => undefined)
    );
  });
} else {
  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => undefined)
    );
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim())
    );
  });

  self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);
    // Only handle same-origin, non-API GETs; let the browser do all API/auth
    // traffic so session checks never read stale cached JSON or cached 401s.
    if (req.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
      return;
    }

    // Navigations: network-first, fall back to cached shell when offline.
    if (req.mode === "navigate") {
      event.respondWith(
        fetch(req)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            return res;
          })
          .catch(() => caches.match(req).then((m) => m || caches.match("/")))
      );
      return;
    }

    // Static same-origin assets: cache-first with background refresh.
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
            return res;
          })
      )
    );
  });
}
