// Voice & Touch — Service Worker v5
// Evita el error iOS: "response served by service worker has redirections"
const CACHE_NAME = 'vt-gesex-v5';

const STATIC_ASSETS = [
  './index.html',
  './css/app.css',
  './manifest.json',
  './js/ocr-pallet.js',
  './js/db.js',
  './js/sync.js',
  './js/app.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache =>
        Promise.all(
          STATIC_ASSETS.map(url =>
            cache.add(url).catch(err => console.warn('precache fail', url, err))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isExternal(url) {
  const h = url.hostname;
  return (
    h.includes('firebase') ||
    h.includes('google') ||
    h.includes('googleapis') ||
    h.includes('gstatic') ||
    h.includes('cdnjs') ||
    h.includes('jsdelivr') ||
    h.includes('unpkg')
  );
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // No interceptar esquemas no http(s)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isExternal(url)) {
    event.respondWith(
      fetch(req).catch(() =>
        new Response('{}', { headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // Navegación: red primero; si falla, index del cache.
  // Nunca devolver respuestas redirigidas cacheadas.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          // Cachear solo 200 OK sin redirect
          if (res && res.ok && !res.redirected && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => {
              c.put('./index.html', clone);
            });
          }
          return res;
        })
        .catch(() =>
          caches.match('./index.html').then(c => c || caches.match('index.html'))
        )
        .then(res => res || new Response('Offline', { status: 503, statusText: 'Offline' }))
    );
    return;
  }

  // Assets: cache first, sin guardar redirects
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req)
        .then(res => {
          if (!res || res.status !== 200 || res.type !== 'basic' || res.redirected) {
            return res;
          }
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, clone));
          return res;
        })
        .catch(() => cached || Response.error());
    })
  );
});

self.addEventListener('sync', event => {
  if (event.tag === 'sync-inspections') {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_NOW' }))
      )
    );
  }
});
