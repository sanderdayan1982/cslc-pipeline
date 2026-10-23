self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'RadarNews', body: event.data?.text() || '' };
  }
  event.waitUntil(self.registration.showNotification(data.title || 'RadarNews', {
    body: data.body || '',
    tag: data.tag,
    icon: '/icon-512.png',
    badge: '/icon-512.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) return win.focus();
    return self.clients.openWindow(url);
  })());
});
