/*
 * Chicken Amine: the service worker that makes the site an installable app that opens on a weak connection.
 *   - pages, styles and scripts: from the network first (prices and menu always fresh), the saved copy if the
 *     network fails or takes more than 4 s
 *   - photos, icons, fonts: the saved copy at once, refreshed in the background
 *   - everything else (maps, WhatsApp, Google) is left alone
 *   - push notifications of new orders for the staff phones (sent by supabase/functions/push): shown even when
 *     the phone is locked; a tap opens the staff app
 * Raise VERSION to drop every saved copy (e.g. after removing files).
 */
const VERSION = "v3";
const CACHE = "chickenamine-" + VERSION;
const NETWORK_TIMEOUT = 4000;
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// On install: the home page and the styles and scripts it links to, so the app opens offline after the first visit.
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch("/", { cache: "no-cache" });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put("/", res);
    const files = [...html.matchAll(/(?:href|src)="(\/(?:css|js|vendor\/leaflet)\/[^"]+)"/g)].map((m) => m[1]);
    files.push("/assets/logo.png", "/assets/icons/icon-192.png", "/site.webmanifest");
    await Promise.all(files.map((f) => cache.add(f).catch(() => {})));
  })());
  self.skipWaiting();
});

// On activate: older versions' copies are removed.
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("chickenamine-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheKey) {
  const cache = await caches.open(CACHE);
  const fromNetwork = fetch(request).then((res) => {
    if (res.ok) cache.put(cacheKey, res.clone());
    return res;
  });
  const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT));
  try {
    const res = await Promise.race([fromNetwork, timeout]);
    if (res) return res;
  } catch (e) { /* offline: use the saved copy */ }
  const saved = await cache.match(cacheKey);
  return saved || fromNetwork;
}

async function savedFirst(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request);
  const refresh = fetch(request).then((res) => {
    if (res.ok || res.type === "opaque") cache.put(request, res.clone());
    return res;
  }).catch(() => saved);
  return saved || refresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // Pages: one saved copy per page, whatever the ?lang= or ?restaurant= (the page reads those itself).
    if (request.mode === "navigate") { event.respondWith(networkFirst(request, url.pathname)); return; }
    if (/^\/(css|js)\//.test(url.pathname) || url.pathname === "/site.webmanifest") { event.respondWith(networkFirst(request, request)); return; }
    if (/^\/(assets|vendor)\//.test(url.pathname)) {
      // Videos are streamed in parts by the browser: leave them to the network.
      if (/\.(mp4|webm)$/.test(url.pathname)) return;
      event.respondWith(savedFirst(request));
    }
    return;
  }
  if (FONT_HOSTS.includes(url.hostname)) event.respondWith(savedFirst(request));
});

// A new order (or one still waiting): ring the staff phone, even locked.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: "Chicken Amine", body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Chicken Amine · nouvelle commande", {
    body: data.body || "",
    tag: data.tag || "commande",
    renotify: true,
    requireInteraction: true,
    vibrate: [400, 150, 400, 150, 400],
    icon: "/assets/icons/staff-192.png",
    badge: "/assets/icons/staff-192.png",
    data: { url: data.url || "/commandes/" },
  }));
});

// A tap on the notification: back to the staff app (the open window, or a new one).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/commandes/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = wins.find((w) => new URL(w.url).pathname.startsWith("/commandes/"));
    if (open) return open.focus();
    return self.clients.openWindow(url);
  })());
});
