/* sw.js — cache-first service worker so the app works fully offline.
 * Bump CACHE_VERSION whenever any listed file changes, or clients keep
 * the old version.
 */
const CACHE_VERSION = "badmintonscoresheet-v12";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./i18n.js",
  "./match.js",
  "./app.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
