/* App shell cache only. Private API responses are never cached (cross-origin requests are ignored). */
const CACHE = 'sadhana-user-v1';
const SHELL = ['./', './index.html', './css/style.css', './js/api.js', './js/app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './images/bhagwan-mokal.jpg', './images/sadhana-mokal.jpg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sadhana-user-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); }
    return res;
  }).catch(() => caches.match(r).then(x => x || caches.match('./index.html'))));
});
