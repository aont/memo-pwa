export function setupPwa(logger) {
  try {
    const manifest = {
      name: "Memo PWA",
      short_name: "Memo",
      start_url: ".",
      display: "standalone",
      background_color: "#0b1220",
      theme_color: "#111827",
      icons: [
        {
          src:
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='192' height='192'%3E%3Crect width='192' height='192' rx='36' fill='%23111827'/%3E%3Cpath d='M56 54h80v12H56zM56 82h80v12H56zM56 110h56v12H56z' fill='%2360a5fa'/%3E%3C/svg%3E",
          sizes: "192x192",
          type: "image/svg+xml",
          purpose: "any"
        }
      ]
    };
    const manifestBlob = new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" });
    const manifestUrl = URL.createObjectURL(manifestBlob);
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = manifestUrl;
    document.head.appendChild(link);
    logger?.log?.("PWA manifest attached");
  } catch (e) {
    logger?.err?.("Manifest setup failed", { message: e?.message });
  }

  if (!("serviceWorker" in navigator)) {
    logger?.warn?.("Service worker not supported");
    return;
  }

  const swCode = `
    const CACHE = "memo-pwa-menu-v1";
    self.addEventListener("install", (e) => {
      e.waitUntil((async () => {
        const cache = await caches.open(CACHE);
        cache.addAll([self.registration.scope]);
        self.skipWaiting();
      })());
    });
    self.addEventListener("activate", (e) => {
      e.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
        self.clients.claim();
      })());
    });
    self.addEventListener("fetch", (e) => {
      e.respondWith((async () => {
        const cached = await caches.match(e.request, {ignoreSearch:true});
        if (cached) return cached;
        try{
          const res = await fetch(e.request);
          return res;
        }catch(err){
          const fallback = await caches.match(self.registration.scope);
          return fallback || new Response("offline", {status:503});
        }
      })());
    });
  `;

  try {
    const swBlob = new Blob([swCode], { type: "text/javascript" });
    const swUrl = URL.createObjectURL(swBlob);
    navigator.serviceWorker
      .register(swUrl, { scope: "./" })
      .then((reg) => logger?.log?.("SW registered", { scope: reg.scope }))
      .catch((e) => logger?.err?.("SW register failed", { message: e?.message }));
  } catch (e) {
    logger?.err?.("SW setup failed", { message: e?.message });
  }
}
