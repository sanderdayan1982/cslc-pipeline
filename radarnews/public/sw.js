self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'RadarNews', body: event.data?.text() || '' };
  }
  const tasks = [self.registration.showNotification(data.title || 'RadarNews', {
    body: data.body || '',
    tag: data.tag,
    icon: '/icon-512.png',
    badge: '/icon-512.png',
    data: { url: data.url || '/' },
  })];
  // Unread count on the home-screen / Dock icon (iOS 16.4+, macOS).
  if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
    tasks.push((data.badge ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  event.waitUntil(Promise.all(tasks));
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
