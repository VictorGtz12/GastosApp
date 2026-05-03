const CACHE = 'gastos-v2.10';
const ASSETS = ['./', './index.html', './app.js', './manifest.json', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchAndCache = () => fetch(e.request).then(response => {
        if (response && response.ok && new URL(e.request.url).origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(e.request, copy));
        }
        return response;
      });

      if (e.request.mode === 'navigate') {
        return fetchAndCache().catch(() => cached || caches.match('./index.html'));
      }

      return cached || fetchAndCache();
    })
  );
});

// Notificaciones push
self.addEventListener('push', e => {
  const data = e.data?.json() || { title: '📅 Corte próximo', body: 'Revisa tu tarjeta' };
  e.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: '/icon-192.png', badge: '/icon-192.png', tag: data.tag || 'gastos'
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
      self.registration.showNotification(title, { body, icon: '/icon-192.png', tag });
    }, delay);
  }
});
