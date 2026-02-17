const CACHE_NAME = "memo-pwa-v2";
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "icons/icon-192.svg",
  "icons/icon-512.svg",
];

const apiConfig = {
  origin: self.location.origin,
  pathname: "/sync",
};

self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "api-endpoint") {
    return;
  }
  try {
    const url = new URL(event.data.endpoint, self.location.origin);
    apiConfig.origin = url.origin;
    apiConfig.pathname = url.pathname;
  } catch (error) {
    console.warn("Invalid API endpoint message", error);
  }
});

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

const isApiRequest = (request) => {
  const url = new URL(request.url);
  return url.origin === apiConfig.origin && url.pathname === apiConfig.pathname;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") {
    return;
  }

  if (isApiRequest(request)) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({
            error: "offline",
            message: "Network unavailable. Sync is disabled while offline.",
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json" },
          }
        )
      )
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("index.html", copy));
          return response;
        })
        .catch(() => caches.match("index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) =>
      cached ||
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
    )
  );
});
