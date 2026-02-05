const VERSION = "2026-02-04-1";
const SHELL_CACHE = `stone-shell-${VERSION}`;
const RUNTIME_CACHE = `stone-runtime-${VERSION}`;
const CACHE_PREFIX = "stone-";
const OFFLINE_FALLBACK = "/index.html";
const SHELL_ASSETS = ["/", OFFLINE_FALLBACK];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, OFFLINE_FALLBACK));
    return;
  }

  const isMaterial = url.pathname.startsWith("/materials/");
  const isPdf = url.pathname.toLowerCase().endsWith(".pdf");
  const destination = request.destination;

  if (isPdf) {
    // Let browser/PDF.js handle PDF range requests directly for better mobile compatibility.
    return;
  }

  if (isMaterial || destination === "image" || destination === "video" || destination === "audio") {
    event.respondWith(cacheFirst(request, RUNTIME_CACHE));
    return;
  }

  if (destination === "style" || destination === "script" || destination === "font") {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

async function networkFirst(request, cacheName, fallbackPath) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    const fallback = await cache.match(fallbackPath);
    if (fallback) return fallback;
    throw new Error("network unavailable");
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    void networkFetch;
    return cached;
  }

  const fresh = await networkFetch;
  if (fresh) return fresh;
  throw new Error("network unavailable");
}
