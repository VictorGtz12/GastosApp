const CACHE = 'gastos-v2.80';
const ASSETS = ['./', './index.html', './db.js?v=2', './app.js?v=20261026a', './despensa.js?v=20261026a', './mobile.css?v=20261026a', './mobile-ui.js?v=20261026a', './movement-filters.js?v=20261026a', './theme.js?v=20261026a', './tasks.html', './task-sync.js?v=20261026a', './manifest.json', './icon-192.png?v=20261026a', './icon-512.png?v=20261026a', './apple-touch-icon.png?v=20261026a', './favicon-32.png?v=20261026a'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('gastos-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) return;
  const isSameOrigin = url.origin === self.location.origin;
  const isFreshAsset = isSameOrigin && (
    e.request.mode === 'navigate' ||
    ['script', 'style', 'worker'].includes(e.request.destination) ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css')
  );

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchAndCache = () => fetch(e.request).then(response => {
        if (response && response.ok && isSameOrigin) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copy));
        }
        return response;
      });

      if (isFreshAsset) {
        return fetchAndCache().catch(() => cached || (e.request.mode === 'navigate' ? caches.match('./index.html') : Response.error()));
      }

      return cached || fetchAndCache();
    })
  );
});

// Notificaciones push
self.addEventListener('push', e => {
  const data = e.data?.json() || { title: '📅 Corte próximo', body: 'Revisa tu tarjeta' };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: './icon-192.png?v=20261026a', badge: './icon-192.png?v=20261026a', tag: data.tag || 'gastos'
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.openWindow('./'));
});

// Alarmas de corte via setTimeout (desde el cliente)
self.addEventListener('message', e => {
  if (e.data?.type === 'SCHEDULE_NOTIFICATION') {
    const { title, body, delay, tag } = e.data;
    setTimeout(() => {
      self.registration.showNotification(title, { body, icon: './icon-192.png?v=20261026a', tag });
    }, delay);
  }
});
