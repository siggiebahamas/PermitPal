// Pinoy Permit's phone alerts: shows each alert, and opens the right page when it's tapped. Nothing is cached here,
// so the website always loads fresh.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Pinoy Permit', {
    body: d.body || '', icon: 'img/icon-192.png', badge: 'img/icon-192.png',
    tag: 'pp-' + (d.url || 'alert'), renotify: true, data: { url: d.url || '#/notifications' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '#/notifications', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => c.url.startsWith(self.registration.scope));
    if (open) return open.focus().then((c) => (c && 'navigate' in c ? c.navigate(url) : null)).catch(() => self.clients.openWindow(url));
    return self.clients.openWindow(url);
  }));
});
